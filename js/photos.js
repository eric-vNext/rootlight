// Turns matched photo files into avatars: shrinks each picture once, keeps the small copies in IndexedDB so they
// survive a reload, and swaps them in wherever an element carries data-photo="<path>".
//
// Per photo we keep two JPEGs: a 160px square thumbnail cropped toward the top (faces) for avatars, and a ~900px
// copy for the viewer. The user's originals are never stored, so a 3 GB folder costs a few MB.
window.Photos = (function () {
  const STORE = 'photos', THUMB = 160, MEDIUM = 900;
  let db = null, gen = 0, epoch = 0; // gen: which attach() is current; epoch: bumps when everything is forgotten
  let items = new Map();            // path -> supplied file { path, name, size, blob() }
  let ensured = new Map();          // path -> Promise<boolean>: is a processed copy available?
  let urls = new Map();             // path -> object URL of the thumbnail
  let failed = new Set();           // photos the browser could not decode
  let mem = new Map();              // path -> record, only when IndexedDB is unavailable or full
  let viewerUrls = new Map();       // path -> object URL of the large copy (small LRU)
  let active = 0;
  const waiting = [];
  const LIMIT = 2;

  // ---------- storage ----------
  const req = r => new Promise(res => { r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
  const tx = mode => db.transaction(STORE, mode).objectStore(STORE);
  async function get(path) {
    if (mem.has(path)) return mem.get(path);
    if (!db) return undefined;
    try { return await req(tx('readonly').get(path)); } catch { return undefined; }
  }
  async function put(rec) {
    if (db) { try { await new Promise((ok, no) => { const r = tx('readwrite').put(rec); r.onsuccess = ok; r.onerror = no; }); mem.delete(rec.path); return; } catch { /* full or blocked: keep it in memory */ } }
    mem.set(rec.path, rec);
  }

  // ---------- shrinking ----------
  function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  const toBlob = (c, q) => c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality: q }) : new Promise(res => c.toBlob(res, 'image/jpeg', q));

  async function draw(bmp, size, square, quality) {
    const w = bmp.width, h = bmp.height;
    let sx = 0, sy = 0, sw = w, sh = h, dw, dh;
    if (square) {
      sw = sh = Math.min(w, h);
      sx = (w - sw) / 2;
      sy = (h - sh) * 0.2; // portraits crop toward the top, where the face usually is
      dw = dh = size;
    } else {
      const k = Math.min(1, size / Math.max(w, h));
      dw = Math.max(1, Math.round(w * k)); dh = Math.max(1, Math.round(h * k));
    }
    const c = canvas(dw, dh), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, dw, dh); // flatten transparent PNGs
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
    return toBlob(c, quality);
  }

  async function process(item) {
    const bmp = await createImageBitmap(await item.blob()); // applies the photo's EXIF rotation
    try {
      const rec = { path: item.path, name: item.name, size: item.size, w: bmp.width, h: bmp.height,
        thumb: await draw(bmp, THUMB, true, 0.82), medium: await draw(bmp, MEDIUM, false, 0.85) };
      await put(rec);
      return rec;
    } finally { bmp.close(); }
  }

  // at most two photos are decoded at once so the page stays smooth
  async function slot(fn) {
    if (active >= LIMIT) await new Promise(res => waiting.push(res));
    active++;
    try { return await fn(); }
    finally { active--; const next = waiting.shift(); if (next) next(); }
  }

  // Makes sure a processed copy of this photo exists (stored earlier, or made now). Resolves true/false.
  function ensure(path) {
    let p = ensured.get(path);
    if (p) return p;
    const my = epoch;
    p = (async () => {
      if (failed.has(path)) return false;
      const item = items.get(path), rec = await get(path);
      if (rec && (!item || item.stored || item.size === rec.size)) return true;
      if (!item) return false;
      try {
        const made = await slot(() => process(item));
        if (my === epoch) urls.set(path, URL.createObjectURL(made.thumb));
        return true;
      } catch (e) { failed.add(path); return false; }
    })();
    p = p.then(ok => { if (!ok && !failed.has(path)) ensured.delete(path); return ok; }); // a miss may be fixed by photos added later
    ensured.set(path, p);
    return p;
  }

  // ---------- public ----------
  async function thumb(path) {
    if (urls.has(path)) return urls.get(path);
    const my = epoch;
    if (!(await ensure(path)) || my !== epoch) return null;
    if (urls.has(path)) return urls.get(path);
    const rec = await get(path);
    if (!rec || my !== epoch) return null;
    const u = URL.createObjectURL(rec.thumb);
    urls.set(path, u);
    return u;
  }

  // The larger copy for the viewer; falls back to the original file if no processed copy exists.
  async function large(path) {
    if (viewerUrls.has(path)) return viewerUrls.get(path);
    await ensure(path);
    const rec = await get(path);
    const blob = rec ? rec.medium : items.get(path) ? await items.get(path).blob() : null;
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    viewerUrls.set(path, u);
    if (viewerUrls.size > 12) { const [old] = viewerUrls.keys(); URL.revokeObjectURL(viewerUrls.get(old)); viewerUrls.delete(old); }
    return u;
  }

  // Called whenever the supplied files or their matches change. Starts processing every matched photo in the background.
  function attach(files, matched) {
    gen++;
    const my = gen;
    items = new Map(files.map(f => [f.path, f]));
    const want = new Set();
    for (const rec of matched.byPerson.values()) for (const it of rec.items) if (it.status === 'matched') want.add(it.photo.path);
    (async () => {
      for (const path of want) {
        if (my !== gen) return;
        await ensure(path);
        await new Promise(r => setTimeout(r, 0));
      }
    })();
  }

  function forget() {
    gen++; epoch++;
    for (const u of urls.values()) URL.revokeObjectURL(u);
    for (const u of viewerUrls.values()) URL.revokeObjectURL(u);
    items = new Map(); ensured = new Map(); urls = new Map(); failed = new Set(); mem = new Map(); viewerUrls = new Map();
  }

  // A new file replaced the old one: drop everything stored for it.
  async function reset() {
    forget();
    if (db) { try { await req(tx('readwrite').clear()); } catch { /* nothing to clear */ } }
  }

  // Photos kept from the last session, as files the matcher can use.
  async function restore() {
    if (!db) return [];
    const all = (await req(tx('readonly').getAll())) || [];
    return all.map(r => ({ path: r.path, name: r.name, size: r.size, stored: true, blob: async () => (await get(r.path)).medium }));
  }

  // ---------- swapping photos into the page ----------
  // Any element carrying data-photo="<path>" gets that photo as its background once the thumbnail is ready.
  function dress(el) {
    const path = el.dataset.photo;
    if (!path || el.dataset.dressed === path) return;
    el.dataset.dressed = path;
    thumb(path).then(u => {
      if (!u || !el.isConnected || el.dataset.photo !== path) return;
      el.style.backgroundImage = `url("${u}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center 20%';
      el.classList.add('photo');
    });
  }
  function sweep(root) {
    if (root.nodeType !== 1) return;
    if (root.dataset && root.dataset.photo) dress(root);
    root.querySelectorAll && root.querySelectorAll('[data-photo]').forEach(dress);
  }
  function watch() {
    new MutationObserver(list => { for (const m of list) m.addedNodes.forEach(sweep); }).observe(document.body, { childList: true, subtree: true });
    sweep(document.body);
  }

  // ---------- viewer ----------
  let box = null, shots = [], at = 0;
  function build() {
    box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.innerHTML = `<button class="lb-close" aria-label="Close">✕</button>
      <button class="lb-nav lb-prev" aria-label="Previous photo">‹</button>
      <figure><img alt=""><figcaption><b></b><span></span></figcaption></figure>
      <button class="lb-nav lb-next" aria-label="Next photo">›</button>`;
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (e.target.closest('.lb-prev')) show(at - 1);
      else if (e.target.closest('.lb-next')) show(at + 1);
      else if (!e.target.closest('img, figcaption')) close();
    });
    // capture phase: while the viewer is open, arrow keys must not also move around the family tree
    document.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(at - 1);
      else if (e.key === 'ArrowRight') show(at + 1);
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }
  async function show(i) {
    if (!shots.length) return;
    at = (i + shots.length) % shots.length;
    const s = shots[at], img = box.querySelector('img');
    box.querySelector('b').textContent = s.title || s.name;
    box.querySelector('span').textContent = [s.who, shots.length > 1 ? `${at + 1} of ${shots.length}` : ''].filter(Boolean).join(' · ');
    box.classList.toggle('single', shots.length < 2);
    // show the small copy at once, then the sharp one
    const quick = urls.get(s.path);
    if (quick) img.src = quick;
    const u = await large(s.path);
    if (shots[at] === s && u) img.src = u;
  }
  // list: [{ path, title, name, who }]
  function open(list, index = 0) {
    if (!box) build();
    shots = list; box.hidden = false;
    document.body.classList.add('lb-open');
    show(index);
    box.querySelector('.lb-close').focus();
  }
  function close() { if (box) { box.hidden = true; document.body.classList.remove('lb-open'); box.querySelector('img').removeAttribute('src'); } }

  return { setDb(d) { db = d; }, attach, thumb, large, restore, reset, forget, watch, open, close, STORE };
})();
