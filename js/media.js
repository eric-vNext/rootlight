// Getting photos into the browser: GEDCOM files only name their pictures, so the user hands them over
// as a .gdz/.zip bundle, a folder, or loose images. Everything here reads local files; nothing is uploaded.
//
// An "entry" is { file, path } (a File plus where it sat in its folder). Photos come out as
// { path, name, size, blob() } where blob() produces the bytes only when asked, so a 3 GB folder costs nothing up front.
window.Media = (function () {
  const GED = /\.(ged|gedcom)$/i;
  const ZIP = /\.(zip|gdz)$/i;
  const IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._|Thumbs\.db$)/i;

  const norm = p => p.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = p => p.split('/').pop();

  // ---------- zip ----------
  // Reads only the central directory up front; each file is inflated on demand with the browser's own DecompressionStream.
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => Number(v.getBigUint64(o, true));
  const bytes = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());

  function decodeName(raw, utf8Flag) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); }
    catch { return utf8Flag ? new TextDecoder().decode(raw) : new TextDecoder('windows-1252').decode(raw); }
  }

  async function readZip(file) {
    const size = file.size;
    if (size < 22) throw new Error('That zip is empty or damaged.');
    const tailStart = Math.max(0, size - (22 + 65535));
    const tail = await bytes(file, tailStart, size);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('That does not look like a zip file.');

    let count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOffset = u32(tail, eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      // zip64: the real numbers live in a second record just before the end marker
      const loc = tailStart + eocd - 20;
      const l = await bytes(file, loc, loc + 20);
      if (loc < 0 || u32(l, 0) !== 0x07064b50) throw new Error('That zip uses a format Rootlight cannot read.');
      const z = await bytes(file, u64(l, 8), u64(l, 8) + 56);
      count = u64(z, 32); cdSize = u64(z, 40); cdOffset = u64(z, 48);
    }

    const cd = await bytes(file, cdOffset, cdOffset + cdSize);
    const out = [];
    let o = 0;
    for (let n = 0; n < count && o + 46 <= cd.byteLength && u32(cd, o) === 0x02014b50; n++) {
      const flags = u16(cd, o + 8), method = u16(cd, o + 10);
      let csize = u32(cd, o + 20), usize = u32(cd, o + 24), local = u32(cd, o + 42);
      const nameLen = u16(cd, o + 28), extraLen = u16(cd, o + 30), commentLen = u16(cd, o + 32);
      const name = decodeName(new Uint8Array(cd.buffer, o + 46, nameLen), flags & 0x800);
      // zip64 extra field: only the values that overflowed are present, in this order
      for (let e = o + 46 + nameLen, end = e + extraLen; e + 4 <= end;) {
        const id = u16(cd, e), len = u16(cd, e + 2);
        if (id === 1) {
          let p = e + 4;
          if (usize === 0xffffffff) { usize = u64(cd, p); p += 8; }
          if (csize === 0xffffffff) { csize = u64(cd, p); p += 8; }
          if (local === 0xffffffff) local = u64(cd, p);
        }
        e += 4 + len;
      }
      o += 46 + nameLen + extraLen + commentLen;

      const path = norm(name);
      if (name.endsWith('/') || (flags & 1) || JUNK.test(path)) continue; // folders, encrypted files, OS clutter
      if (method !== 0 && method !== 8) continue;
      out.push({
        path, name: base(path), size: usize,
        async blob() {
          const h = await bytes(file, local, local + 30);
          if (u32(h, 0) !== 0x04034b50) throw new Error('Damaged zip entry: ' + path);
          const start = local + 30 + u16(h, 26) + u16(h, 28);
          const raw = file.slice(start, start + csize);
          if (method === 0) return raw;
          return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        },
      });
    }
    return out;
  }

  // ---------- folders and file lists ----------
  function fromFileList(list) {
    return [...list].map(file => ({ file, path: norm(file.webkitRelativePath || file.name) }));
  }

  // Drag-and-drop gives directory entries that have to be walked. Call this synchronously inside the drop handler,
  // because the browser empties the DataTransfer as soon as the handler yields.
  function entriesOfDrop(dt) {
    const found = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    return { entries: found, files: found.length ? [] : fromFileList(dt.files) };
  }

  function walk(entry, prefix, out) {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(file => { out.push({ file, path: norm(prefix + entry.name) }); resolve(); }, () => resolve());
        return;
      }
      const reader = entry.createReader(), all = [];
      const next = () => reader.readEntries(async batch => {
        if (batch.length) { all.push(...batch); next(); return; }
        await Promise.all(all.map(e => walk(e, prefix + entry.name + '/', out)));
        resolve();
      }, () => resolve());
      next();
    });
  }

  async function fromDrop(dropped) {
    const out = [...dropped.files];
    await Promise.all(dropped.entries.map(e => walk(e, '', out)));
    return out;
  }

  // ---------- sorting what we were given ----------
  const photoOf = e => ({ path: e.path, name: base(e.path), size: e.file.size, blob: () => Promise.resolve(e.file) });

  // Turns any mix of files into { ged, photos, notes }.
  //   ged    — { name, blob } for the GEDCOM to open (shallowest one wins), or null
  //   photos — every image found, loose or inside a zip/gdz
  async function classify(entries) {
    const geds = [], photos = [];
    let note = '';
    // one lone file that is not a zip or image is assumed to be the GEDCOM, whatever it is called (.txt exports exist)
    const lone = entries.length === 1 && !ZIP.test(entries[0].path) && !IMAGE.test(entries[0].path);
    for (const e of entries) {
      if (JUNK.test(e.path)) continue;
      if (ZIP.test(e.path)) {
        let inner;
        try { inner = await readZip(e.file); } catch (err) { note = err.message; continue; }
        for (const z of inner) {
          if (GED.test(z.path)) geds.push({ path: z.path, name: z.name, size: z.size, blob: z.blob });
          else if (IMAGE.test(z.path)) photos.push(z);
        }
      } else if (GED.test(e.path) || lone) {
        geds.push({ path: e.path, name: base(e.path), size: e.file.size, blob: () => Promise.resolve(e.file) });
      } else if (IMAGE.test(e.path)) {
        photos.push(photoOf(e));
      }
    }
    geds.sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.size - a.size);
    return { ged: geds[0] || null, photos, note };
  }

  // ---------- matching ----------
  // A GEDCOM names a photo by the path it had on the exporter's computer (`C:\\Users\\Sam\\Pictures\\Ann\\a.jpg`), but the
  // user supplies it from some other folder or zip, so the start of the path never lines up. The end of it does.
  // Everything is compared as lowercase path pieces: ['users', 'sam', 'pictures', 'ann', 'a.jpg'].
  function pieces(path) {
    let p = path.replace(/\\/g, '/').replace(/^file:\/*/i, '').replace(/[?#].*$/, '');
    try { p = decodeURIComponent(p); } catch { /* not percent-encoded after all */ }
    // macOS stores accented names decomposed, GEDCOMs usually compose them; compare composed
    p = p.normalize('NFC').toLowerCase().replace(/^[a-z]:\//, '');
    return p.split('/').filter(s => s && s !== '.' && s !== '..');
  }
  const stemOf = name => name.replace(/\.[^.]*$/, '');

  // How many trailing pieces two paths share: ['a','b','x.jpg'] vs ['c','b','x.jpg'] -> 2
  function sharedEnd(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  }

  // Pairs every photo reference in the tree with a supplied file.
  // Returns { byPerson: Map(id -> { items, cover }), report }.
  //   item   — { ref, status: 'matched'|'ambiguous'|'missing'|'remote', photo?, how?, options? }
  //   how    — 'path' (folders agree, or the reference was a bare name), 'name' (only the file name agrees),
  //            'fuzzy' (same name, different extension), 'claimed' (a tie settled by elimination)
  //   cover  — the item to draw as the person's picture: their main photo if it matched, else their first matched one
  // A tie is never guessed: the reference stays 'ambiguous' and lists its candidates.
  function match(tree, photos) {
    const byName = new Map(), byStem = new Map();
    const add = (map, k, v) => { const l = map.get(k); if (l) l.push(v); else map.set(k, [v]); };
    for (const photo of photos) {
      const segs = pieces(photo.path), entry = { photo, segs };
      const name = segs[segs.length - 1];
      if (!name) continue;
      add(byName, name, entry);
      add(byStem, stemOf(name), entry);
    }

    const byPerson = new Map();
    const pending = []; // ambiguous items, retried once every clear match is known
    const claimed = new Set(), used = new Set();
    const report = { refs: 0, matched: 0, ambiguous: 0, missing: 0, remote: 0, fuzzy: 0, supplied: photos.length, unused: 0, missingList: [], ambiguousList: [] };

    for (const p of tree.people.values()) {
      if (!p.media || !p.media.length) continue; // (guard: a cached older gedcom.js has no media field)
      const items = [];
      for (const ref of p.media) {
        report.refs++;
        const item = { ref, status: 'missing' };
        items.push(item);
        if (ref.remote) { item.status = 'remote'; report.remote++; continue; }
        const segs = pieces(ref.file), name = segs[segs.length - 1];
        let pool = name && byName.get(name), fuzzy = false;
        if (!pool && name) { pool = byStem.get(stemOf(name)); fuzzy = !!pool; }
        if (!pool) continue;
        const scored = pool.map(e => ({ e, n: sharedEnd(segs, e.segs) }));
        const best = Math.max(...scored.map(c => c.n));
        const top = scored.filter(c => c.n === best).map(c => c.e);
        if (top.length === 1) {
          Object.assign(item, { status: 'matched', photo: top[0].photo, how: fuzzy ? 'fuzzy' : best >= 2 || segs.length === 1 ? 'path' : 'name' });
          claimed.add(top[0].photo); used.add(top[0].photo);
        } else {
          item.status = 'ambiguous';
          item.options = top.map(e => e.photo.path);
          pending.push({ item, top });
        }
      }
      byPerson.set(p.id, { items, cover: null });
    }

    // an ambiguous reference whose rivals are all taken by firmer matches gets the one left over
    for (const { item, top } of pending) {
      const free = top.filter(e => !claimed.has(e.photo));
      if (free.length !== 1) continue;
      Object.assign(item, { status: 'matched', photo: free[0].photo, how: 'claimed' });
      delete item.options;
      used.add(free[0].photo);
    }

    for (const [id, rec] of byPerson) {
      const person = tree.get(id);
      for (const it of rec.items) {
        if (it.status === 'matched') { report.matched++; if (it.how === 'fuzzy') report.fuzzy++; }
        else if (it.status === 'ambiguous') { report.ambiguous++; report.ambiguousList.push({ id, file: it.ref.file, options: it.options }); }
        else if (it.status === 'missing') { report.missing++; report.missingList.push({ id, file: it.ref.file }); }
      }
      const primary = rec.items.find(it => it.ref === person.photo);
      rec.cover = primary && primary.status === 'matched' ? primary : rec.items.find(it => it.status === 'matched') || null;
    }
    report.unused = photos.length - used.size;
    return { byPerson, report };
  }

  return { readZip, fromFileList, entriesOfDrop, fromDrop, classify, match, pieces, IMAGE };
})();
