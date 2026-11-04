// River of time: the family's lifespans flowing beneath a cinematic strip of world history.
// A gold playhead marks the moment on screen; the hero above shows what the world was doing then,
// with a public-domain photograph, and who in the family was alive to see it.
window.TimelineView = (function () {
  let el, app, scope = 'line';
  let hero, heroImgs, heroFront = 0, headSvg, body, bodySvg;
  let x, rows = [], events = [], media = {}, current = null, playTimer = null, dragging = false;
  let shownFor = null, touched = false; // focus the current event was chosen for; whether the user has picked one
  const ROW = 28, RIGHT = 30, HEAD = 104;
  let LEFT = 150, GAP = 0; // on narrow screens generation labels sit above each group instead of in a left column
  const GEN = g => g === 0 ? 'Self & family' : g < 0 ? ['', 'Parents', 'Grandparents', 'Great-grandparents'][-g] || `${-g - 2}× great-grandparents` : ['', 'Children', 'Grandchildren', 'Great-grandchildren'][g] || `${g - 2}× great-grandchildren`;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PLAY = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>';
  const PAUSE = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z" fill="currentColor"/></svg>';
  const first = p => (p.given || p.name || '?').split(' ')[0];

  function init(container, ctx) {
    el = container; app = ctx;
    el.classList.add('rt');
    el.innerHTML = `
      <section class="rt-hero">
        <div class="rt-img"></div><div class="rt-img"></div>
        <div class="rt-veil"></div>
        <div class="rt-hero-body">
          <div class="rt-kicker"><span class="rt-era"></span><span class="rt-cat"></span></div>
          <div class="rt-year"></div>
          <h2 class="rt-title"></h2>
          <p class="rt-extract"></p>
          <div class="rt-lede"></div>
          <div class="rt-family"></div>
        </div>
        <div class="rt-nav">
          <button class="rt-prev" title="Previous event" aria-label="Previous event">‹</button>
          <button class="rt-play" title="Play through history" aria-label="Play through history">${PLAY}</button>
          <button class="rt-next" title="Next event" aria-label="Next event">›</button>
        </div>
        <div class="rt-credit"></div>
      </section>
      <div class="rt-ctl">
        <div class="seg"><button data-v="line" class="on">Direct line</button><button data-v="wide">Extended family</button></div>
        <span class="rt-hint">Drag the gold marker or tap a medallion to travel · hover to see everyone's age</span>
      </div>
      <div class="rt-head"><svg></svg></div>
      <div class="rt-body"><svg></svg></div>`;
    hero = d3.select(el).select('.rt-hero');
    heroImgs = hero.selectAll('.rt-img').nodes();
    headSvg = d3.select(el).select('.rt-head svg');
    body = d3.select(el).select('.rt-body');
    bodySvg = body.select('svg');

    d3.select(el).selectAll('.rt-ctl button').on('click', function () {
      scope = this.dataset.v;
      d3.select(el).selectAll('.rt-ctl button').classed('on', function () { return this.dataset.v === scope; });
      render(app.focus);
    });
    hero.select('.rt-prev').on('click', () => { stop(); touched = true; step(-1); });
    hero.select('.rt-next').on('click', () => { stop(); touched = true; step(1); });
    hero.select('.rt-play').on('click', () => playTimer ? stop() : play());

    World.imagery().then(m => {
      media = m;
      if (!rows.length) return;
      drawHead();
      // first visit: swap to a pictured moment if the opening pick had no photo
      const pic = current && media[current.wiki] && media[current.wiki].img;
      if (!touched && !pic) show(openingEvent(app.focus), { force: true });
      else if (current) show(current, { force: true });
    });
  }

  function people(focus) {
    const t = app.tree;
    const out = new Map();
    const add = (p, g) => { if (p && !out.has(p.id)) out.set(p.id, { p, g }); };
    for (const [id, g] of t.ancestors(focus, 7)) add(t.get(id), -g);
    add(focus, 0);
    for (const s of t.spouses(focus)) add(s, 0);
    for (const [id, g] of t.descendants(focus, 4)) add(t.get(id), g);
    if (scope === 'wide') {
      for (const s of t.siblings(focus)) add(s, 0);
      for (const [id, g] of t.ancestors(focus, 3)) for (const s of t.siblings(t.get(id))) add(s, -g);
      for (const [id, g] of t.descendants(focus, 3)) for (const s of t.spouses(t.get(id))) add(s, g);
      for (const s of t.siblings(focus)) for (const c of t.children(s)) add(c, 1);
    }
    return [...out.values()].filter(r => t.estBirth(r.p) != null)
      .sort((a, b) => a.g - b.g || t.estBirth(a.p) - t.estBirth(b.p));
  }

  function render(focus) {
    const t = app.tree;
    const now = new Date().getFullYear();
    rows = people(focus);
    rows.forEach(r => {
      const b = t.estBirth(r.p), d = t.deathYear(r.p);
      Object.assign(r, { b, d: d ?? (r.p.living ? now : b + 75), known: d != null || r.p.living, living: r.p.living && d == null, estB: t.birthYear(r.p) == null });
    });
    const w = app.visibleWidth(el);
    hero.style('width', w + 'px');
    d3.select(el).select('.rt-ctl').style('width', w + 'px');
    const narrow = w < 640;
    LEFT = narrow ? 14 : 150; GAP = narrow ? 18 : 0;
    if (!rows.length) { headSvg.selectAll('*').remove(); bodySvg.selectAll('*').remove(); return; }
    const lo = d3.min(rows, r => r.b) - 5, hi = Math.min(now + 5, d3.max(rows, r => r.d) + 5);
    x = d3.scaleLinear().domain([lo, hi]).range([LEFT, w - RIGHT]);
    events = World.EVENTS.filter(e => (e.end || e.y) >= lo && e.y <= hi);

    drawHead();
    drawBody(focus);

    // on a resize or scope change keep the event on screen; a new focus opens on a moment from their life
    const keep = shownFor === focus.id && events.includes(current) ? current : null;
    if (!keep) touched = false;
    shownFor = focus.id;
    show(keep || openingEvent(focus), { force: true });

    const fi = rows.findIndex(r => r.p.id === focus.id);
    if (fi >= 0) body.node().scrollTop = Math.max(0, rows[fi].top - body.node().clientHeight / 2);
  }

  function openingEvent(focus) {
    if (!events.length) return null;
    const r = rows.find(r => r.p.id === focus.id) || rows[0];
    const pictured = e => media[e.wiki] && media[e.wiki].img;
    const inLife = events.filter(e => e.y >= r.b + 8 && e.y <= r.d);
    const pool = [inLife.filter(pictured), inLife, events].find(l => l.length);
    const mid = (r.b + r.d) / 2;
    return pool.slice().sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid))[0];
  }

  // ---- header: era ribbon, event medallions, axis and the draggable playhead ----
  function drawHead() {
    const w = x.range()[1] + RIGHT;
    headSvg.attr('width', w).attr('height', HEAD).attr('viewBox', `0 0 ${w} ${HEAD}`);
    headSvg.selectAll('*').remove();
    const [lo, hi] = x.domain();
    const defs = headSvg.append('defs');
    defs.append('clipPath').attr('id', 'rt-round').attr('clipPathUnits', 'objectBoundingBox')
      .append('circle').attr('cx', .5).attr('cy', .5).attr('r', .5);

    // eras
    const eg = headSvg.append('g').attr('class', 'rt-eras');
    World.ERAS.filter(e => e.end > lo && e.y < hi).forEach((e, i) => {
      const x1 = x(Math.max(e.y, lo)), x2 = x(Math.min(e.end, hi));
      eg.append('rect').attr('class', i % 2 ? 'odd' : '').attr('x', x1).attr('y', 4).attr('width', Math.max(0, x2 - x1 - 1)).attr('height', 16).attr('rx', 4);
      if (x2 - x1 > e.name.length * 5.6 + 12) eg.append('text').attr('x', (x1 + x2) / 2).attr('y', 15.5).text(e.name);
    });

    // axis
    const AX = 80;
    headSvg.append('g').attr('class', 'tl-axis').attr('transform', `translate(0,${AX})`)
      .call(d3.axisBottom(x).ticks(Math.max(4, w / 90)).tickFormat(d3.format('d')).tickSize(5));

    // spans for long events
    const sg = headSvg.append('g');
    events.filter(e => e.end).forEach(e => {
      sg.append('rect').attr('class', 'rt-span').attr('x', x(e.y)).attr('y', AX - 3).attr('width', Math.max(3, x(e.end) - x(e.y))).attr('height', 4).attr('rx', 2)
        .attr('fill', catColor(e, 60));
    });

    // medallions in two lanes, falling back to a pin when crowded
    const R = 13, lanes = [[], []], LY = [38, 62];
    const mg = headSvg.append('g').attr('class', 'rt-medals');
    events.forEach(e => {
      const cx = Math.max(R + 3, Math.min(w - R - 3, x(e.y)));
      const lane = [0, 1].find(l => !lanes[l].some(px => Math.abs(px - cx) < R * 2 + 3));
      const g = mg.append('g').attr('class', 'rt-medal').datum(e)
        .attr('transform', `translate(${cx},${lane == null ? AX - 6 : LY[lane]})`)
        .on('click', () => { stop(); touched = true; show(e); })
        .on('mouseenter', ev => U.tip(`<b>${e.y}${e.end ? '–' + e.end : ''}</b> · ${U.esc(e.label)}`, ev))
        .on('mousemove', ev => U.moveTip(ev)).on('mouseleave', U.hideTip);
      if (lane == null) { g.append('circle').attr('class', 'pin').attr('r', 3.5).attr('fill', catColor(e, 60)); return; }
      lanes[lane].push(cx);
      g.append('line').attr('class', 'stem').attr('y1', R).attr('y2', AX - LY[lane]);
      g.append('circle').attr('class', 'ring').attr('r', R + 2).attr('stroke', catColor(e, 60));
      const m = media[e.wiki];
      if (m && m.thumb) g.append('image').attr('href', m.thumb).attr('x', -R).attr('y', -R).attr('width', R * 2).attr('height', R * 2)
        .attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', 'url(#rt-round)');
      else {
        g.append('circle').attr('class', 'blank').attr('r', R).attr('fill', catColor(e, 16));
        g.append('text').attr('class', 'glyph').attr('y', 4.5).text(e.label[0]).attr('fill', catColor(e, 70));
      }
    });

    // playhead
    const ph = headSvg.append('g').attr('class', 'rt-playhead');
    ph.append('line').attr('y1', 22).attr('y2', HEAD);
    ph.append('rect').attr('class', 'knob').attr('x', -22).attr('y', AX + 6).attr('width', 44).attr('height', 17).attr('rx', 8.5);
    ph.append('text').attr('y', AX + 18.5).attr('text-anchor', 'middle');
    const drag = d3.drag()
      .on('start', () => { stop(); touched = true; dragging = true; headSvg.classed('dragging', true); })
      .on('drag', ev => {
        const yr = Math.round(x.invert(Math.max(x.range()[0], Math.min(x.range()[1], ev.x))));
        movePlayhead(yr, false);
        const e = nearest(yr);
        if (e && e !== current) show(e, { keepHead: true });
      })
      .on('end', () => { dragging = false; headSvg.classed('dragging', false); if (current) movePlayhead(current.y, true); });
    ph.call(drag);
    headSvg.on('click', ev => {
      if (ev.target.closest('.rt-medal, .rt-playhead')) return;
      const [mx] = d3.pointer(ev);
      if (mx < LEFT) return;
      stop(); touched = true;
      const e = nearest(x.invert(mx));
      if (e) show(e);
    });
  }

  // ---- body: lifespans on a backdrop of eras and wars ----
  function drawBody(focus) {
    const t = app.tree;
    const w = x.range()[1] + RIGHT;
    const [lo, hi] = x.domain();
    let k = 0;
    rows.forEach((r, i) => { if (i && r.g !== rows[i - 1].g) k++; r.top = i * ROW + (GAP ? (k + 1) * GAP : 0); });
    const h = Math.max(rows[rows.length - 1].top + ROW + 40, body.node().clientHeight);
    bodySvg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`).style('height', h + 'px');
    bodySvg.selectAll('*').remove();
    const defs = bodySvg.append('defs');
    const hatch = defs.append('pattern').attr('id', 'rt-hatch').attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    hatch.append('line').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 7).attr('class', 'rt-hatch-line');
    const glow = defs.append('filter').attr('id', 'rt-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'b');
    const fm = glow.append('feMerge'); fm.append('feMergeNode').attr('in', 'b'); fm.append('feMergeNode').attr('in', 'SourceGraphic');

    const bg = bodySvg.append('g').attr('class', 'rt-bg');
    World.ERAS.filter(e => e.end > lo && e.y < hi).forEach((e, i) => {
      if (i % 2) bg.append('rect').attr('class', 'rt-era-col').attr('x', x(Math.max(e.y, lo))).attr('width', x(Math.min(e.end, hi)) - x(Math.max(e.y, lo))).attr('y', 0).attr('height', h);
    });
    events.filter(e => e.end && e.cat === 'war').forEach(e => {
      bg.append('rect').attr('class', 'rt-war').attr('x', x(e.y)).attr('width', x(e.end) - x(e.y)).attr('y', 0).attr('height', h);
    });
    bg.append('g').attr('class', 'tl-grid').selectAll('line').data(x.ticks(Math.max(4, w / 90))).join('line')
      .attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', 0).attr('y2', h);

    let lastG = null;
    const gl = bodySvg.append('g');
    rows.forEach((r, i) => {
      if (r.g === lastG) return;
      lastG = r.g;
      gl.append('text').attr('class', 'tl-gen').attr('x', GAP ? LEFT : 16).attr('y', r.top + (GAP ? 8 : 27)).text(GEN(r.g));
      const ly = r.top + (GAP ? -4 : 10);
      if (i) gl.append('line').attr('x1', GAP ? LEFT : 16).attr('x2', w - RIGHT).attr('y1', ly).attr('y2', ly).attr('stroke', U.css('--line'));
    });

    const dur = still() ? 0 : 600;
    const g = bodySvg.append('g').attr('class', 'rt-rows');
    rows.forEach((r, i) => {
      const y = r.top + 14;
      const col = U.surnameColor(r.p.surname, U.isNight() ? 52 : 50);
      const gid = `rtg-${i}`;
      const lg = defs.append('linearGradient').attr('id', gid);
      lg.append('stop').attr('offset', '0%').attr('stop-color', col).attr('stop-opacity', r.estB ? 0.12 : 0.95);
      lg.append('stop').attr('offset', r.estB ? '25%' : '0%').attr('stop-color', col).attr('stop-opacity', 0.95);
      lg.append('stop').attr('offset', r.known ? '100%' : '65%').attr('stop-color', col).attr('stop-opacity', 0.95);
      lg.append('stop').attr('offset', '100%').attr('stop-color', col).attr('stop-opacity', r.known ? 0.95 : 0.05);

      const row = g.append('g').attr('class', `tl-row ${r.p.id === focus.id ? 'focus' : ''}`).datum(r)
        .on('click', () => app.go(r.p.id));
      const bw = Math.max(4, x(r.d) - x(r.b));
      r.y = y; r.bw = bw;
      row.append('rect').attr('x', LEFT - 4).attr('width', w).attr('y', y - 1).attr('height', ROW - 4).attr('fill', 'transparent');
      row.append('rect').attr('class', 'tl-bar').attr('x', x(r.b)).attr('y', y + 2).attr('height', ROW - 10).attr('rx', 9)
        .attr('fill', `url(#${gid})`).attr('stroke', r.p.id === focus.id ? U.css('--gold') : 'none').attr('stroke-width', 2)
        .attr('width', 0).transition().duration(dur).delay(i * 14).ease(d3.easeCubicOut).attr('width', bw);
      if (r.living) row.append('text').attr('x', x(r.d) + 4).attr('y', y + 16).attr('fill', col).style('font-size', '11px').text('▸');
      for (const u of t.unions(r.p)) {
        const my = u.family.marriage && u.family.marriage.date && u.family.marriage.date.year;
        if (my) row.append('circle').attr('cx', x(my)).attr('cy', y + ROW / 2 - 2).attr('r', 3.5).attr('fill', 'none').attr('stroke', U.css('--gold')).attr('stroke-width', 1.5)
          .append('title').text(`Married ${u.spouse ? u.spouse.name : ''} in ${my}`);
      }
      const label = `${r.p.name}  ${t.lifespan(r.p)}`;
      const lw = label.length * 6.4;
      const inside = bw > lw + 16;
      // outside labels go after the bar, or before it when they would run off the right edge
      const before = !inside && x(r.d) + 16 + lw > w - 4 && x(r.b) - 6 - lw > LEFT;
      row.append('text').attr('class', 'tl-name').attr('x', inside ? x(r.b) + 9 : before ? x(r.b) - 6 : x(r.d) + (r.living ? 16 : 6)).attr('y', y + 16)
        .attr('text-anchor', before ? 'end' : null)
        .style('fill', inside ? (U.isNight() ? '#0b1024' : '#fff') : null).text(label);
      const age = row.append('g').attr('class', 'rt-age').style('display', 'none');
      age.append('rect').attr('y', y + 3).attr('height', ROW - 12).attr('rx', (ROW - 12) / 2);
      age.append('text').attr('y', y + 15.5).attr('text-anchor', 'middle');
      row.on('mouseenter', e => U.tip(U.tipHtml(t, r.p, r.estB ? 'Birth year estimated from relatives' : ''), e)).on('mousemove', e => U.moveTip(e)).on('mouseleave', U.hideTip);
    });

    const ph = bodySvg.append('g').attr('class', 'rt-playhead body').style('pointer-events', 'none');
    ph.append('line').attr('y1', 0).attr('y2', h).attr('filter', 'url(#rt-glow)');

    // a faint hover cursor that previews ages in any year without moving the playhead
    const cursor = bodySvg.append('g').attr('class', 'tl-cursor').style('display', 'none').style('pointer-events', 'none');
    cursor.append('line').attr('y1', 0).attr('y2', h);
    const ct = cursor.append('text').attr('y', 12).attr('x', 5);
    bodySvg.on('mousemove.cursor', e => {
      const [mx] = d3.pointer(e);
      if (mx < LEFT) { cursor.style('display', 'none'); spotlight(current && current.y); return; }
      const yr = Math.round(x.invert(mx));
      cursor.style('display', null).attr('transform', `translate(${x(yr)},0)`);
      ct.text(yr);
      spotlight(yr);
    }).on('mouseleave.cursor', () => { cursor.style('display', 'none'); spotlight(current && current.y); });
    bodySvg.on('click.travel', e => {
      if (e.target.closest('.tl-row')) return;
      const [mx] = d3.pointer(e);
      if (mx < LEFT) return;
      stop(); touched = true;
      const ev = nearest(x.invert(mx));
      if (ev) show(ev);
    });
  }

  // Light up the bars of everyone alive in a year and badge their age at that point.
  function spotlight(yr) {
    bodySvg.selectAll('.tl-row').each(function (r) {
      const row = d3.select(this);
      const alive = yr != null && yr >= r.b && yr <= r.d;
      row.classed('alive', alive).classed('dim', yr != null && !alive);
      const age = row.select('.rt-age');
      if (!alive) { age.style('display', 'none'); return; }
      const label = `${r.estB ? '~' : ''}${yr - r.b}`;
      const bw = label.length * 6.5 + 12;
      const cx = Math.max(x(r.b) + bw / 2, Math.min(x(r.b) + r.bw - bw / 2, x(yr)));
      age.style('display', null);
      age.select('rect').attr('x', cx - bw / 2).attr('width', bw);
      age.select('text').attr('x', cx).text(label);
    });
  }

  function movePlayhead(yr, animate) {
    const px = x(yr);
    const sel = d3.select(el).selectAll('.rt-playhead');
    (animate && !still() ? sel.transition().duration(700).ease(d3.easeCubicInOut) : sel.interrupt()).attr('transform', `translate(${px},0)`);
    headSvg.select('.rt-playhead text').text(yr);
    spotlight(yr);
  }

  function nearest(yr) {
    const dist = e => yr < e.y ? e.y - yr : e.end && yr <= e.end ? 0 : yr - (e.end || e.y);
    return events.slice().sort((a, b) => dist(a) - dist(b) || a.y - b.y)[0];
  }

  function step(dir) {
    if (!events.length) return;
    const i = events.indexOf(current);
    const e = events[Math.max(0, Math.min(events.length - 1, i + dir))];
    if (e !== current) show(e);
    return e;
  }

  function play() {
    if (!events.length) return;
    touched = true;
    hero.select('.rt-play').html(PAUSE).attr('title', 'Pause');
    el.classList.add('playing');
    if (current === events[events.length - 1]) show(events[0]);
    const tick = () => {
      if (!el.classList.contains('active')) return stop();
      const i = events.indexOf(current);
      if (i >= events.length - 1) return stop();
      show(events[i + 1]);
      playTimer = setTimeout(tick, 6500);
    };
    playTimer = setTimeout(tick, 4500);
  }

  function stop() {
    clearTimeout(playTimer); playTimer = null;
    if (hero) hero.select('.rt-play').html(PLAY).attr('title', 'Play through history');
    el && el.classList.remove('playing');
  }

  // ---- hero ----
  function show(e, opts = {}) {
    if (!e) {
      hero.classed('empty', true);
      return;
    }
    hero.classed('empty', false);
    const changed = e !== current || opts.force;
    current = e;
    if (!opts.keepHead) movePlayhead(e.y, !opts.force);
    headSvg.selectAll('.rt-medal').classed('on', d => d === e);
    if (!changed) return;

    const m = media[e.wiki] || {};
    const era = World.eraAt(e.y);
    const cat = World.CATS[e.cat];
    hero.style('--cat', catColor(e, 55));
    hero.select('.rt-era').text(era ? era.name : '');
    hero.select('.rt-cat').text(cat ? cat.name : '');
    hero.select('.rt-year').text(e.end ? `${e.y}–${String(e.end).slice(-2)}` : e.y);
    hero.select('.rt-title').text(e.label);
    hero.select('.rt-extract').html(m.extract ? `${U.esc(m.extract)} <a href="${U.esc(m.page)}" target="_blank" rel="noopener">Wikipedia ↗</a>` : '');
    const cr = m.credit;
    hero.select('.rt-credit').html(m.img && cr ? `<a href="${U.esc(cr.page)}" target="_blank" rel="noopener">${cr.artist ? U.esc(cr.artist) + ' · ' : ''}${U.esc(cr.license)} · Wikimedia Commons</a>` : '');
    family(e);
    swapImage(e, m.img);

    // replay the text entrance
    const bodyEl = hero.select('.rt-hero-body').node();
    bodyEl.classList.remove('enter'); void bodyEl.offsetWidth; bodyEl.classList.add('enter');

    // warm the neighbours so stepping feels instant
    const i = events.indexOf(e);
    for (const n of [events[i - 1], events[i + 1]]) if (n && media[n.wiki] && media[n.wiki].img) new Image().src = media[n.wiki].img;
  }

  function swapImage(e, src) {
    const back = heroImgs[1 - heroFront], front = heroImgs[heroFront];
    const h = U.hash(e.label);
    back.style.setProperty('--kx', `${(h % 7) - 3}%`);
    back.style.setProperty('--ky', `${((h >> 3) % 5) - 2}%`);
    const reveal = () => {
      if (current !== e) return;
      back.classList.add('on'); front.classList.remove('on');
      heroFront = 1 - heroFront;
    };
    if (!src) {
      back.style.backgroundImage = '';
      back.classList.add('art');
      reveal();
      return;
    }
    back.classList.remove('art');
    const img = new Image();
    img.onload = () => { back.style.backgroundImage = `url("${src}")`; reveal(); };
    img.onerror = () => { back.style.backgroundImage = ''; back.classList.add('art'); reveal(); };
    img.src = src;
  }

  function family(e) {
    const Y = e.y;
    const alive = rows.filter(r => Y >= r.b && Y <= r.d)
      .sort((a, b) => Math.abs(a.g) - Math.abs(b.g) || a.g - b.g || a.b - b.b);
    const focusId = app.focusId;
    const anchor = alive.find(r => r.p.id === focusId) || alive[0];
    let lede;
    if (anchor) {
      const age = Y - anchor.b;
      const ageTxt = age === 0 ? 'a newborn' : `${anchor.estB ? 'about ' : ''}${age}`;
      const others = alive.length - 1;
      lede = `${e.end ? 'When it began' : 'When it happened'}, <b>${U.esc(first(anchor.p))}</b> was ${ageTxt}` +
        (others ? ` — and ${others} more of the family ${others === 1 ? 'was' : 'were'} alive to see it.` : '.');
    } else {
      const later = rows.filter(r => r.b > Y).sort((a, b) => a.b - b.b)[0];
      const earlier = rows.filter(r => r.d < Y).sort((a, b) => b.d - a.d)[0];
      lede = later ? `No one in this line had been born yet. <b>${U.esc(first(later.p))}</b> arrives ${later.b - Y} years later.`
        : earlier ? `It came ${Y - earlier.d} years after <b>${U.esc(first(earlier.p))}</b> died.` : '';
    }
    // family moments in the very same year
    const t = app.tree;
    const moments = [];
    for (const r of rows) {
      if (t.birthYear(r.p) === Y) moments.push(`${first(r.p)} was born`);
      if (t.deathYear(r.p) === Y) moments.push(`${first(r.p)} died`);
      for (const u of t.unions(r.p)) {
        const my = u.family.marriage && u.family.marriage.date && u.family.marriage.date.year;
        if (my === Y && (!u.spouse || r.p.id < u.spouse.id || !rows.some(q => q.p === u.spouse))) moments.push(`${first(r.p)} married${u.spouse ? ' ' + first(u.spouse) : ''}`);
      }
    }
    if (moments.length) lede += `<span class="rt-also">Also in ${Y}: ${U.esc(moments.slice(0, 3).join(' · '))}</span>`;
    hero.select('.rt-lede').html(lede);

    // one row of chips, as many as fit
    const MAX = Math.max(2, Math.floor(hero.select('.rt-hero-body').node().clientWidth / 84) - 1);
    hero.select('.rt-family').html(alive.slice(0, MAX).map(r => {
      const age = Y - r.b;
      return `<button class="rt-chip" data-goto="${U.esc(r.p.id)}" title="${U.esc(r.p.name)}">
        <span class="dot" style="background:${U.avatarBg(r.p)}">${U.esc(U.initials(r.p))}</span>
        <span class="nm">${U.esc(first(r.p))}</span><span class="ag">${r.estB ? '~' : ''}${age}</span></button>`;
    }).join('') + (alive.length > MAX ? `<span class="rt-more">+${alive.length - MAX}</span>` : ''));
  }

  function catColor(e, l) {
    const c = World.CATS[e.cat];
    return `hsl(${c ? c.hue : 40} 70% ${l}%)`;
  }

  return {
    init, render,
    onResize() { if (app && app.focus && el.classList.contains('active')) render(app.focus); },
    hint: '',
  };
})();
