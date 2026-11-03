// River of time: lifespans of the focus person's line against a backdrop of world history.
window.TimelineView = (function () {
  let el, app, head, body, bodySvg, headSvg, scope = 'line';
  const ROW = 26, LEFT = 150, RIGHT = 30;
  const GEN = g => g === 0 ? 'Self & family' : g < 0 ? ['', 'Parents', 'Grandparents', 'Great-grandparents'][-g] || `${-g - 2}× great-grandparents` : ['', 'Children', 'Grandchildren', 'Great-grandchildren'][g] || `${g - 2}× great-grandchildren`;

  function init(container, ctx) {
    el = container; app = ctx;
    el.style.display = 'flex'; el.style.flexDirection = 'column';
    const ctl = d3.select(el).append('div').style('padding', '12px 16px 0').style('display', 'flex').style('gap', '8px').style('align-items', 'center').style('flex-wrap', 'wrap');
    ctl.html(`<div class="seg"><button data-v="line" class="on">Direct line</button><button data-v="wide">Extended family</button></div>
      <span style="color:var(--ink-3);font-size:12px">Hover anywhere to see everyone's age in that year</span>`);
    ctl.selectAll('button').on('click', function () {
      scope = this.dataset.v;
      ctl.selectAll('button').classed('on', function () { return this.dataset.v === scope; });
      render(app.focus);
    });
    head = d3.select(el).append('div').style('flex', 'none');
    headSvg = head.append('svg').style('height', '68px');
    body = d3.select(el).append('div').style('flex', '1').style('overflow-y', 'auto').style('overflow-x', 'hidden');
    bodySvg = body.append('svg');
  }

  function people(focus) {
    const t = app.tree;
    const rows = new Map();
    const add = (p, g) => { if (p && !rows.has(p.id)) rows.set(p.id, { p, g }); };
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
    return [...rows.values()].filter(r => t.estBirth(r.p) != null)
      .sort((a, b) => a.g - b.g || t.estBirth(a.p) - t.estBirth(b.p));
  }

  function render(focus) {
    const t = app.tree;
    const rows = people(focus);
    const w = app.visibleWidth(el);
    const now = new Date().getFullYear();
    const span = r => {
      const b = t.estBirth(r.p), d = t.deathYear(r.p);
      return { b, d: d ?? (r.p.living ? now : b + 75), known: d != null || r.p.living, living: r.p.living && d == null, estB: t.birthYear(r.p) == null };
    };
    rows.forEach(r => Object.assign(r, span(r)));
    const lo = d3.min(rows, r => r.b) - 5, hi = Math.min(now + 5, d3.max(rows, r => r.d) + 5);
    const x = d3.scaleLinear().domain([lo, hi]).range([LEFT, w - RIGHT]);

    // header: axis + world events strip
    headSvg.attr('width', w).attr('viewBox', `0 0 ${w} 68`);
    headSvg.selectAll('*').remove();
    const worlds = U.WORLD.filter(e => e.y >= lo && e.y <= hi);
    const placed = [];
    const hw = headSvg.append('g').attr('class', 'tl-world');
    worlds.forEach(e => {
      const px = x(e.y);
      const text = e.label.length > 24 ? e.label.slice(0, 23) + '…' : e.label;
      const tw = text.length * 5.6 + 8;
      // three label lanes; skip a label rather than overlap (the band still shows, with a tooltip)
      const lane = [0, 1, 2].find(l => !placed.some(p => p.l === l && px < p.x2 && px + tw > p.x));
      hw.append('line').attr('x1', px).attr('x2', px).attr('y1', lane == null ? 30 : 4 + lane * 12).attr('y2', 44);
      if (lane == null || px + tw > w) return;
      placed.push({ x: px, x2: px + tw, l: lane });
      hw.append('text').attr('x', px + 3).attr('y', 12 + lane * 12).text(text).append('title').text(`${e.y}${e.end ? '–' + e.end : ''}: ${e.label}`);
    });
    headSvg.append('g').attr('class', 'tl-axis').attr('transform', 'translate(0,46)').call(d3.axisBottom(x).ticks(Math.max(4, w / 90)).tickFormat(d3.format('d')).tickSize(6));

    const h = Math.max(rows.length * ROW + 40, body.node().clientHeight);
    bodySvg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`).style('height', h + 'px');
    bodySvg.selectAll('*').remove();

    // grid + world bands
    bodySvg.append('g').attr('class', 'tl-grid').selectAll('line').data(x.ticks(Math.max(4, w / 90))).join('line')
      .attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', 0).attr('y2', h);
    const wb = bodySvg.append('g').attr('class', 'tl-world');
    worlds.forEach(e => {
      if (e.end) wb.append('rect').attr('x', x(e.y)).attr('width', x(e.end) - x(e.y)).attr('y', 0).attr('height', h);
      else wb.append('line').attr('x1', x(e.y)).attr('x2', x(e.y)).attr('y1', 0).attr('y2', h);
    });

    // generation labels
    let lastG = null;
    const gl = bodySvg.append('g');
    rows.forEach((r, i) => {
      if (r.g !== lastG) {
        lastG = r.g;
        gl.append('text').attr('class', 'tl-gen').attr('x', 16).attr('y', i * ROW + 26).text(GEN(r.g));
        if (i) gl.append('line').attr('x1', 16).attr('x2', w - RIGHT).attr('y1', i * ROW + 10).attr('y2', i * ROW + 10).attr('stroke', U.css('--line'));
      }
    });

    // bars
    const defs = bodySvg.append('defs');
    const g = bodySvg.append('g');
    const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    rows.forEach((r, i) => {
      const y = i * ROW + 14;
      const col = U.surnameColor(r.p.surname, U.isNight() ? 50 : 55);
      const gid = `tlg-${i}`;
      const lg = defs.append('linearGradient').attr('id', gid);
      lg.append('stop').attr('offset', r.estB ? '0%' : '0%').attr('stop-color', col).attr('stop-opacity', r.estB ? 0.15 : 0.9);
      lg.append('stop').attr('offset', r.estB ? '25%' : '0%').attr('stop-color', col).attr('stop-opacity', 0.9);
      lg.append('stop').attr('offset', r.known ? '100%' : '65%').attr('stop-color', col).attr('stop-opacity', 0.9);
      lg.append('stop').attr('offset', '100%').attr('stop-color', col).attr('stop-opacity', r.known ? 0.9 : 0.05);

      const row = g.append('g').attr('class', `tl-row ${r.p.id === focus.id ? 'focus' : ''}`).datum(r)
        .on('click', () => app.go(r.p.id));
      const bw = Math.max(4, x(r.d) - x(r.b));
      row.append('rect').attr('x', LEFT - 4).attr('width', w).attr('y', y - 1).attr('height', ROW - 4).attr('fill', 'transparent');
      row.append('rect').attr('class', 'tl-bar').attr('x', x(r.b)).attr('y', y + 2).attr('height', ROW - 10).attr('rx', 7)
        .attr('fill', `url(#${gid})`).attr('stroke', r.p.id === focus.id ? U.css('--gold') : 'none').attr('stroke-width', 2)
        .attr('width', 0).transition().duration(dur).delay(i * 12).attr('width', bw);
      if (r.living) row.append('text').attr('x', x(r.d) + 4).attr('y', y + 15).attr('fill', col).style('font-size', '11px').text('▸');
      // marriages
      for (const u of t.unions(r.p)) {
        const my = u.family.marriage && u.family.marriage.date && u.family.marriage.date.year;
        if (my) row.append('circle').attr('cx', x(my)).attr('cy', y + ROW / 2 - 3).attr('r', 3.5).attr('fill', 'none').attr('stroke', U.css('--gold')).attr('stroke-width', 1.5)
          .append('title').text(`Married ${u.spouse ? u.spouse.name : ''} in ${my}`);
      }
      const label = `${r.p.name}  ${t.lifespan(r.p)}`;
      const inside = bw > label.length * 6.4 + 16;
      row.append('text').attr('class', 'tl-name').attr('x', inside ? x(r.b) + 8 : x(r.d) + (r.living ? 16 : 6)).attr('y', y + 15)
        .style('fill', inside ? (U.isNight() ? '#0b1024' : '#fff') : null).text(label);
      row.on('mouseenter', e => U.tip(U.tipHtml(t, r.p, r.estB ? 'Birth year estimated from relatives' : ''), e)).on('mousemove', e => U.moveTip(e)).on('mouseleave', U.hideTip);
    });

    // hover cursor: ages of everyone in that year
    const cursor = bodySvg.append('g').attr('class', 'tl-cursor').style('display', 'none').style('pointer-events', 'none');
    cursor.append('line').attr('y1', 0).attr('y2', h);
    const ct = cursor.append('text').attr('y', 12);
    bodySvg.on('mousemove.cursor', e => {
      const [mx] = d3.pointer(e);
      if (mx < LEFT) { cursor.style('display', 'none'); return; }
      const yr = Math.round(x.invert(mx));
      cursor.style('display', null).attr('transform', `translate(${x(yr)},0)`);
      ct.text(yr).attr('x', 5);
      g.selectAll('.tl-row').each(function (r) {
        const alive = yr >= r.b && yr <= r.d;
        d3.select(this).select('.tl-bar').attr('opacity', alive ? 1 : 0.35);
        const nm = d3.select(this).select('.tl-name');
        nm.text(alive ? `${r.p.name} · age ${yr - r.b}` : `${r.p.name}  ${t.lifespan(r.p)}`);
      });
    }).on('mouseleave.cursor', () => {
      cursor.style('display', 'none');
      g.selectAll('.tl-row').each(function (r) {
        d3.select(this).select('.tl-bar').attr('opacity', 1);
        d3.select(this).select('.tl-name').text(`${r.p.name}  ${t.lifespan(r.p)}`);
      });
    });

    // scroll the focus row into view
    const fi = rows.findIndex(r => r.p.id === focus.id);
    if (fi >= 0) body.node().scrollTop = Math.max(0, fi * ROW - body.node().clientHeight / 2);
  }

  return { init, render, onResize() { if (app && app.focus && el.classList.contains('active')) render(app.focus); }, hint: '' };
})();
