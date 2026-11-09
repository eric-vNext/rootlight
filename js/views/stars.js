// Constellation: a force-directed star map of the focus person's neighbourhood, with a Time Machine.
window.StarsView = (function () {
  let el, app, svg, root, gLinks, gStars, zoom, sim, tm, ctl;
  let depth = 4, year = null, tmOn = false, playing = null;
  const pos = new Map(); // remembered positions between renders

  function init(container, ctx) {
    el = container; app = ctx;
    svg = d3.select(el).append('svg');
    root = svg.append('g');
    gLinks = root.append('g');
    gStars = root.append('g');
    zoom = d3.zoom().scaleExtent([0.2, 3]).on('zoom', e => root.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    ctl = d3.select(el).append('div').attr('class', 'stars-ctl');
    ctl.html(`<div class="seg" data-g="depth" title="How far out from the focus person to draw">
      <span class="seg-label">Reach</span>${[2, 3, 4, 6, 9].map(d => `<button data-v="${d}" class="${d === depth ? 'on' : ''}">${d}</button>`).join('')}<button data-v="99">all</button></div>`);
    ctl.selectAll('button[data-v]').on('click', function () {
      depth = +this.dataset.v;
      ctl.selectAll('button[data-v]').classed('on', function () { return +this.dataset.v === depth; });
      render(app.focus);
    });

    tm = d3.select(el).append('div').attr('class', 'time-machine');
    tm.html(`<div class="tm-head"><span class="tm-title">Time machine <button class="tm-toggle" data-tm>off</button><button class="tm-toggle" data-play title="Play through the years">play</button></span><span class="tm-year">—</span></div>
      <input type="range" min="1800" max="2025" value="1900" step="1" aria-label="Year">
      <div class="tm-sub">Turn it on and drag through the years to see who was alive.</div>`);
    tm.select('input').on('input', function () { year = +this.value; if (!tmOn) setTm(true); applyTime(); });
    tm.select('[data-tm]').on('click', () => setTm(!tmOn));
    tm.select('[data-play]').on('click', togglePlay);
  }

  function setTm(on) {
    tmOn = on;
    tm.select('[data-tm]').text(on ? 'on' : 'off').classed('on', on);
    if (!on && playing) togglePlay();
    applyTime();
  }

  function togglePlay() {
    const btn = tm.select('[data-play]');
    if (playing) { clearInterval(playing); playing = null; btn.text('play').classed('on', false); return; }
    const inp = tm.select('input').node();
    if (!tmOn) setTm(true);
    if (+inp.value >= +inp.max) inp.value = inp.min;
    btn.text('pause').classed('on', true);
    playing = setInterval(() => {
      if (!el.classList.contains('active')) return;
      inp.value = Math.min(+inp.max, +inp.value + 1);
      year = +inp.value;
      applyTime();
      if (+inp.value >= +inp.max) togglePlay();
    }, 110);
  }

  function collect(focus) {
    const t = app.tree;
    const dist = new Map([[focus.id, 0]]);
    const gen = new Map([[focus.id, 0]]);
    const q = [focus];
    const cap = depth >= 99 ? 1500 : 260;
    while (q.length && dist.size < cap) {
      const p = q.shift();
      const d = dist.get(p.id);
      if (d >= depth) continue;
      for (const [n, rel] of t.neighbors(p)) {
        if (dist.has(n.id)) continue;
        dist.set(n.id, d + 1);
        gen.set(n.id, gen.get(p.id) + (rel === 'parent' ? -1 : rel === 'child' ? 1 : 0));
        q.push(n);
        if (dist.size >= cap) break;
      }
    }
    // make sure a highlighted path is fully visible
    if (app.pathIds) for (const id of app.pathIds) if (!dist.has(id)) { dist.set(id, depth + 1); gen.set(id, 0); }
    const ids = new Set(dist.keys());
    const nodes = [...ids].map(id => {
      const p = t.get(id);
      const old = pos.get(id);
      return { id, p, d: dist.get(id), gen: gen.get(id), x: old ? old.x : undefined, y: old ? old.y : undefined, deg: t.neighbors(p).length };
    });
    const links = [];
    const lk = new Set();
    for (const n of nodes) {
      for (const c of t.children(n.p)) if (ids.has(c.id)) links.push({ source: n.id, target: c.id, type: 'pc' });
      for (const s of t.spouses(n.p)) if (ids.has(s.id)) { const k = [n.id, s.id].sort().join('|'); if (!lk.has(k)) { lk.add(k); links.push({ source: n.id, target: s.id, type: 'marriage' }); } }
    }
    return { nodes, links };
  }

  function render(focus) {
    const t = app.tree;
    const w = app.visibleWidth(el), h = el.clientHeight;
    const { nodes, links } = collect(focus);
    tm.style('left', w / 2 + 'px').style('width', `min(620px, ${w - 32}px)`);
    const path = app.pathIds ? new Set(app.pathIds) : null;
    const pathEdges = new Set();
    if (app.pathIds) for (let i = 1; i < app.pathIds.length; i++) pathEdges.add([app.pathIds[i - 1], app.pathIds[i]].sort().join('|'));

    // seed new stars near their already-placed neighbours
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) if (n.x === undefined) {
      const nb = t.neighbors(n.p).map(([x]) => byId.get(x.id)).find(x => x && x.x !== undefined);
      n.x = (nb ? nb.x : 0) + (Math.random() - 0.5) * 60;
      n.y = (nb ? nb.y : n.gen * 90) + (Math.random() - 0.5) * 60;
    }
    const f = byId.get(focus.id); f.fx = 0; f.fy = 0;

    const radius = n => n.id === focus.id ? 11 : 3 + Math.sqrt(n.deg) * 1.6;

    if (sim) sim.stop();
    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(l => l.type === 'marriage' ? 40 : 72).strength(l => l.type === 'marriage' ? 0.9 : 0.6))
      .force('charge', d3.forceManyBody().strength(n => n.d === 0 ? -600 : -230).distanceMax(500))
      .force('gen', d3.forceY(n => n.gen * 110).strength(0.14))
      .force('collide', d3.forceCollide(n => radius(n) + 8))
      .alpha(0.9).alphaDecay(0.035);

    const link = gLinks.selectAll('line').data(links, l => [l.source.id ?? l.source, l.target.id ?? l.target].sort().join('|'));
    const linkSel = link.join(en => en.append('line').attr('opacity', 0).call(s => s.transition().duration(600).attr('opacity', 1)), up => up, ex => ex.remove())
      .attr('class', l => `star-link ${l.type === 'marriage' ? 'marriage' : ''} ${pathEdges.has([l.source.id, l.target.id].sort().join('|')) ? 'lit' : ''}`);

    const star = gStars.selectAll('g.star').data(nodes, n => n.id);
    const starSel = star.join(
      en => {
        const g = en.append('g').attr('class', 'star');
        g.append('circle').attr('class', 'halo');
        g.append('circle').attr('class', 'core');
        g.append('text');
        g.attr('opacity', 0).transition().duration(700).attr('opacity', 1);
        return g;
      },
      up => up,
      ex => ex.transition().duration(300).attr('opacity', 0).remove()
    );
    starSel.classed('focus', n => n.id === focus.id).classed('lit', n => !!(path && path.has(n.id)));
    starSel.select('.halo').attr('r', n => radius(n) * (n.id === focus.id ? 4.5 : 3.2))
      .style('fill', n => n.id === focus.id ? U.css('--gold') : U.sexColor(n.p)).style('opacity', n => n.id === focus.id ? 0.35 : null)
      .style('filter', 'blur(4px)');
    starSel.select('.core').attr('r', n => radius(n)).attr('fill', n => n.id === focus.id ? U.css('--gold') : U.sexColor(n.p))
      .attr('stroke', n => path && path.has(n.id) ? U.css('--gold') : 'none').attr('stroke-width', 1.5)
      .style('filter', U.isNight() ? `drop-shadow(0 0 4px ${U.css('--gold')})` : null);
    starSel.select('text').attr('y', n => radius(n) + (n.id === focus.id ? 24 : 13)).attr('text-anchor', 'middle')
      .text(n => n.id === focus.id ? n.p.name : (n.d <= 2 || (path && path.has(n.id)) || nodes.length < 70) ? (n.p.given.split(' ')[0] || '?') : '');

    starSel.on('click', (e, n) => { if (e.defaultPrevented) return; app.go(n.id, { keepPath: !!(path && path.has(n.id)) }); })
      .on('mouseenter', (e, n) => {
        const rel = app.home && t.relationship(app.home, n.p);
        U.tip(U.tipHtml(t, n.p, rel && rel.label !== 'self' ? `${app.home.given.split(' ')[0]}'s ${rel.label}` : n.id === app.homeId ? 'Home' : ''), e);
        // light up immediate connections
        const nb = new Set([n.id, ...t.neighbors(n.p).map(([x]) => x.id)]);
        linkSel.style('stroke-opacity', l => (l.source.id === n.id || l.target.id === n.id) ? 0.95 : null);
        starSel.style('opacity', s => nb.has(s.id) ? 1 : 0.45);
      })
      .on('mousemove', e => U.moveTip(e))
      .on('mouseleave', () => { U.hideTip(); linkSel.style('stroke-opacity', null); starSel.style('opacity', null); })
      .call(d3.drag()
        .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.25).restart(); n.fx = n.x; n.fy = n.y; })
        .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y; })
        .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); if (n.id !== focus.id) { n.fx = null; n.fy = null; } }));

    sim.on('tick', () => {
      linkSel.attr('x1', l => l.source.x).attr('y1', l => l.source.y).attr('x2', l => l.target.x).attr('y2', l => l.target.y);
      starSel.attr('transform', n => `translate(${n.x},${n.y})`);
      for (const n of nodes) pos.set(n.id, { x: n.x, y: n.y });
    });
    // twinkle
    starSel.select('.core').style('animation', (n, i) => `glow ${2 + (i % 5) * 0.6}s ease-in-out ${(i % 7) * 0.3}s infinite alternate`);

    // centre on the focus right away, then frame the whole constellation once it settles
    const k0 = d3.zoomTransform(svg.node()).k || 1;
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2 - 40).scale(k0));
    let framed = false;
    const mySim = sim;
    const frame = () => {
      if (framed || sim !== mySim) return;
      framed = true;
      const xs = d3.extent(nodes, n => n.x), ys = d3.extent(nodes, n => n.y);
      const bw = xs[1] - xs[0] + 120, bh = ys[1] - ys[0] + 120;
      const k = Math.max(0.25, Math.min(1.3, w / bw, (h - 130) / bh));
      const cx = (xs[0] + xs[1]) / 2, cy = (ys[0] + ys[1]) / 2;
      svg.transition().duration(900).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity.translate(w / 2 - cx * k, (h - 110) / 2 - cy * k).scale(k));
    };
    setTimeout(frame, 1400);

    // time-machine range follows the data
    const ys = nodes.map(n => t.estBirth(n.p)).filter(v => v != null);
    if (ys.length) {
      const inp = tm.select('input');
      const lo = Math.floor(d3.min(ys) / 10) * 10, hi = Math.max(new Date().getFullYear(), d3.max(ys));
      inp.attr('min', lo).attr('max', hi);
      if (year == null || year < lo || year > hi) { year = t.estBirth(focus) ?? lo; inp.property('value', year); }
    }
    applyTime();
  }

  function applyTime() {
    if (!gStars) return;
    const t = app.tree;
    const stars = gStars.selectAll('g.star');
    tm.select('.tm-year').text(tmOn ? year : '—');
    if (!tmOn) { stars.classed('dim', false); tm.select('.tm-sub').text('Turn it on and drag through the years to see who was alive.'); return; }
    let alive = 0;
    const born = [], died = [];
    stars.classed('dim', n => {
      const a = t.aliveIn(n.p, year);
      if (a) alive++;
      if (t.birthYear(n.p) === year) born.push(n.p);
      if (t.deathYear(n.p) === year) died.push(n.p);
      return !a;
    });
    const focus = app.focus;
    const fb = t.estBirth(focus);
    let note = `${alive} of these ${stars.size()} relatives alive`;
    if (born.length) note += ` · ${born.slice(0, 2).map(p => p.given.split(' ')[0]).join(', ')} born`;
    if (died.length) note += ` · ${died.slice(0, 2).map(p => p.given.split(' ')[0]).join(', ')} died`;
    if (fb != null && !born.length) note += year < fb ? ` · ${focus.given.split(' ')[0]} arrives in ${fb - year} yr${fb - year === 1 ? '' : 's'}` : t.aliveIn(focus, year) ? ` · ${focus.given.split(' ')[0]} is ${year - fb}` : '';
    const w = U.WORLD.find(e => e.y === year || (e.end && year >= e.y && year <= e.end));
    if (w) note += ` · ${w.label}`;
    tm.select('.tm-sub').text(note);
  }

  return {
    init, render,
    reset() { pos.clear(); year = null; },
    onResize() { if (app && app.focus && el.classList.contains('active')) { const w = app.visibleWidth(el), h = el.clientHeight; svg.transition().duration(400).call(zoom.translateTo, 0, 30, [w / 2, h / 2]); } },
    hint: 'Each star is a relative · drag stars to rearrange · click to travel',
  };
})();
