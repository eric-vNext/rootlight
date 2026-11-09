// The "story page" side panel for the focused person. Exposes window.Panel.
(function () {
  const { esc } = U;
  const fd = d => Gedcom.formatDate(d);
  const link = p => `<a data-goto="${esc(p.id)}">${esc(p.name)}</a>`;
  const first = p => esc(p.given.split(' ')[0] || p.name);

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const num = n => NUM[n] || String(n);
  const datePhrase = d => !d || d.year == null ? '' : (d.day ? ' on ' : ' in ') + fd(d);
  const placePhrase = pl => pl ? ` in ${esc(pl)}` : '';

  // Writes a short biography from the facts we have.
  function story(t, p) {
    const he = Gedcom.gender(p, 'he', 'she', 'they'), He = he[0].toUpperCase() + he.slice(1);
    const his = Gedcom.gender(p, 'his', 'her', 'their');
    const was = p.sex === 'M' || p.sex === 'F' ? 'was' : 'were';
    const out = [];
    const par = t.parents(p);
    const b = p.birth;
    let s = `<b>${esc(p.name)}</b>`;
    if (b && (b.date || b.place)) s += ` ${was} ${b.tag === 'BIRT' ? 'born' : 'christened'}${datePhrase(b.date)}${placePhrase(b.place)}`;
    else s += ` ${was} born at a time and place not yet discovered`;
    if (par.length) {
      const fam = t.parentFamily(p);
      const sibs = fam ? fam.children : [];
      const order = sibs.indexOf(p.id);
      s += `, the ${Gedcom.gender(p, 'son', 'daughter', 'child')} of ${listJoin(par.map(link))}`;
      if (sibs.length > 1 && order >= 0) {
        const ord = ['eldest', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][order];
        s += order === sibs.length - 1 ? ` and the youngest of ${num(sibs.length)} children` : ord ? ` and the ${ord} of ${num(sibs.length)} children` : '';
      }
    }
    out.push(s + '.');

    if (p.occupation) out.push(`${He} worked as ${/^[aeiou]/i.test(p.occupation) ? 'an' : 'a'} ${esc(p.occupation.toLowerCase())}.`);
    for (const e of p.events.filter(e => e.tag === 'IMMI' || e.tag === 'EMIG')) {
      out.push(e.tag === 'IMMI'
        ? `${datePhrase(e.date) ? datePhrase(e.date).trim().replace(/^./, c => c.toUpperCase()) + ', ' + he : He} crossed the sea to begin a new life${placePhrase(e.place)}.`
        : `${He} emigrated${datePhrase(e.date)}${placePhrase(e.place)}.`);
    }

    const unions = t.unions(p);
    unions.forEach((u, i) => {
      let m = '';
      const md = u.family.marriage;
      if (u.spouse) {
        m = `${i === 0 ? He : `${He} later`} married ${link(u.spouse)}${md ? datePhrase(md.date) + placePhrase(md.place) : ''}`;
      } else if (u.children.length) m = `${He} had`;
      const kids = u.children;
      if (kids.length) {
        const names = kids.slice(0, 6).map(link);
        if (kids.length > 6) names.push(`${num(kids.length - 6)} more`);
        m += u.spouse ? `; together they had ${num(kids.length)} ${kids.length === 1 ? 'child' : 'children'}: ${listJoin(names)}` : ` ${num(kids.length)} ${kids.length === 1 ? 'child' : 'children'}: ${listJoin(names)}`;
      }
      if (u.family.divorce) m += `. The marriage ended in divorce${datePhrase(u.family.divorce.date)}`;
      if (m) out.push(m + '.');
    });

    const d = p.death;
    if (d && (d.date || d.place)) {
      const age = t.ageAtDeath(p);
      let ds = `${He} died${datePhrase(d.date)}${placePhrase(d.place)}`;
      if (age != null) ds += `, at the age of ${(p.birth.date.approx || d.date.approx) ? 'about ' : ''}${age}`;
      out.push(ds + '.');
      const bur = p.events.find(e => e.tag === 'BURI');
      if (bur && bur.place) out.push(`${He} ${was} laid to rest${placePhrase(bur.place)}.`);
    } else if (p.living) {
      const by = t.birthYear(p);
      if (by != null) out.push(`${He} turn${p.sex === 'U' ? '' : 's'} ${new Date().getFullYear() - by} this year.`);
    }

    // a dash of history
    const by = t.birthYear(p);
    if (by != null) {
      const ev = U.WORLD.find(w => Math.abs(w.y - by) <= 1 || (w.end && by >= w.y && by <= w.end));
      if (ev) out.push(`<span class="aside">${He} arrived in the world around the time of the ${esc(ev.label.replace(/^[A-Z]/, c => c.toLowerCase()).replace(/^first /i, 'First ').replace(/^second /i, 'Second '))}.</span>`);
    }
    return out.join(' ');
  }

  function facts(t, p) {
    const rows = [];
    const by = t.birthYear(p);
    const dy = t.deathYear(p) ?? (p.living ? new Date().getFullYear() : by != null ? by + 75 : null);
    const ageAt = y => by != null && y != null ? y - by : null;
    for (const e of p.events) {
      if (e.tag === 'OCCU' && !e.date) continue;
      const label = Gedcom.EVENT_LABELS[e.tag] || e.tag;
      const what = e.tag === 'EVEN' || e.tag === 'FACT' ? (e.type || label) : label;
      rows.push({ y: e.date && e.date.year, what: what + (e.value && e.tag !== 'OCCU' && e.value.length < 60 ? `: ${e.value}` : e.tag === 'OCCU' ? `: ${e.value}` : ''), where: e.place, when: fd(e.date) });
    }
    for (const u of t.unions(p)) {
      if (u.family.marriage) rows.push({ y: u.family.marriage.date && u.family.marriage.date.year, what: u.spouse ? `Married ${u.spouse.name}` : 'Married', where: u.family.marriage.place, when: fd(u.family.marriage.date), id: u.spouse && u.spouse.id });
      for (const c of u.children) {
        const cy = t.birthYear(c);
        if (cy != null) rows.push({ y: cy, what: `${Gedcom.gender(c, 'Son', 'Daughter', 'Child')} ${c.given.split(' ')[0] || c.name} born`, id: c.id, age: ageAt(cy) });
      }
    }
    for (const par of t.parents(p)) {
      const py = t.deathYear(par);
      if (py != null && by != null && py >= by) rows.push({ y: py, what: `${Gedcom.gender(par, 'Father', 'Mother', 'Parent')} ${par.given.split(' ')[0]} died`, id: par.id, age: ageAt(py) });
    }
    if (by != null && dy != null) for (const w of U.WORLD) if (w.y > by && w.y <= dy) rows.push({ y: w.y, what: w.label, world: true, age: ageAt(w.y) });
    rows.sort((a, b) => (a.y ?? 9999) - (b.y ?? 9999));
    if (!rows.length) return '<p class="empty-note">No dated events yet.</p>';
    return `<ul class="facts">${rows.map(r => `
      <li class="${r.world ? 'world-ev' : ''}">
        <span class="yr">${r.y ?? '—'}</span>
        <span>
          ${r.world ? `<div class="world">${esc(r.what)}${r.age != null ? ` · age ${r.age}` : ''}</div>` : `<div class="what">${r.id ? `<a data-goto="${esc(r.id)}">${esc(r.what)}</a>` : esc(r.what)}</div>`}
          ${!r.world && (r.where || (r.when && r.when !== String(r.y)) || r.age != null) ? `<div class="where">${esc([r.when && r.when !== String(r.y) ? r.when : '', r.where].filter(Boolean).join(' · '))}${r.age != null && !r.world ? `${r.where || (r.when && r.when !== String(r.y)) ? ' · ' : ''}age ${r.age}` : ''}</div>` : ''}
        </span>
      </li>`).join('')}</ul>`;
  }

  function kin(t, p) {
    const groups = [];
    const parents = t.parents(p);
    if (parents.length) groups.push(['Parents', parents.map(x => U.personChip(t, x, Gedcom.gender(x, 'Father', 'Mother', 'Parent')))]);
    for (const u of t.unions(p)) {
      const items = [];
      if (u.spouse) items.push(U.personChip(t, u.spouse, Gedcom.gender(u.spouse, 'Husband', 'Wife', 'Spouse') + (u.family.marriage && u.family.marriage.date && u.family.marriage.date.year ? ` · m. ${u.family.marriage.date.year}` : '')));
      for (const c of u.children) items.push(U.personChip(t, c, Gedcom.gender(c, 'Son', 'Daughter', 'Child')));
      groups.push([u.spouse ? `Family with ${u.spouse.given.split(' ')[0] || u.spouse.name}` : 'Children', items]);
    }
    const sibs = t.siblings(p);
    if (sibs.length) groups.push([`Siblings (${sibs.length})`, sibs.map(x => U.personChip(t, x, Gedcom.gender(x, 'Brother', 'Sister', 'Sibling')))]);
    if (!groups.length) return '<p class="empty-note">No family links recorded. A lone star!</p>';
    return groups.map(([label, items]) => `<div class="kin-group"><div class="kin-label">${esc(label)}</div><div class="kin">${items.join('')}</div></div>`).join('');
  }

  function pathBox(t, info) {
    const { a, b, path } = info;
    const rel = t.relationship(a, b);
    const steps = path.map((s, i) => {
      const via = i > 0 ? `<div class="via">${esc(s.rel === 'parent' ? `whose ${Gedcom.gender(s.person, 'father', 'mother', 'parent')} is` : s.rel === 'child' ? `whose ${Gedcom.gender(s.person, 'son', 'daughter', 'child')} is` : `married to`)}</div>` : '';
      return via + `<div class="step">${U.personChip(t, s.person, '')}</div>`;
    }).join('');
    return `<div class="p-section"><h3>How they're connected</h3><div class="path-box">
      <div class="path-lede">${link(b)} is ${first(a)}'s <b>${esc(rel ? rel.label : 'relative')}</b></div>
      ${rel && rel.commonAncestor ? `<div class="path-note">Common ancestor: ${link(rel.commonAncestor)}</div>` : ''}
      <div class="path-note">${path.length - 1} step${path.length === 2 ? '' : 's'} apart</div>
      <div class="path-steps">${steps}</div></div></div>`;
  }

  // Every photo of this person that was found, main photo first.
  function shotsOf(p) {
    const rec = App.photoMatch && App.photoMatch.byPerson.get(p.id);
    if (!rec) return [];
    const got = rec.items.filter(it => it.status === 'matched');
    got.sort((a, b) => (b === rec.cover) - (a === rec.cover));
    return got.map(it => ({ path: it.photo.path, name: it.photo.name, title: it.ref.title, who: p.name }));
  }
  function gallery(p) {
    const shots = shotsOf(p);
    if (!shots.length) return '';
    return `<div class="p-section"><h3>Photos</h3><div class="p-photos">${shots.map((s, i) =>
      `<button class="p-photo" data-shot="${i}" data-photo="${esc(s.path)}" title="${esc(s.title || s.name)}" aria-label="Open photo: ${esc(s.title || s.name)}"></button>`).join('')}</div></div>`;
  }

  function render(p, opts = {}) {
    const t = App.tree;
    const el = document.getElementById('panel');
    const home = App.home;
    const rel = home && home.id !== p.id ? t.relationship(home, p) : null;
    const b = p.birth && p.birth.date, d = p.death && p.death.date;
    // the vital dates, set as two ledger rows
    const life = [];
    if (b || p.birth) life.push(['Born', fd(b) || 'unknown']);
    if (d || p.death) life.push(['Died', fd(d) || 'unknown']);
    else if (p.living) life.push(['Now', 'living']);
    el.innerHTML = `
      <div class="p-hero">
        <div class="p-avatar ${p.id === App.homeId ? 'home' : ''}" style="--h:${U.surnameColor(p.surname)}"${U.photoAttr(p)}>${esc(U.initials(p))}</div>
        <h2 class="p-name">${esc(p.given || 'Unknown')} <span class="sur">${esc(p.surname)}</span></h2>
        ${p.nick ? `<div class="p-nick">“${esc(p.nick)}”</div>` : ''}
        ${p.id === App.homeId ? `<span class="p-rel home">Home person</span>` : rel ? `<span class="p-rel" title="Relationship to ${esc(home.name)}">${first(home)}'s ${esc(rel.label)}</span>` : home ? `<span class="p-rel none">No known link to ${first(home)}</span>` : ''}
        ${life.length ? `<dl class="p-life">${life.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        <div class="p-actions">
          ${p.id !== App.homeId ? `<button class="chip" data-act="path">Path from ${first(home)}</button>` : ''}
          <button class="chip" data-act="relate">Compare with…</button>
          ${p.id !== App.homeId ? `<button class="chip" data-act="home">Make home</button>` : ''}
          <button class="chip close" data-act="close" title="Close panel (S)">Close</button>
        </div>
      </div>
      ${opts.pathTo ? pathBox(t, opts.pathTo) : ''}
      <div class="p-section"><h3>Their story</h3><div class="p-story">${story(t, p)}</div></div>
      ${gallery(p)}
      ${p.notes.length ? `<div class="p-section"><h3>Notes</h3>${p.notes.map(n => `<p class="notes">${esc(n)}</p>`).join('')}</div>` : ''}
      <div class="p-section"><h3>Family</h3>${kin(t, p)}</div>
      <div class="p-section"><h3>Life &amp; times</h3>${facts(t, p)}</div>
      <div class="p-section p-meta">GEDCOM id ${esc(p.id)}</div>`;
    el.scrollTop = 0;
    const shots = shotsOf(p);
    el.querySelectorAll('[data-shot]').forEach(btn => btn.addEventListener('click', () => Photos.open(shots, +btn.dataset.shot)));
    el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const a = btn.dataset.act;
      if (a === 'home') App.setHome(p.id);
      if (a === 'relate') App.openRelate();
      if (a === 'path') App.showPath(App.home, p);
      if (a === 'close') App.togglePanel(true);
    }));
  }

  window.Panel = { render };
})();
