// GEDCOM parsing + family model. Exposes window.Gedcom.
(function () {
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const EVENT_LABELS = {
    BIRT: 'Born', CHR: 'Christened', BAPM: 'Baptized', BARM: 'Bar mitzvah', BATM: 'Bat mitzvah', BLES: 'Blessed',
    CONF: 'Confirmed', FCOM: 'First communion', ADOP: 'Adopted', DEAT: 'Died', BURI: 'Buried', CREM: 'Cremated',
    PROB: 'Probate', WILL: 'Will', GRAD: 'Graduated', EDUC: 'Education', RETI: 'Retired', OCCU: 'Occupation',
    RESI: 'Residence', CENS: 'Census', EMIG: 'Emigrated', IMMI: 'Immigrated', NATU: 'Naturalized', RELI: 'Religion',
    MILI: 'Military service', TITL: 'Title', EVEN: 'Event', FACT: 'Fact', MARR: 'Married', DIV: 'Divorced', ENGA: 'Engaged',
    MARB: 'Marriage banns', MARL: 'Marriage license', ANUL: 'Annulled', DSCR: 'Description', NATI: 'Nationality', PROP: 'Property',
  };
  const INDI_EVENTS = new Set(Object.keys(EVENT_LABELS).filter(t => !['MARR', 'DIV', 'ENGA', 'MARB', 'MARL', 'ANUL'].includes(t)));
  const FAM_EVENTS = new Set(['MARR', 'DIV', 'ENGA', 'MARB', 'MARL', 'ANUL', 'EVEN', 'CENS', 'RESI']);

  // ---------- decoding ----------
  function decode(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b[0] === 0x30 && b[1] === 0x00) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0x00 && b[1] === 0x30) return new TextDecoder('utf-16be').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
    catch (e) { return new TextDecoder('windows-1252').decode(b); }
  }

  // ---------- line parsing ----------
  function parseTree(text) {
    const roots = [];
    const stack = [];
    const lines = text.split(/\r\n|\r|\n/);
    const re = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const m = re.exec(raw);
      if (!m) continue;
      const level = +m[1];
      const node = { level, xref: m[2] ? m[2].slice(1, -1) : null, tag: m[3].toUpperCase(), value: m[4] || '', children: [] };
      if (node.tag === 'CONT' || node.tag === 'CONC') {
        const parent = stack[level - 1];
        if (parent) parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
        continue;
      }
      stack.length = level;
      stack[level] = node;
      if (level === 0) roots.push(node);
      else if (stack[level - 1]) stack[level - 1].children.push(node);
    }
    return roots;
  }

  const child = (n, tag) => n.children.find(c => c.tag === tag);
  const childVal = (n, tag) => { const c = child(n, tag); return c ? c.value.trim() : ''; };
  const children = (n, tag) => n.children.filter(c => c.tag === tag);
  const ptr = v => (v || '').trim().replace(/^@|@$/g, '');

  // ---------- media ----------
  // GEDCOM only stores references to photos, never the pixels. Three shapes exist in the wild:
  //   5.5     1 OBJE / 2 FORM jpg / 2 FILE x.jpg / 2 TITL ...        (inline, FORM beside FILE)
  //   5.5.1   1 OBJE @M1@  ->  0 @M1@ OBJE / 1 FILE x.jpg / 2 FORM jpg   (pointer to a record)
  //   7.0     1 OBJE @M1@  ->  0 @M1@ OBJE / 1 FILE x.jpg / 2 FORM image/jpeg
  // Ancestry, Family Tree Maker and RootsMagic add `_PRIM Y` to flag a person's main photo.
  const IMAGE_FORM = /^(jpe?g|png|gif|webp|bmp|avif)$/;
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  const isPtr = v => /^@[^@]+@$/.test((v || '').trim());
  const isYes = n => !!n && /^y/i.test(childVal(n, '_PRIM'));

  function fileName(path) {
    let name = path.split(/[\\/]/).pop().replace(/[?#].*$/, '');
    try { name = decodeURIComponent(name); } catch { /* keep as written */ }
    return name;
  }

  // Returns the image references one OBJE node describes; non-image attachments (PDFs, audio) are counted in `skipped`.
  function parseObject(ref, records, tally) {
    const node = isPtr(ref.value) ? records[ptr(ref.value)] : ref;
    if (!node) { tally.broken++; return []; }
    const out = [];
    for (const f of children(node, 'FILE')) {
      const file = f.value.trim();
      if (!file) continue;
      const form = (childVal(f, 'FORM') || childVal(node, 'FORM')).toLowerCase().replace(/^image\//, '').replace('jpeg', 'jpg');
      const bare = file.replace(/[?#].*$/, '');
      if (!IMAGE_EXT.test(bare) && !IMAGE_FORM.test(form)) { tally.skipped++; continue; }
      out.push({
        file,
        name: fileName(file),
        form: form || bare.split('.').pop().toLowerCase().replace('jpeg', 'jpg'),
        title: childVal(f, 'TITL') || childVal(node, 'TITL') || childVal(ref, 'TITL'),
        primary: isYes(f) || isYes(node) || isYes(ref),
        remote: /^https?:\/\//i.test(file),
      });
    }
    return out;
  }

  // ---------- dates ----------
  function parseDate(raw) {
    if (!raw) return null;
    const s = raw.toUpperCase().trim();
    const d = { raw: raw.trim(), year: null, month: null, day: null, approx: false, endYear: null };
    if (/\b(ABT|ABOUT|EST|CAL|BEF|AFT|BET|FROM|TO|CIRCA|C\.)\b/.test(s) || s.startsWith('C ')) d.approx = true;
    // first concrete date
    const parts = s.replace(/[()]/g, ' ').split(/\s+/);
    const years = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const ym = /^(\d{3,4})(?:\/\d{1,2})?$/.exec(p);
      if (ym) {
        const y = +ym[1];
        years.push(y);
        if (d.year == null) {
          d.year = y;
          const mon = MONTHS[(parts[i - 1] || '').slice(0, 3)];
          if (mon) { d.month = mon; const dd = +parts[i - 2]; if (dd >= 1 && dd <= 31) d.day = dd; }
        }
      }
    }
    if (d.year == null) {
      const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (iso) { d.year = +iso[1]; d.month = +iso[2]; d.day = +iso[3]; }
    }
    if (years.length > 1) d.endYear = years[years.length - 1];
    if (/\bBET\b/.test(s) && years.length > 1) d.year = Math.round((years[0] + years[1]) / 2);
    return d;
  }

  function formatDate(d) {
    if (!d) return '';
    if (d.year == null) return d.raw;
    const s = d.raw.toUpperCase();
    let pre = '';
    if (/\bBEF\b/.test(s)) pre = 'before ';
    else if (/\bAFT\b/.test(s)) pre = 'after ';
    else if (/\bBET\b/.test(s) && d.endYear) return `between ${d.raw.match(/\d{3,4}/g)[0]} and ${d.endYear}`;
    else if (d.approx) pre = 'about ';
    if (d.day && d.month) return `${pre}${d.day} ${MONTH_NAMES[d.month]} ${d.year}`;
    if (d.month) return `${pre}${MONTH_NAMES[d.month]} ${d.year}`;
    return `${pre}${d.year}`;
  }

  function parseEvent(node) {
    const date = parseDate(childVal(node, 'DATE'));
    const placeRaw = childVal(node, 'PLAC');
    return {
      tag: node.tag,
      type: childVal(node, 'TYPE'),
      value: node.value.trim(),
      date,
      place: placeRaw,
      note: children(node, 'NOTE').map(n => n.value).join('\n'),
      age: childVal(node, 'AGE'),
    };
  }

  // ---------- model ----------
  function build(text) {
    const roots = parseTree(text);
    const notes = {};
    for (const r of roots) if (r.tag === 'NOTE' && r.xref) notes[r.xref] = r.value;
    const objects = {};
    for (const r of roots) if (r.tag === 'OBJE' && r.xref) objects[r.xref] = r;
    const tally = { refs: 0, images: 0, remote: 0, skipped: 0, broken: 0 };
    const resolveNote = n => (/^@[^@]+@$/.test(n.value.trim()) ? notes[ptr(n.value)] || '' : n.value);

    const people = new Map();
    const families = new Map();
    let header = {};

    for (const r of roots) {
      if (r.tag === 'HEAD') {
        header = { source: childVal(r, 'SOUR'), charset: childVal(r, 'CHAR'), version: (child(r, 'GEDC') && childVal(child(r, 'GEDC'), 'VERS')) || '' };
      } else if (r.tag === 'INDI' && r.xref) {
        const nameNode = child(r, 'NAME');
        const nameRaw = nameNode ? nameNode.value : '';
        let surname = nameNode ? childVal(nameNode, 'SURN') : '';
        let given = nameNode ? childVal(nameNode, 'GIVN') : '';
        const sm = /\/([^/]*)\//.exec(nameRaw);
        if (!surname && sm) surname = sm[1].trim();
        if (!given) given = nameRaw.replace(/\/[^/]*\//, ' ').replace(/\s+/g, ' ').trim();
        const nick = nameNode ? childVal(nameNode, 'NICK') : '';
        const p = {
          id: r.xref,
          given: given || '',
          surname: surname || '',
          name: (given + ' ' + surname).trim() || 'Unknown',
          nick,
          sex: (childVal(r, 'SEX') || 'U').toUpperCase()[0],
          events: [],
          famc: children(r, 'FAMC').map(n => ptr(n.value)),
          fams: children(r, 'FAMS').map(n => ptr(n.value)),
          notes: children(r, 'NOTE').map(resolveNote).filter(Boolean),
          occupation: '',
          media: [], photo: null,
          birth: null, death: null,
          living: true,
        };
        for (const c of r.children) {
          if (INDI_EVENTS.has(c.tag)) {
            const ev = parseEvent(c);
            ev.note = c.children.filter(x => x.tag === 'NOTE').map(resolveNote).join('\n');
            p.events.push(ev);
          }
        }
        for (const o of children(r, 'OBJE')) {
          tally.refs++;
          for (const m of parseObject(o, objects, tally)) {
            // the same file referenced twice (e.g. inline and by pointer) is one photo
            const dup = p.media.find(x => x.file === m.file);
            if (dup) { dup.primary = dup.primary || m.primary; dup.title = dup.title || m.title; continue; }
            p.media.push(m);
            tally.images++;
            if (m.remote) tally.remote++;
          }
        }
        p.photo = p.media.find(m => m.primary) || p.media[0] || null;
        p.birth = p.events.find(e => e.tag === 'BIRT') || p.events.find(e => e.tag === 'CHR' || e.tag === 'BAPM') || null;
        p.death = p.events.find(e => e.tag === 'DEAT') || p.events.find(e => e.tag === 'BURI' || e.tag === 'CREM') || null;
        const occ = p.events.find(e => e.tag === 'OCCU');
        p.occupation = occ ? occ.value : '';
        if (p.death || children(r, 'DEAT').length) p.living = false;
        people.set(p.id, p);
      } else if (r.tag === 'FAM' && r.xref) {
        const f = {
          id: r.xref,
          husb: ptr(childVal(r, 'HUSB')) || null,
          wife: ptr(childVal(r, 'WIFE')) || null,
          children: children(r, 'CHIL').map(n => ptr(n.value)),
          events: r.children.filter(c => FAM_EVENTS.has(c.tag)).map(parseEvent),
          notes: children(r, 'NOTE').map(resolveNote).filter(Boolean),
        };
        f.marriage = f.events.find(e => e.tag === 'MARR') || null;
        f.divorce = f.events.find(e => e.tag === 'DIV') || null;
        families.set(f.id, f);
      }
    }

    // Repair links both ways (many exporters only write one side).
    for (const f of families.values()) {
      for (const sid of [f.husb, f.wife]) {
        const s = people.get(sid);
        if (s && !s.fams.includes(f.id)) s.fams.push(f.id);
      }
      for (const cid of f.children) {
        const c = people.get(cid);
        if (c && !c.famc.includes(f.id)) c.famc.push(f.id);
      }
    }
    for (const p of people.values()) {
      for (const fid of p.famc) {
        const f = families.get(fid);
        if (f && !f.children.includes(p.id)) f.children.push(p.id);
      }
      p.famc = p.famc.filter(id => families.has(id));
      p.fams = p.fams.filter(id => families.has(id));
    }
    for (const f of families.values()) {
      f.children = f.children.filter(id => people.has(id));
      f.children.sort((a, b) => (yearOf(people.get(a), 'birth') ?? 9999) - (yearOf(people.get(b), 'birth') ?? 9999));
    }

    // Anyone born > 110 years ago without a death record is presumed deceased.
    const nowY = new Date().getFullYear();
    for (const p of people.values()) {
      const by = yearOf(p, 'birth');
      if (p.living && by != null && nowY - by > 110) p.living = false;
    }

    const tree = new FamilyTree(people, families, header);
    tree.mediaInfo = tally; // { refs, images, remote, skipped, broken } — how many photo references the file holds
    return tree;
  }

  function yearOf(p, which) {
    const e = p && p[which];
    return e && e.date ? e.date.year : null;
  }

  class FamilyTree {
    constructor(people, families, header) {
      this.people = people;
      this.families = families;
      this.header = header;
      this._estimates = new Map();
    }
    get(id) { return this.people.get(id); }
    fam(id) { return this.families.get(id); }
    parentFamily(p) { return p && p.famc.length ? this.fam(p.famc[0]) : null; }
    father(p) { const f = this.parentFamily(p); return f && f.husb ? this.get(f.husb) : null; }
    mother(p) { const f = this.parentFamily(p); return f && f.wife ? this.get(f.wife) : null; }
    parents(p) {
      const out = [];
      for (const fid of p.famc) { const f = this.fam(fid); if (!f) continue; for (const id of [f.husb, f.wife]) if (id && this.get(id) && !out.includes(this.get(id))) out.push(this.get(id)); }
      return out;
    }
    spouseIn(f, p) { const id = f.husb === p.id ? f.wife : f.husb; return id ? this.get(id) : null; }
    unions(p) { return p.fams.map(fid => this.fam(fid)).filter(Boolean).map(f => ({ family: f, spouse: this.spouseIn(f, p), children: f.children.map(id => this.get(id)) })); }
    spouses(p) { return this.unions(p).map(u => u.spouse).filter(Boolean); }
    children(p) { const out = []; for (const u of this.unions(p)) for (const c of u.children) if (!out.includes(c)) out.push(c); return out; }
    siblings(p) {
      const out = [];
      for (const fid of p.famc) { const f = this.fam(fid); if (!f) continue; for (const id of f.children) if (id !== p.id && !out.some(x => x.id === id)) out.push(this.get(id)); }
      return out.sort((a, b) => (this.birthYear(a) ?? 9999) - (this.birthYear(b) ?? 9999));
    }
    birthYear(p) { return yearOf(p, 'birth'); }
    deathYear(p) { return yearOf(p, 'death'); }
    // Rough birth year when missing: infer from relatives.
    estBirth(p) {
      const y = this.birthYear(p);
      if (y != null) return y;
      if (this._estimates.has(p.id)) return this._estimates.get(p.id);
      this._estimates.set(p.id, null);
      let est = null;
      const kids = this.children(p).map(c => this.birthYear(c)).filter(v => v != null);
      if (kids.length) est = Math.min(...kids) - 28;
      if (est == null) { const ps = this.parents(p).map(x => this.birthYear(x)).filter(v => v != null); if (ps.length) est = Math.max(...ps) + 28; }
      if (est == null) { const ss = this.spouses(p).map(x => this.birthYear(x)).filter(v => v != null); if (ss.length) est = ss[0]; }
      if (est == null) { const dy = this.deathYear(p); if (dy != null) est = dy - 65; }
      this._estimates.set(p.id, est);
      return est;
    }
    lifespan(p) {
      const b = this.birthYear(p), d = this.deathYear(p);
      if (b == null && d == null) return p.living ? '' : '';
      return `${b ?? '?'}–${d ?? (p.living ? '' : '?')}`;
    }
    ageAtDeath(p) { const b = this.birthYear(p), d = this.deathYear(p); return b != null && d != null ? d - b : null; }
    aliveIn(p, year) {
      const b = this.estBirth(p);
      if (b == null || year < b) return false;
      const d = this.deathYear(p);
      if (d != null) return year <= d;
      return p.living ? true : year <= b + 75;
    }
    ancestors(p, maxGen = 99) {
      const out = new Map(); // id -> generation
      let frontier = [[p, 0]];
      while (frontier.length) {
        const next = [];
        for (const [x, g] of frontier) for (const par of this.parents(x)) {
          if (!out.has(par.id) && g + 1 <= maxGen) { out.set(par.id, g + 1); next.push([par, g + 1]); }
        }
        frontier = next;
      }
      return out;
    }
    descendants(p, maxGen = 99) {
      const out = new Map();
      let frontier = [[p, 0]];
      while (frontier.length) {
        const next = [];
        for (const [x, g] of frontier) for (const c of this.children(x)) {
          if (!out.has(c.id) && g + 1 <= maxGen) { out.set(c.id, g + 1); next.push([c, g + 1]); }
        }
        frontier = next;
      }
      return out;
    }
    neighbors(p) {
      return [...this.parents(p).map(x => [x, 'parent']), ...this.children(p).map(x => [x, 'child']), ...this.spouses(p).map(x => [x, 'spouse'])];
    }
    // Shortest path over parent/child/spouse links.
    path(a, b) {
      if (a.id === b.id) return [{ person: a, rel: null }];
      const prev = new Map([[a.id, null]]);
      const q = [a];
      while (q.length) {
        const x = q.shift();
        for (const [n, rel] of this.neighbors(x)) {
          if (prev.has(n.id)) continue;
          prev.set(n.id, { from: x, rel });
          if (n.id === b.id) {
            const out = [];
            let cur = n;
            while (cur) { const pv = prev.get(cur.id); out.unshift({ person: cur, rel: pv ? pv.rel : null }); cur = pv ? pv.from : null; }
            return out;
          }
          q.push(n);
        }
      }
      return null;
    }
    // Blood relationship name of b relative to a ("b is a's ___").
    relationship(a, b) {
      if (!a || !b) return null;
      if (a.id === b.id) return { label: 'self', blood: true };
      if (this.spouses(a).some(s => s.id === b.id)) return { label: gender(b, 'husband', 'wife', 'spouse'), blood: false };
      const ancA = this.ancestors(a); ancA.set(a.id, 0);
      const ancB = this.ancestors(b); ancB.set(b.id, 0);
      let best = null;
      for (const [id, da] of ancA) if (ancB.has(id)) {
        const db = ancB.get(id);
        if (!best || da + db < best.da + best.db) best = { id, da, db };
      }
      if (best) return { label: kinName(best.da, best.db, b), blood: true, commonAncestor: this.get(best.id), da: best.da, db: best.db };
      // In-law: spouse's blood relative, or blood relative's spouse
      for (const s of this.spouses(a)) {
        const r = this.relationship2(s, b);
        if (r) return { label: r + ' (by marriage)', blood: false };
      }
      for (const s of this.spouses(b)) {
        const r = this.relationship2(a, s);
        if (r) return { label: kinName2Spouse(r, b), blood: false };
      }
      return null;
    }
    relationship2(a, b) {
      const ancA = this.ancestors(a); ancA.set(a.id, 0);
      const ancB = this.ancestors(b); ancB.set(b.id, 0);
      let best = null;
      for (const [id, da] of ancA) if (ancB.has(id)) { const db = ancB.get(id); if (!best || da + db < best.da + best.db) best = { da, db }; }
      return best ? kinName(best.da, best.db, b) : null;
    }
    stats() {
      const people = [...this.people.values()];
      const surnames = new Map(), givens = new Map(), places = new Map(), decades = new Map(), months = new Array(13).fill(0), occupations = new Map();
      const lifespans = [];
      let minY = Infinity, maxY = -Infinity;
      for (const p of people) {
        if (p.surname) surnames.set(p.surname, (surnames.get(p.surname) || 0) + 1);
        const first = p.given.split(/\s+/)[0];
        if (first) givens.set(first, (givens.get(first) || 0) + 1);
        for (const e of p.events) if (e.place) { const key = placeShort(e.place, 2); places.set(key, (places.get(key) || 0) + 1); }
        if (p.occupation) occupations.set(p.occupation, (occupations.get(p.occupation) || 0) + 1);
        const b = this.birthYear(p);
        if (b != null) { minY = Math.min(minY, b); maxY = Math.max(maxY, b); const dec = Math.floor(b / 10) * 10; decades.set(dec, (decades.get(dec) || 0) + 1); }
        if (p.birth && p.birth.date && p.birth.date.month) months[p.birth.date.month]++;
        const age = this.ageAtDeath(p);
        if (age != null && age >= 0 && age < 120) lifespans.push({ p, age });
      }
      const sortMap = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
      return {
        count: people.length, families: this.families.size,
        living: people.filter(p => p.living).length,
        surnames: sortMap(surnames), givens: sortMap(givens), places: sortMap(places), occupations: sortMap(occupations),
        decades: [...decades.entries()].sort((a, b) => a[0] - b[0]), months,
        lifespans: lifespans.sort((a, b) => b.age - a.age),
        minYear: minY === Infinity ? null : minY, maxYear: maxY === -Infinity ? null : maxY,
      };
    }
    // Pick a sensible "home" person: the most recent person with the deepest ancestry.
    guessHome() {
      let best = null, bestScore = -1;
      for (const p of this.people.values()) {
        const score = this.ancestors(p, 12).size * 10 + (this.birthYear(p) || 0) / 1000;
        if (score > bestScore) { best = p; bestScore = score; }
      }
      return best;
    }
  }

  function gender(p, m, f, u) { return p.sex === 'M' ? m : p.sex === 'F' ? f : u; }
  function greats(n) { return n <= 0 ? '' : n === 1 ? 'great-' : n === 2 ? 'great-great-' : `${n}× great-`; }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function kinName(da, db, b) {
    if (da === 0) {
      if (db === 1) return gender(b, 'son', 'daughter', 'child');
      return greats(db - 2) + gender(b, 'grandson', 'granddaughter', 'grandchild');
    }
    if (db === 0) {
      if (da === 1) return gender(b, 'father', 'mother', 'parent');
      return greats(da - 2) + gender(b, 'grandfather', 'grandmother', 'grandparent');
    }
    if (da === 1 && db === 1) return gender(b, 'brother', 'sister', 'sibling');
    if (da === 1) return (db === 2 ? '' : db === 3 ? 'grand-' : greats(db - 3) + 'grand-') + gender(b, 'nephew', 'niece', 'nibling');
    if (db === 1) return (da === 2 ? '' : da === 3 ? 'great-' : greats(da - 2)) + gender(b, 'uncle', 'aunt', 'pibling');
    const deg = Math.min(da, db) - 1, rem = Math.abs(da - db);
    const r = rem === 0 ? '' : rem === 1 ? ' once removed' : rem === 2 ? ' twice removed' : ` ${rem}× removed`;
    return `${ordinal(deg)} cousin${r}`;
  }
  function kinName2Spouse(r, b) {
    // r is how b's spouse relates to a; b married into that relationship
    const key = r.replace(/ \(by marriage\)$/, '');
    if (key === 'son' || key === 'daughter' || key === 'child') return gender(b, 'son-in-law', 'daughter-in-law', 'child-in-law');
    if (key === 'brother' || key === 'sister' || key === 'sibling') return gender(b, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    if (key === 'father' || key === 'mother' || key === 'parent') return gender(b, 'stepfather', 'stepmother', 'step-parent');
    if (/^(uncle|aunt|pibling)$/.test(key)) return gender(b, 'uncle', 'aunt', 'pibling') + ' by marriage';
    return `${key}'s ${gender(b, 'husband', 'wife', 'spouse')}`;
  }

  function placeShort(place, n = 1) {
    const parts = place.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length <= n) return parts.join(', ');
    return n === 1 ? parts[0] : parts[0] + ', ' + parts[parts.length - 1];
  }

  window.Gedcom = { decode, build, fileName, parseDate, formatDate, placeShort, EVENT_LABELS, MONTH_NAMES, gender };
})();
