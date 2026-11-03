// App controller: state, navigation, search, keyboard, persistence. Exposes window.App.
(function () {
  const $ = s => document.querySelector(s);
  const VIEWS = { tree: TreeView, fan: FanView, stars: StarsView, timeline: TimelineView, almanac: AlmanacView };

  const App = {
    tree: null,
    focusId: null,
    homeId: null,
    view: 'tree',
    trail: [],
    pathIds: null, // highlighted relationship path
    fileName: '',
    dirty: new Set(),
    relateFrom: null,

    get focus() { return this.tree && this.tree.get(this.focusId); },
    get home() { return this.tree && this.tree.get(this.homeId); },

    load(text, name, opts = {}) {
      let tree;
      try { tree = Gedcom.build(text); }
      catch (e) { console.error(e); U.toast('That file could not be read as GEDCOM.'); return; }
      if (!tree.people.size) { U.toast('No people found in that file — is it a GEDCOM?'); return; }
      this.tree = tree;
      this.fileName = name;
      const home = (opts.home && tree.get(opts.home)) || tree.guessHome();
      this.homeId = home.id;
      this.trail = [];
      this.pathIds = null;
      $('#welcome').hidden = true;
      $('#app').hidden = false;
      document.title = `${name.replace(/\.(ged|gedcom)$/i, '')} · Rootlight`;
      for (const v of Object.values(VIEWS)) v.reset && v.reset();
      this.setView(opts.view || this.view, true);
      this.go(home.id, { quiet: true });
      if (opts.save !== false) Store.save({ name, text, home: home.id });
      const s = tree.stats();
      U.toast(`✦ ${s.count.toLocaleString()} people across ${s.minYear && s.maxYear ? `${s.maxYear - s.minYear} years` : 'the ages'} — welcome, ${U.esc(home.given.split(' ')[0] || home.name)}'s family`, 3800);
    },

    go(id, opts = {}) {
      const p = this.tree.get(id);
      if (!p) return;
      // tapping the person already in focus opens their story
      if (id === this.focusId && !opts.quiet && $('#app').classList.contains('panel-closed')) togglePanel(false);
      this.focusId = id;
      if (this.trail[this.trail.length - 1] !== id) {
        const existing = this.trail.indexOf(id);
        if (existing >= 0) this.trail.splice(existing, 1);
        this.trail.push(id);
        if (this.trail.length > 30) this.trail.shift();
      }
      if (!opts.keepPath) this.pathIds = null;
      for (const k of Object.keys(VIEWS)) this.dirty.add(k);
      this.renderView();
      Panel.render(p);
      this.renderTrail();
    },

    setHome(id) {
      this.homeId = id;
      Store.updateHome(id);
      U.toast(`⌂ ${U.esc(this.tree.get(id).name)} is now home. Relationships are shown from their point of view.`);
      for (const k of Object.keys(VIEWS)) this.dirty.add(k);
      this.renderView();
      Panel.render(this.focus);
    },

    setView(v, silent) {
      if (!VIEWS[v]) return;
      this.view = v;
      document.querySelectorAll('.views button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
      document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.dataset.view === v));
      U.hideTip();
      if (!silent && this.tree) this.renderView();
      try { localStorage.setItem('rootlight.view', v); } catch (e) { }
    },

    renderView() {
      if (!this.tree || !this.focus) return;
      const v = VIEWS[this.view];
      const el = document.getElementById('view-' + this.view);
      if (!v._inited) { v.init(el, this); v._inited = true; }
      if (this.dirty.has(this.view)) {
        this.dirty.delete(this.view);
        v.render(this.focus);
      }
      $('#hint').textContent = v.hint || '';
    },

    renderTrail() {
      const ol = $('#trail');
      ol.innerHTML = this.trail.map(id => {
        const p = this.tree.get(id);
        return `<li><button data-goto="${U.esc(id)}">${U.esc(p.given.split(' ')[0] || p.name)} ${U.esc(p.surname)}</button></li>`;
      }).join('');
      ol.scrollLeft = ol.scrollWidth;
    },

    showPath(a, b) {
      const path = this.tree.path(a, b);
      if (!path) { U.toast(`No known connection between ${U.esc(a.name)} and ${U.esc(b.name)}.`); return; }
      this.pathIds = path.map(s => s.person.id);
      Panel.render(this.focus, { pathTo: { a, b, path } });
      for (const k of Object.keys(VIEWS)) this.dirty.add(k);
      if (this.view === 'tree' || this.view === 'almanac' || this.view === 'fan') this.setView('stars');
      else this.renderView();
    },

    random() {
      const all = [...this.tree.people.values()];
      // Prefer people with a bit of a story.
      const rich = all.filter(p => p.events.length >= 2 && p.id !== this.focusId);
      const pool = rich.length > 5 ? rich : all;
      const p = pool[Math.floor(Math.random() * pool.length)];
      const rel = this.home && this.tree.relationship(this.home, p);
      U.toast(`🎲 Meet ${U.esc(p.name)}${rel && rel.label !== 'self' ? ` — ${U.esc(this.home.given.split(' ')[0])}'s ${U.esc(rel.label)}` : ''}`);
      this.go(p.id);
    },

    navigate(dir, shift) {
      const p = this.focus;
      if (!p) return;
      const t = this.tree;
      let next = null;
      if (dir === 'up') next = shift ? (t.mother(p) || t.father(p)) : (t.father(p) || t.mother(p));
      if (dir === 'down') {
        const kids = t.children(p);
        // remember which child we came from
        const prev = this.trail[this.trail.length - 2];
        next = kids.find(k => k.id === prev) || kids[0];
      }
      if (dir === 'left' || dir === 'right') {
        const fam = t.parentFamily(p);
        const sibs = fam ? fam.children.map(id => t.get(id)) : [];
        const i = sibs.findIndex(s => s.id === p.id);
        if (sibs.length > 1) next = sibs[(i + (dir === 'right' ? 1 : -1) + sibs.length) % sibs.length];
        else { const sp = t.spouses(p)[0]; if (sp) next = sp; }
      }
      if (next) this.go(next.id);
      else U.toast(dir === 'up' ? 'The trail goes cold here — no parents recorded.' : dir === 'down' ? 'No children recorded.' : 'No siblings recorded.', 1800);
    },

    // Width of a view that isn't covered by the side panel.
    visibleWidth(el) {
      const covered = innerWidth > 760 && !$('#app').classList.contains('panel-closed') ? $('#panel').offsetWidth : 0;
      return Math.max(200, el.clientWidth - covered);
    },

    toggleTheme() {
      const r = document.documentElement;
      r.dataset.theme = r.dataset.theme === 'parchment' ? 'night' : 'parchment';
      $('#theme-btn').textContent = r.dataset.theme === 'parchment' ? '☀' : '☾';
      try { localStorage.setItem('rootlight.theme', r.dataset.theme); } catch (e) { }
      for (const k of Object.keys(VIEWS)) this.dirty.add(k);
      if (this.tree) { this.renderView(); Panel.render(this.focus); }
    },
  };

  // ---------- persistence (IndexedDB; optional) ----------
  const Store = {
    db: null,
    open() {
      return new Promise(res => {
        try {
          const req = indexedDB.open('rootlight', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('files');
          req.onsuccess = () => { this.db = req.result; res(this.db); };
          req.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    },
    async save(rec) {
      if (!this.db) return;
      try { this.db.transaction('files', 'readwrite').objectStore('files').put(rec, 'last'); } catch (e) { }
    },
    async updateHome(id) {
      const rec = await this.load();
      if (rec) { rec.home = id; this.save(rec); }
    },
    load() {
      return new Promise(res => {
        if (!this.db) return res(null);
        try {
          const req = this.db.transaction('files').objectStore('files').get('last');
          req.onsuccess = () => res(req.result || null);
          req.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    },
  };

  // ---------- file loading ----------
  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => App.load(Gedcom.decode(reader.result), file.name);
    reader.onerror = () => U.toast('Could not read that file.');
    reader.readAsArrayBuffer(file);
  }

  // ---------- search palette ----------
  const Palette = {
    sel: 0, results: [], mode: 'go',
    open(mode = 'go') {
      if (!App.tree) return;
      this.mode = mode;
      $('#palette').hidden = false;
      const inp = $('#palette-input');
      inp.value = '';
      inp.placeholder = mode === 'relate' ? `How is ${App.focus.given.split(' ')[0]} related to… (type a name)` : 'Search by name, place, year, or occupation…';
      this.search('');
      inp.focus();
    },
    close() { $('#palette').hidden = true; },
    search(q) {
      const t = App.tree;
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      let res;
      if (!terms.length) {
        // recently visited, then close family
        const ids = [...App.trail].reverse();
        const fam = [...t.parents(App.focus), ...t.spouses(App.focus), ...t.children(App.focus), ...t.siblings(App.focus)].map(p => p.id);
        res = [...new Set([...ids, ...fam])].map(id => t.get(id)).filter(p => p && (this.mode !== 'relate' || p.id !== App.focusId)).slice(0, 12);
      } else {
        const scored = [];
        for (const p of t.people.values()) {
          const name = p.name.toLowerCase();
          const hay = [name, p.nick, p.occupation, ...p.events.map(e => e.place), t.birthYear(p), t.deathYear(p)].join(' ').toLowerCase();
          let score = 0, ok = true;
          for (const w of terms) {
            if (name.split(/\s+/).some(n => n.startsWith(w))) score += 10;
            else if (name.includes(w)) score += 5;
            else if (hay.includes(w)) score += 2;
            else { ok = false; break; }
          }
          if (ok) scored.push([score, p]);
        }
        scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
        res = scored.slice(0, 40).map(x => x[1]);
      }
      this.results = res;
      this.sel = 0;
      this.draw(terms);
    },
    draw(terms = []) {
      const ul = $('#palette-results');
      if (!this.results.length) { ul.innerHTML = '<li class="empty">Nobody by that name… yet. Keep digging!</li>'; return; }
      const hl = s => {
        let out = U.esc(s);
        for (const w of terms) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
        return out;
      };
      ul.innerHTML = this.results.map((p, i) => {
        const rel = App.home && App.tree.relationship(App.home, p);
        const sub = [rel && rel.label !== 'self' ? rel.label : rel ? 'home' : '', App.tree.lifespan(p), p.birth && p.birth.place ? Gedcom.placeShort(p.birth.place, 2) : ''].filter(Boolean).join(' · ');
        return `<li class="${i === this.sel ? 'sel' : ''}" data-i="${i}"><button class="person-chip" data-i="${i}">
          <span class="dot" style="background:${U.avatarBg(p)}">${U.esc(U.initials(p))}</span>
          <span><div class="nm">${hl(p.name)}</div><div class="sub">${hl(sub)}</div></span></button></li>`;
      }).join('');
      const s = ul.querySelector('.sel');
      if (s) s.scrollIntoView({ block: 'nearest' });
    },
    choose(i, relate) {
      const p = this.results[i];
      if (!p) return;
      this.close();
      if (relate || this.mode === 'relate') {
        const a = App.focus;
        if (a.id === p.id) return;
        App.showPath(a, p);
      } else App.go(p.id);
    },
  };

  // ---------- star-field backdrop ----------
  function sky() {
    const c = $('#sky'), ctx = c.getContext('2d');
    let stars = [], w, h;
    const resize = () => {
      w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
      stars = Array.from({ length: Math.round(innerWidth * innerHeight / 3500) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, p: Math.random() * Math.PI * 2, s: 0.5 + Math.random() * 1.5 }));
    };
    resize();
    addEventListener('resize', resize);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let shooting = null;
    function frame(t) {
      if (document.documentElement.dataset.theme !== 'parchment') {
        ctx.clearRect(0, 0, w, h);
        for (const s of stars) {
          const a = 0.35 + 0.45 * Math.sin(s.p + t / 1000 * s.s);
          ctx.fillStyle = `rgba(230,225,255,${a})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * devicePixelRatio, 0, 7); ctx.fill();
        }
        if (!shooting && Math.random() < 0.002) shooting = { x: Math.random() * w, y: Math.random() * h * 0.5, vx: (4 + Math.random() * 4) * devicePixelRatio, vy: (2 + Math.random() * 2) * devicePixelRatio, life: 1 };
        if (shooting) {
          const g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 14, shooting.y - shooting.vy * 14);
          g.addColorStop(0, `rgba(255,230,180,${shooting.life})`); g.addColorStop(1, 'rgba(255,230,180,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.5 * devicePixelRatio;
          ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * 14, shooting.y - shooting.vy * 14); ctx.stroke();
          shooting.x += shooting.vx; shooting.y += shooting.vy; shooting.life -= 0.015;
          if (shooting.life <= 0) shooting = null;
        }
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- wiring ----------
  function wire() {
    const fileInput = $('#file-input');
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); fileInput.value = ''; });
    $('#dropzone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    $('#try-sample').addEventListener('click', () => App.load(window.SAMPLE_GEDCOM, 'The Ashworth Family (sample).ged', { home: 'I1' }));
    $('#open-btn').addEventListener('click', () => fileInput.click());

    // drag & drop anywhere
    let dragDepth = 0;
    addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#dropzone').classList.add('over'); });
    addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('over'); } });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', e => {
      e.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => App.setView(b.dataset.view)));
    $('#search-btn').addEventListener('click', () => Palette.open());
    $('#dice').addEventListener('click', () => App.random());
    $('#home-btn').addEventListener('click', () => App.go(App.homeId));
    $('#theme-btn').addEventListener('click', () => App.toggleTheme());
    $('#panel-toggle').addEventListener('click', () => togglePanel());

    // any [data-goto] anywhere navigates
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g && !e.target.closest('#palette')) App.go(g.dataset.goto);
    });

    // palette
    const inp = $('#palette-input');
    inp.addEventListener('input', () => Palette.search(inp.value));
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); Palette.sel = Math.min(Palette.sel + 1, Palette.results.length - 1); Palette.draw(inp.value.toLowerCase().split(/\s+/).filter(Boolean)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); Palette.sel = Math.max(Palette.sel - 1, 0); Palette.draw(inp.value.toLowerCase().split(/\s+/).filter(Boolean)); }
      else if (e.key === 'Enter') { e.preventDefault(); Palette.choose(Palette.sel, e.shiftKey); }
      else if (e.key === 'Escape') Palette.close();
    });
    $('#palette').addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) Palette.choose(+b.dataset.i, e.shiftKey);
      else if (e.target.id === 'palette') Palette.close();
    });

    document.addEventListener('keydown', e => {
      if (!App.tree || !$('#palette').hidden) return;
      if (e.target.closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.open(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === '/') { e.preventDefault(); Palette.open(); }
      else if (k === 'ArrowUp') { e.preventDefault(); App.navigate('up', e.shiftKey); }
      else if (k === 'ArrowDown') { e.preventDefault(); App.navigate('down'); }
      else if (k === 'ArrowLeft') { e.preventDefault(); App.navigate('left'); }
      else if (k === 'ArrowRight') { e.preventDefault(); App.navigate('right'); }
      else if (k === 'r' || k === 'R') App.random();
      else if (k === 'h' || k === 'H') App.go(App.homeId);
      else if (k === 's' || k === 'S') togglePanel();
      else if (k === 't' || k === 'T') App.toggleTheme();
      else if (k === 'Backspace' && App.trail.length > 1) { App.trail.pop(); App.go(App.trail.pop()); }
      else if ('12345'.includes(k)) App.setView(Object.keys(VIEWS)[+k - 1]);
    });

    addEventListener('resize', debounce(() => {
      for (const k of Object.keys(VIEWS)) App.dirty.add(k);
      App.renderView();
    }, 200));
  }

  function togglePanel(force) {
    const app = $('#app');
    app.classList.toggle('panel-closed', force);
    setTimeout(() => { for (const k of ['tree', 'fan', 'stars', 'timeline']) VIEWS[k].onResize && VIEWS[k].onResize(); }, 420);
  }
  App.togglePanel = togglePanel;
  App.openRelate = () => Palette.open('relate');

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  async function start() {
    try {
      const th = localStorage.getItem('rootlight.theme');
      if (th) { document.documentElement.dataset.theme = th; $('#theme-btn').textContent = th === 'parchment' ? '☀' : '☾'; }
      const v = localStorage.getItem('rootlight.view');
      if (v && VIEWS[v]) App.view = v;
    } catch (e) { }
    if (innerWidth < 760) $('#app').classList.add('panel-closed');
    sky();
    wire();
    await Store.open();
    const rec = await Store.load();
    if (rec && rec.text) {
      $('#resume').hidden = false;
      $('#resume-name').textContent = rec.name.replace(/\.(ged|gedcom)$/i, '');
      $('#resume').addEventListener('click', () => App.load(rec.text, rec.name, { home: rec.home, save: false }));
    }
    // ?sample in the URL jumps straight in (handy for demos)
    if (/[?&]sample\b/.test(location.search)) $('#try-sample').click();
  }

  window.App = App;
  start();
})();
