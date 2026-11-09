// Ancestor fan chart with colour modes and a completeness "bingo" score.
window.FanView = (function () {
  let el, app, svg, g, ctl, legend, score, gens = 6, mode = 'surname', sweep = 240;
  const MODES = { surname: 'Surname', country: 'Birth country', century: 'Century', sex: 'Line' };

  function init(container, ctx) {
    el = container; app = ctx;
    svg = d3.select(el).append('svg');
    g = svg.append('g');
    ctl = d3.select(el).append('div').attr('class', 'fan-legend');
    ctl.html(`
      <div class="seg" data-g="mode">${Object.entries(MODES).map(([k, v]) => `<button data-v="${k}" class="${k === mode ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="seg" data-g="sweep"><button data-v="240" class="on">Fan</button><button data-v="360">Circle</button></div>
      <div class="seg" data-g="gens"><button data-v="4">4</button><button data-v="5">5</button><button data-v="6" class="on">6</button><button data-v="7">7</button><button data-v="8">8</button><span class="seg-label" style="padding:0 10px 0 2px">gen</span></div>`);
    ctl.selectAll('.seg button').on('click', function () {
      const grp = this.parentNode.dataset.g, v = this.dataset.v;
      if (grp === 'mode') mode = v; else if (grp === 'sweep') sweep = +v; else gens = +v;
      d3.select(this.parentNode).selectAll('button').classed('on', function () { return this.dataset.v === v; });
      render(app.focus);
    });
    legend = d3.select(el).append('div').attr('class', 'legend-swatches').style('position', 'absolute').style('left', '16px').style('bottom', '40px');
    score = d3.select(el).append('div').attr('class', 'legend-swatches bingo').style('position', 'absolute').style('left', '16px').style('top', '56px').style('flex-direction', 'column').style('gap', '2px');
  }

  function country(p) {
    const pl = p.birth && p.birth.place;
    if (!pl) return null;
    const parts = pl.split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }

  function render(focus) {
    const t = app.tree;
    const w = app.visibleWidth(el), h = el.clientHeight;
    const full = sweep === 360;
    // a 240° fan reaches R above the centre and R·cos(60°) below it
    const R = full ? Math.min(w, h) / 2 - 30 : Math.min((w - 40) / 1.74, (h - 60) / 1.5);
    const cy = full ? h / 2 + 10 : (h - 1.5 * R) / 2 + R + 10;
    svg.attr('viewBox', `0 0 ${el.clientWidth} ${h}`);
    g.attr('transform', `translate(${w / 2},${cy})`);

    // Ahnentafel slots
    const slots = [];
    const r0 = R * (full ? 0.15 : 0.17);
    // ring widths shrink outward
    const weights = d3.range(1, gens + 1).map(i => (i <= 3 ? 1.25 : i <= 5 ? 1 : 0.8));
    const total = d3.sum(weights);
    const radii = [r0];
    weights.forEach(wt => radii.push(radii[radii.length - 1] + (R - r0) * wt / total));
    let level = [focus];
    const a0 = -sweep / 2 * Math.PI / 180, span = sweep * Math.PI / 180;
    const filled = [];
    for (let gen = 1; gen <= gens; gen++) {
      const next = [];
      const n = 2 ** gen;
      let found = 0;
      for (let i = 0; i < n; i++) {
        const child = level[i >> 1];
        let p = null;
        if (child) p = (i % 2 === 0 ? t.father(child) : t.mother(child)) || null;
        if (p) found++;
        next.push(p);
        slots.push({ gen, i, p, a1: a0 + span * i / n, a2: a0 + span * (i + 1) / n, r1: radii[gen - 1], r2: radii[gen], line: i < n / 2 ? 'paternal' : 'maternal' });
      }
      filled.push([gen, found, n]);
      level = next;
    }

    // colour scales
    const countries = [...new Set(slots.filter(s => s.p).map(s => country(s.p)).filter(Boolean))];
    const cScale = d3.scaleOrdinal().domain(countries).range(U.inkScale(12));
    const years = slots.filter(s => s.p).map(s => t.estBirth(s.p)).filter(v => v != null);
    const yExt = d3.extent(years.concat(t.estBirth(focus) ?? []));
    const colorOf = s => {
      if (!s.p) return null;
      if (mode === 'surname') return U.surnameColor(s.p.surname, 'fill');
      if (mode === 'country') { const c = country(s.p); return c ? cScale(c) : U.css('--ink-3'); }
      if (mode === 'century') { const y = t.estBirth(s.p); return y == null ? U.css('--ink-3') : U.centuryColor((y - yExt[0]) / ((yExt[1] - yExt[0]) || 1)); }
      // the two lines of descent, each ring a little deeper than the last
      return `oklch(${(0.56 - s.gen * 0.022).toFixed(3)} 0.075 ${s.line === 'paternal' ? 245 : 25})`;
    };

    const arc = d3.arc().innerRadius(d => d.r1).outerRadius(d => d.r2).startAngle(d => d.a1).endAngle(d => d.a2).padAngle(0.003).cornerRadius(1);
    const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700;

    const arcs = g.selectAll('path.fan-arc').data(slots, d => `${d.gen}-${d.i}`);
    arcs.join(
      en => en.append('path').attr('class', 'fan-arc').attr('d', d => arc({ ...d, r2: d.r1 })).attr('opacity', 0),
      up => up
    ).classed('empty', d => !d.p)
      .style('fill', d => colorOf(d))
      .on('click', (e, d) => d.p && app.go(d.p.id))
      .on('mouseenter', (e, d) => {
        if (!d.p) { U.tip(`<b>Undiscovered</b><div class="t-sub">${lineName(d)}</div>`, e); return; }
        const rel = app.home && t.relationship(app.home, d.p);
        U.tip(U.tipHtml(t, d.p, rel && rel.label !== 'self' ? `${app.home.given.split(' ')[0]}'s ${rel.label}` : ''), e);
        // light up the line of descent back to the centre
        const chain = new Set();
        let gi = d.gen, ii = d.i;
        while (gi >= 1) { chain.add(`${gi}-${ii}`); gi--; ii >>= 1; }
        g.selectAll('path.fan-arc').style('opacity', s => chain.has(`${s.gen}-${s.i}`) ? 1 : 0.35);
      })
      .on('mousemove', e => U.moveTip(e))
      .on('mouseleave', () => { U.hideTip(); g.selectAll('path.fan-arc').style('opacity', null); })
      .transition().duration(dur).delay(d => d.gen * 70 + (d.i / 2 ** d.gen) * 120)
      .attr('opacity', 1)
      .attrTween('d', function (d) {
        // grow each wedge outward from its inner edge (string-interpolating arc paths garbles them)
        const from = this._r2 && this._a ? { r2: this._r2, a1: this._a[0], a2: this._a[1] } : { r2: d.r1, a1: d.a1, a2: d.a2 };
        const ir = d3.interpolate(from.r2, d.r2), ia1 = d3.interpolate(from.a1, d.a1), ia2 = d3.interpolate(from.a2, d.a2);
        this._r2 = d.r2; this._a = [d.a1, d.a2];
        return k => arc({ ...d, r2: ir(k), a1: ia1(k), a2: ia2(k) });
      });

    // labels
    const labels = slots.filter(s => s.p);
    g.selectAll('text.fan-label').remove();
    g.selectAll('text.fan-label').data(labels).join('text').attr('class', 'fan-label')
      .each(function (d) {
        const node = d3.select(this);
        const mid = (d.a1 + d.a2) / 2, rm = (d.r1 + d.r2) / 2;
        const arcLen = (d.a2 - d.a1) * rm, depth = d.r2 - d.r1;
        const deg = mid * 180 / Math.PI;
        const x = Math.sin(mid) * rm, y = -Math.cos(mid) * rm;
        const tangential = arcLen > depth * 1.15;
        const room = tangential ? arcLen : depth;
        const size = Math.max(8, Math.min(13, (tangential ? depth : arcLen) * 0.32));
        node.style('font-size', size + 'px');
        const maxChars = Math.floor(room / (size * 0.56));
        if (maxChars < 3) return;
        const given = d.p.given.split(' ')[0] || '?';
        let rot;
        if (tangential) { rot = deg; if (deg > 90 || deg < -90) rot += 180; }
        else { rot = deg - 90; if (deg > 0 && deg <= 180) rot = deg - 90; else rot = deg + 90; }
        node.attr('transform', `translate(${x},${y}) rotate(${rot})`).attr('text-anchor', 'middle');
        const lines = [];
        const full = `${given} ${d.p.surname}`;
        if (tangential && (d.r2 - d.r1) > size * 2.8) {
          lines.push(clip(given, maxChars), clip(d.p.surname, maxChars));
          const ls = d.p.birth && d.p.birth.date ? t.lifespan(d.p) : '';
          if (ls && (d.r2 - d.r1) > size * 4.2) lines.push(ls);
        } else lines.push(clip(full.length <= maxChars ? full : given, maxChars));
        const lh = size * 1.15;
        lines.forEach((l, i) => node.append('tspan').attr('x', 0).attr('dy', i === 0 ? (-(lines.length - 1) * lh / 2 + size * 0.35) : lh).style('opacity', i === 2 ? 0.75 : 1).text(l));
      })
      .attr('opacity', 0).transition().duration(dur).delay(d => d.gen * 70 + 300).attr('opacity', 1);

    // centre
    g.selectAll('.fan-center').remove();
    const c = g.append('g').attr('class', 'fan-center').style('cursor', 'pointer').on('click', () => app.setView('tree'));
    c.append('circle').attr('class', 'fan-center-disc').attr('r', r0 - 4);
    const size = Math.max(11, Math.min(20, r0 / 4.2));
    c.append('text').attr('class', 'fan-center-name').attr('text-anchor', 'middle').attr('y', -size * 0.2).style('font-size', size + 'px').text(clip(focus.given.split(' ')[0] || focus.name, 14));
    c.append('text').attr('class', 'fan-center-sur').attr('text-anchor', 'middle').attr('y', size * 1.05).style('font-size', `${size * 0.8}px`).text(clip(focus.surname, 16));
    c.append('text').attr('class', 'fan-center-life').attr('text-anchor', 'middle').attr('y', size * 2.1).style('font-size', `${Math.max(9, size * 0.5)}px`).text(t.lifespan(focus));

    // legend
    if (mode === 'country') legend.style('display', null).html(countries.slice(0, 12).map(cn => `<span><i style="background:${cScale(cn)}"></i>${U.esc(cn)}</span>`).join(''));
    else if (mode === 'century' && yExt[0] != null) legend.style('display', null).html(`<span><i style="background:${U.centuryColor(0)}"></i>${yExt[0]}</span><span class="ramp" style="background:linear-gradient(90deg in oklch,${d3.range(0, 1.01, 0.2).map(v => U.centuryColor(v)).join(',')})"></span><span>${yExt[1]}</span>`);
    else if (mode === 'sex') legend.style('display', null).html(`<span><i style="background:oklch(0.52 0.075 245)"></i>Paternal line</span><span><i style="background:oklch(0.52 0.075 25)"></i>Maternal line</span>`);
    else legend.style('display', 'none');

    // completeness score
    const totalFound = d3.sum(filled, f => f[1]), totalSlots = d3.sum(filled, f => f[2]);
    score.html(`<div class="bingo-title">Ancestor bingo: <b>${totalFound}</b> / ${totalSlots}</div>` +
      filled.map(([gn, f, n]) => `<div class="bingo-row"><span class="g">Gen ${gn}</span><span class="track"><span style="width:${f / n * 100}%"></span></span><span class="n">${f}/${n}</span></div>`).join(''));
  }

  function lineName(d) {
    const steps = [];
    let gi = d.gen, ii = d.i;
    while (gi >= 1) { steps.unshift(ii % 2 === 0 ? 'father' : 'mother'); gi--; ii >>= 1; }
    return `${U.esc(app.focus.given.split(' ')[0])}'s ` + steps.join("'s ");
  }
  function clip(s, n) { return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }

  return { init, render, onResize() { if (app && app.focus && el.classList.contains('active')) render(app.focus); }, hint: 'Hover to trace a line of descent · click any ancestor to re-center the fan' };
})();
