// Family almanac: stats, fun facts, name clouds, and "on this day".
window.AlmanacView = (function () {
  let el, app;
  const { esc } = U;

  function init(container, ctx) {
    el = container; app = ctx;
    el.addEventListener('click', e => {
      const s = e.target.closest('[data-search]');
      if (s) {
        document.getElementById('search-btn').click();
        const inp = document.getElementById('palette-input');
        inp.value = s.dataset.search;
        inp.dispatchEvent(new Event('input'));
      }
    });
  }

  const country = pl => { const p = (pl || '').split(',').map(s => s.trim()).filter(Boolean); return p[p.length - 1] || null; };

  function funFacts(t) {
    const facts = [];
    const people = [...t.people.values()];
    let big = null;
    for (const f of t.families.values()) if (!big || f.children.length > big.children.length) big = f;
    if (big && big.children.length > 1) {
      const names = [big.husb, big.wife].map(id => t.get(id)).filter(Boolean);
      facts.push(['👨‍👩‍👧‍👦', `Biggest family`, `${names.map(p => `<a data-goto="${esc(p.id)}">${esc(p.given.split(' ')[0])}</a>`).join(' &amp; ')} ${esc(names[0] ? names[0].surname : '')} raised <b>${big.children.length}</b> children`]);
    }
    const oldest = people.filter(p => t.birthYear(p) != null).sort((a, b) => t.birthYear(a) - t.birthYear(b))[0];
    if (oldest) facts.push(['🕰️', 'Earliest ancestor on record', `<a data-goto="${esc(oldest.id)}">${esc(oldest.name)}</a>, born ${esc(Gedcom.formatDate(oldest.birth.date))}`]);
    const home = app.home;
    if (home) {
      const anc = t.ancestors(home);
      const deep = anc.size ? Math.max(...anc.values()) : 0;
      facts.push(['🌳', 'Generations deep', `${esc(home.given.split(' ')[0])}'s tree reaches back <b>${deep}</b> generation${deep === 1 ? '' : 's'} with <b>${anc.size}</b> known ancestors`]);
    }
    const movers = people.filter(p => p.birth && p.death && p.birth.place && p.death.place && country(p.birth.place) !== country(p.death.place));
    if (movers.length) facts.push(['🧳', 'Voyagers', `<b>${movers.length}</b> ${movers.length === 1 ? 'person' : 'people'} died in a different country than they were born — like <a data-goto="${esc(movers[0].id)}">${esc(movers[0].name)}</a> (${esc(country(movers[0].birth.place))} → ${esc(country(movers[0].death.place))})`]);
    const multi = people.filter(p => t.spouses(p).length > 1).sort((a, b) => t.spouses(b).length - t.spouses(a).length)[0];
    if (multi) facts.push(['💍', 'Most marriages', `<a data-goto="${esc(multi.id)}">${esc(multi.name)}</a> married <b>${t.spouses(multi).length}</b> times`]);
    let young = null;
    for (const p of people) {
      const by = t.birthYear(p); if (by == null) continue;
      for (const c of t.children(p)) { const cy = t.birthYear(c); if (cy != null && cy - by >= 14 && (!young || cy - by < young.age)) young = { p, c, age: cy - by }; }
    }
    if (young) facts.push(['🍼', 'Youngest parent', `<a data-goto="${esc(young.p.id)}">${esc(young.p.name)}</a> was ${young.age} when <a data-goto="${esc(young.c.id)}">${esc(young.c.given.split(' ')[0])}</a> was born`]);
    return facts;
  }

  function onThisDay(t) {
    const now = new Date(), m = now.getMonth() + 1, d = now.getDate();
    const hits = [], soon = [];
    for (const p of t.people.values()) {
      for (const e of p.events) {
        if (!e.date || !e.date.month || !e.date.day) continue;
        if (e.date.month === m && e.date.day === d) hits.push({ p, e });
        else if (e.tag === 'BIRT') {
          const next = new Date(now.getFullYear(), e.date.month - 1, e.date.day);
          if (next < now) next.setFullYear(now.getFullYear() + 1);
          soon.push({ p, e, days: Math.round((next - now) / 864e5) });
        }
      }
    }
    soon.sort((a, b) => a.days - b.days);
    const label = e => ({ BIRT: 'born', DEAT: 'died', MARR: 'married' }[e.tag] || (Gedcom.EVENT_LABELS[e.tag] || e.tag).toLowerCase());
    let html = `<div class="otd">Today is ${Gedcom.MONTH_NAMES[m]} ${d}.</div>`;
    if (hits.length) html += hits.slice(0, 6).map(h => U.personChip(t, h.p, `${label(h.e)} on this day in ${h.e.date.year}`)).join('');
    else html += `<div style="color:var(--ink-3);margin:6px 0 4px">No anniversaries today. Coming up:</div>` + soon.slice(0, 4).map(s => U.personChip(t, s.p, `birthday in ${s.days} day${s.days === 1 ? '' : 's'} · born ${s.e.date.year}`)).join('');
    return html;
  }

  function hist(decades) {
    if (!decades.length) return '<p style="color:var(--ink-3)">No birth years.</p>';
    const W = 600, H = 130;
    const max = d3.max(decades, d => d[1]);
    const bw = W / decades.length;
    return `<svg viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="none">${decades.map(([dec, n], i) => {
      const h = n / max * H;
      return `<rect x="${i * bw + 1}" y="${H - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2"><title>${dec}s: ${n} born</title></rect>${decades.length < 26 || i % 3 === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 13}" text-anchor="middle">${dec}</text>` : ''}`;
    }).join('')}</svg>`;
  }

  function wheel(months) {
    const vals = months.slice(1), max = Math.max(1, ...vals);
    const R = 100, r0 = 26;
    const arc = d3.arc();
    const paths = vals.map((v, i) => {
      const a1 = i / 12 * Math.PI * 2, a2 = (i + 1) / 12 * Math.PI * 2;
      const d = arc({ innerRadius: r0, outerRadius: r0 + (R - r0) * (v / max), startAngle: a1 + 0.02, endAngle: a2 - 0.02 });
      const mid = (a1 + a2) / 2;
      return `<path d="${d}" fill="${U.centuryColor(i / 11)}" opacity=".85"><title>${Gedcom.MONTH_NAMES[i + 1]}: ${v}</title></path>
        <text x="${Math.sin(mid) * (R + 12)}" y="${-Math.cos(mid) * (R + 12) + 4}" text-anchor="middle" style="font:10px Inter;fill:var(--ink-3)">${Gedcom.MONTH_NAMES[i + 1][0]}</text>`;
    }).join('');
    return `<svg viewBox="-125 -125 250 250">${paths}<circle r="${r0 - 4}" fill="none" stroke="var(--line-strong)"/></svg>`;
  }

  function rank(items, fmt, max) {
    const top = items.slice(0, max || 8);
    const hi = top.length ? top[0][1] : 1;
    return `<ol class="rank">${top.map(([k, v]) => `<li>${fmt(k, v)}<span class="bar" style="width:${Math.max(4, v / hi * 60)}px"></span><span class="cnt">${v}</span></li>`).join('')}</ol>`;
  }

  function render() {
    const t = app.tree;
    const s = t.stats();
    const span = s.minYear != null ? s.maxYear - s.minYear : 0;
    const countries = new Set([...t.people.values()].flatMap(p => p.events.map(e => country(e.place)).filter(Boolean)));
    const sMax = s.surnames.length ? s.surnames[0][1] : 1;
    const cloud = s.surnames.slice(0, 60).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([n, c]) => `<button data-search="${esc(n)}" style="font-size:${13 + 22 * Math.sqrt(c / sMax)}px;color:${U.surnameColor(n)}" title="${c} ${c === 1 ? 'person' : 'people'}">${esc(n)}</button>`).join('');
    const avg = s.lifespans.length ? Math.round(d3.mean(s.lifespans, l => l.age)) : null;
    const fname = app.fileName.replace(/\.(ged|gedcom)$/i, '');

    el.innerHTML = `<div class="almanac">
      <h1 class="alm-title">The ${esc(fname.replace(/^the /i, ''))} Almanac</h1>
      <p class="alm-sub">${s.minYear != null ? `${span} years of family history, from ${s.minYear} to ${s.maxYear}.` : 'A family history.'}</p>
      <div class="alm-grid">
        <div class="alm-card wide"><div class="big-stats">
          <div class="big-stat"><div class="n">${s.count.toLocaleString()}</div><div class="l">people</div></div>
          <div class="big-stat"><div class="n">${s.families.toLocaleString()}</div><div class="l">families</div></div>
          <div class="big-stat"><div class="n">${s.surnames.length}</div><div class="l">surnames</div></div>
          <div class="big-stat"><div class="n">${countries.size}</div><div class="l">countries</div></div>
          <div class="big-stat"><div class="n">${avg ?? '—'}</div><div class="l">average lifespan</div></div>
          <div class="big-stat"><div class="n">${s.living}</div><div class="l">presumed living</div></div>
        </div></div>
        <div class="alm-card wide"><h3>Fun facts</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
          ${funFacts(t).map(([ic, title, body]) => `<div style="display:flex;gap:12px"><div style="font-size:24px">${ic}</div><div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-3)">${title}</div><div class="serif" style="font-size:14.5px">${body}</div></div></div>`).join('')}
        </div></div>
        <div class="alm-card"><h3>On this day</h3>${onThisDay(t)}</div>
        <div class="alm-card"><h3>Surnames</h3><div class="cloud">${cloud || '<span style="color:var(--ink-3)">None recorded</span>'}</div></div>
        <div class="alm-card"><h3>Birth months</h3><div class="wheel">${wheel(s.months)}</div></div>
        <div class="alm-card wide hist"><h3>Births by decade</h3>${hist(s.decades)}</div>
        <div class="alm-card"><h3>Longest lives</h3><ol class="rank">${s.lifespans.slice(0, 8).map(l => `<li><button data-goto="${esc(l.p.id)}">${esc(l.p.name)}</button><span class="cnt">${l.age} yrs</span></li>`).join('') || '<li style="color:var(--ink-3)">Not enough dates</li>'}</ol></div>
        <div class="alm-card"><h3>Favourite first names</h3>${rank(s.givens, k => `<button data-search="${esc(k)}">${esc(k)}</button>`)}</div>
        <div class="alm-card"><h3>Places</h3>${rank(s.places, k => `<button data-search="${esc(k.split(',')[0])}">${esc(k)}</button>`)}</div>
        ${s.occupations.length ? `<div class="alm-card"><h3>Occupations</h3>${rank(s.occupations, k => `<button data-search="${esc(k)}">${esc(k)}</button>`)}</div>` : ''}
      </div>
      <p style="color:var(--ink-3);font-size:12px;margin-top:30px">Source: ${esc(t.header.source || 'unknown')}${t.header.version ? ` · GEDCOM ${esc(t.header.version)}` : ''}${t.header.charset ? ` · ${esc(t.header.charset)}` : ''}</p>
    </div>`;
  }

  return { init, render, hint: '' };
})();
