// Hourglass tree: ancestors above, descendants below, siblings and spouses alongside.
window.TreeView = (function () {
  // A tile's size follows how close the person stands to the focus: the focus is a bookplate, the direct family are
  // index cards, and the further generations shrink to ledger slips. r = monogram radius, foot = height of the
  // ruled footer that carries dates and relationship (0 = no footer; dates sit under the name instead).
  const TIER = {
    focus: { w: 244, h: 98, r: 26, pad: 14, foot: 24 },
    near: { w: 192, h: 70, r: 16, pad: 11, foot: 21 },
    mid: { w: 166, h: 58, r: 13, pad: 9, foot: 0 },
    far: { w: 142, h: 46, r: 10, pad: 8, foot: 0 },
  };
  // text baselines per tier, measured from the tile centre
  const LINES = {
    focus: { nm: -15, sn: 4, foot: 41 },
    near: { nm: -13, sn: 2, foot: 28.5 },
    mid: { nm: -8, sn: 4.5, yr: 18.5 },
    far: { nm: -3, yr: 12 },
  };
  const GAP = 20, WED = 36, VG = 48; // between cousins, across a marriage, between generations
  const tierAt = depth => depth === 0 ? 'focus' : depth === 1 ? 'near' : depth === 2 ? 'mid' : 'far';
  const GEN_UP = ['', 'Parents', 'Grandparents', 'Great-grandparents', '2× great-grandparents', '3× great-grandparents', '4× great-grandparents', '5× great-grandparents'];
  const GEN_DOWN = ['', 'Children', 'Grandchildren', 'Great-grandchildren', '2× great-grandchildren'];
  let el, app, svg, root, gLinks, gCards, gLabels, zoom, up = 3, down = 2, lastFocus = null, ctl, bounds = null, refit = 0;

  // distance from the focus row to generation `depth`, tile centre to tile centre
  function rowY(depth) {
    let y = 0;
    for (let i = 1; i <= depth; i++) y += TIER[tierAt(i - 1)].h / 2 + VG + TIER[tierAt(i)].h / 2;
    return y;
  }
  const spread = (a, b) => (TIER[tierAt(a.depth)].w + TIER[tierAt(b.depth)].w) / 2 + GAP * (a.parent === b.parent ? 1 : 1.7);

  // Writes `str` into a text node, shortening it with an ellipsis until it is no wider than `max`. Returns the width.
  function fitText(sel, str, max) {
    const node = sel.text(str || '').node();
    if (!str || max <= 0) { sel.text(''); return 0; }
    if (node.getComputedTextLength() <= max) return node.getComputedTextLength();
    let lo = 0, hi = str.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      sel.text(str.slice(0, mid).trimEnd() + '…');
      if (node.getComputedTextLength() <= max) lo = mid; else hi = mid - 1;
    }
    sel.text(lo ? str.slice(0, lo).trimEnd() + '…' : '');
    return node.getComputedTextLength();
  }

  function init(container, ctx) {
    el = container; app = ctx;
    svg = d3.select(el).append('svg');
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'tree-round').attr('clipPathUnits', 'objectBoundingBox')
      .append('circle').attr('cx', .5).attr('cy', .5).attr('r', .5);
    // nothing typeset on a tile may ever leave it, even if a font swaps in late
    for (const [name, t] of Object.entries(TIER)) {
      defs.append('clipPath').attr('id', `tree-clip-${name}`).append('rect')
        .attr('x', -t.w / 2 + 2).attr('y', -t.h / 2 + 1).attr('width', t.w - 4).attr('height', t.h - 2);
    }
    // survey graticule that pans and zooms with the map (daylight theme only; the night sky is the backdrop there)
    defs.append('pattern').attr('id', 'tree-grid').attr('patternUnits', 'userSpaceOnUse').attr('width', 44).attr('height', 44)
      .append('circle').attr('class', 'grid-dot').attr('cx', 22).attr('cy', 22).attr('r', 0.9);
    root = svg.append('g');
    root.append('rect').attr('class', 'map-grid').attr('x', -30000).attr('y', -30000).attr('width', 60000).attr('height', 60000).attr('fill', 'url(#tree-grid)');
    gLabels = root.append('g');
    gLinks = root.append('g');
    gCards = root.append('g');
    zoom = d3.zoom().scaleExtent([0.12, 2.6]).on('zoom', e => root.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);
    ctl = d3.select(el).append('div').attr('class', 'fan-legend');
    ctl.html(`
      <div class="seg" title="Generations of ancestors"><span class="seg-label">Ancestors</span><button data-k="up" data-d="-1" aria-label="Fewer ancestor generations">−</button><span class="seg-val" data-v="up">${up}</span><button data-k="up" data-d="1" aria-label="More ancestor generations">+</button></div>
      <div class="seg" title="Generations of descendants"><span class="seg-label">Descendants</span><button data-k="down" data-d="-1" aria-label="Fewer descendant generations">−</button><span class="seg-val" data-v="down">${down}</span><button data-k="down" data-d="1" aria-label="More descendant generations">+</button></div>
      <div class="seg" title="Zoom the map"><button data-zoom="0.7" aria-label="Zoom out">−</button><button data-fit>Fit</button><button data-zoom="1.43" aria-label="Zoom in">+</button></div>`);
    ctl.selectAll('[data-k]').on('click', function () {
      const k = this.dataset.k, d = +this.dataset.d;
      if (k === 'up') up = Math.max(1, Math.min(7, up + d)); else down = Math.max(0, Math.min(4, down + d));
      ctl.select('[data-v=up]').text(up); ctl.select('[data-v=down]').text(down);
      render(app.focus, { fit: true });
    });
    ctl.select('[data-fit]').on('click', () => fit(true));
    ctl.selectAll('[data-zoom]').on('click', function () { svg.transition().duration(260).call(zoom.scaleBy, +this.dataset.zoom); });
    // labels are measured to fit their tile, so measure again once the real typefaces have arrived
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => {
        clearTimeout(refit);
        refit = setTimeout(() => { if (app.focus && lastFocus != null) render(app.focus, { still: true }); }, 60);
      });
    }
  }

  function layout(focus) {
    const t = app.tree;
    const nodes = [], links = [], labels = [];
    const seen = new Map();
    const key = id => { const n = (seen.get(id) || 0) + 1; seen.set(id, n); return n === 1 ? id : `${id}#${n}`; };
    const F = TIER.focus, N = TIER.near, M = TIER.mid;

    // --- ancestors via d3.tree (children = parents)
    const ancRoot = d3.hierarchy({ p: focus }, d => {
      if (d.ghost) return null;
      const depth = d.depth || 0;
      if (depth >= up) return null;
      const f = t.father(d.p), m = t.mother(d.p);
      const out = [];
      if (f || m || depth < 2) {
        out.push(f ? { p: f, depth: depth + 1 } : { ghost: 'father', depth: depth + 1 });
        out.push(m ? { p: m, depth: depth + 1 } : { ghost: 'mother', depth: depth + 1 });
      }
      return out;
    });
    d3.tree().nodeSize([1, 1]).separation(spread)(ancRoot);
    let maxUp = 0;
    ancRoot.each(n => {
      if (n.depth === 0) return;
      maxUp = Math.max(maxUp, n.depth);
      const tier = tierAt(n.depth), T = TIER[tier], C = TIER[tierAt(n.depth - 1)];
      const x = n.x, y = -rowY(n.depth);
      if (n.data.ghost) nodes.push({ key: `ghost-${n.parent.data.p.id}-${n.data.ghost}`, ghost: n.data.ghost, x, y, tier });
      else nodes.push({ key: key(n.data.p.id), p: n.data.p, x, y, tier });
      const sy = y + T.h / 2;
      links.push({ key: `a-${n.parent.data.p ? n.parent.data.p.id : ''}-${n.data.p ? n.data.p.id : n.data.ghost}-${n.depth}`, type: 'up', sx: x, sy, my: sy + VG / 2, tx: n.parent.x, ty: -rowY(n.depth - 1) - C.h / 2, ghost: !!n.data.ghost });
      if (n.parent && n.parent.children && n.parent.children[0] === n && n.parent.children[1]) {
        const o = n.parent.children[1];
        if (!n.data.ghost && !o.data.ghost) links.push({ key: `m-${n.data.p.id}-${o.data.p.id}`, type: 'marriage', sx: x + T.w / 2, sy: y, tx: o.x - T.w / 2, ty: y });
      }
    });

    // focus
    nodes.push({ key: key(focus.id), p: focus, x: 0, y: 0, focus: true, tier: 'focus' });

    // siblings to the left, hanging from the same bar as the focus
    const sibs = t.siblings(focus);
    const fb = t.birthYear(focus) ?? 0;
    const older = sibs.filter(s => (t.birthYear(s) ?? 0) <= fb), younger = sibs.filter(s => (t.birthYear(s) ?? 0) > fb);
    const sibRow = [...older, ...younger];
    const parentsBottom = -rowY(1) + N.h / 2;
    const famX = ancRoot.children ? (ancRoot.children[0].x + (ancRoot.children[1] ? ancRoot.children[1].x : ancRoot.children[0].x)) / 2 : 0;
    sibRow.reverse().forEach((s, i) => {
      const x = -(F.w / 2 + GAP + M.w / 2) - i * (M.w + GAP * 0.7);
      nodes.push({ key: key(s.id), p: s, x, y: 0, sib: true, tier: 'mid' });
      links.push({ key: `s-${s.id}`, type: 'sib', sx: famX, sy: parentsBottom, my: parentsBottom + VG / 2, tx: x, ty: -M.h / 2 });
    });

    // spouses to the right; descendants below each union
    const unions = t.unions(focus);
    const unionMids = [];
    unions.forEach((u, i) => {
      let mid = 0;
      if (u.spouse) {
        const x = F.w / 2 + WED + N.w / 2 + i * (N.w + WED);
        nodes.push({ key: key(u.spouse.id), p: u.spouse, x, y: 0, spouse: true, tier: 'near', married: u.family.marriage && u.family.marriage.date ? u.family.marriage.date.year : null });
        links.push({ key: `fm-${u.spouse.id}`, type: 'marriage', sx: x - N.w / 2 - WED, sy: 0, tx: x - N.w / 2, ty: 0 });
        mid = x - N.w / 2 - WED / 2;
      }
      unionMids.push(mid);
    });

    if (down > 0) {
      const descRoot = d3.hierarchy({ p: focus, depth: 0 }, d => {
        if (d.depth >= down) return null;
        const kids = d.depth === 0 ? unions.flatMap((u, ui) => u.children.map(c => ({ p: c, ui }))) : t.children(d.p).map(c => ({ p: c }));
        return kids.map(k => ({ ...k, depth: d.depth + 1 }));
      });
      d3.tree().nodeSize([1, 1]).separation(spread)(descRoot);
      const offset = unionMids.length ? d3.mean(unionMids) : 0;
      descRoot.each(n => {
        if (n.depth === 0) return;
        const tier = tierAt(n.depth), T = TIER[tier];
        const x = n.x + offset, y = rowY(n.depth);
        const sp = t.spouses(n.data.p);
        nodes.push({ key: key(n.data.p.id), p: n.data.p, x, y, partner: sp[0], tier });
        const ty = y - T.h / 2;
        let sx, sy;
        if (n.depth === 1) { sx = unionMids[n.data.ui] ?? 0; sy = unions[n.data.ui] && unions[n.data.ui].spouse ? 0 : F.h / 2; }
        else { sx = n.parent.x + offset; sy = rowY(n.depth - 1) + TIER[tierAt(n.depth - 1)].h / 2; }
        links.push({ key: `d-${n.data.p.id}-${n.depth}`, type: 'down', sx, sy, my: ty - VG / 2, tx: x, ty });
      });
      for (let g = 1; g <= Math.min(down, descRoot.height); g++) labels.push({ y: rowY(g), text: GEN_DOWN[g] || `${g - 2}× great-grandchildren` });
    }
    for (let g = 1; g <= maxUp; g++) labels.push({ y: -rowY(g), text: GEN_UP[g] || `${g - 2}× great-grandparents` });
    labels.push({ y: 0, text: sibRow.length ? 'Siblings & self' : 'Self' });
    return { nodes, links, labels };
  }

  // Descent runs as squared hairlines; a marriage is the genealogist's double rule.
  function elbow(d) {
    if (d.type === 'marriage') return `M${d.sx},${d.sy - 2}H${d.tx}M${d.sx},${d.sy + 2}H${d.tx}`;
    const my = d.my ?? (d.sy + d.ty) / 2;
    return `M${d.sx},${d.sy}V${my}H${d.tx}V${d.ty}`;
  }

  // Lays out one tile's furniture for its tier. Sizes come from CSS (.t-focus, .t-near, …); positions from here.
  function build(g, d) {
    const T = TIER[d.tier], L = LINES[d.tier];
    const left = -T.w / 2 + T.pad, cx = left + T.r, cy = -T.foot / 2;
    g.attr('class', `card t-${d.tier}`);
    g.select('.bg').attr('x', -T.w / 2).attr('y', -T.h / 2).attr('width', T.w).attr('height', T.h);
    g.select('.frame').attr('x', -T.w / 2 + 3.5).attr('y', -T.h / 2 + 3.5).attr('width', T.w - 7).attr('height', T.h - 7);
    g.select('.rule').attr('x1', left).attr('x2', T.w / 2 - T.pad).attr('y1', T.h / 2 - T.foot).attr('y2', T.h / 2 - T.foot)
      .style('display', T.foot ? null : 'none');
    g.selectAll('.av, .avr').attr('cx', cx).attr('cy', cy).attr('r', T.r);
    g.select('.avph').attr('x', cx - T.r).attr('y', cy - T.r).attr('width', T.r * 2).attr('height', T.r * 2);
    g.select('.avt').attr('x', cx).attr('y', cy + T.r * 0.3).style('font-size', `${Math.round(T.r * 0.86)}px`);
    g.select('.home-mark').attr('cx', T.w / 2 - T.pad + 1).attr('cy', -T.h / 2 + T.pad - 1);
    g.select('.txt').attr('clip-path', `url(#tree-clip-${d.tier})`);
    const tx = left + T.r * 2 + Math.max(7, T.pad - 2);
    g.select('.nm').attr('x', tx).attr('y', L.nm);
    g.select('.sn').attr('x', tx).attr('y', L.sn ?? 0);
    g.select('.yr').attr('x', T.foot ? left : tx).attr('y', T.foot ? L.foot : L.yr);
    g.select('.rel').attr('x', T.w / 2 - T.pad).attr('y', L.foot ?? 0);
    return { T, left, tx, textW: T.w / 2 - T.pad - tx, footW: T.w - T.pad * 2 };
  }

  function render(focus, opts = {}) {
    const t = app.tree;
    const home = app.home;
    const { nodes, links, labels } = layout(focus);
    const dur = opts.still || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    const tr = d3.transition().duration(dur).ease(d3.easeCubicInOut);
    const minX = d3.min(nodes, n => n.x - TIER[n.tier].w / 2);
    bounds = { x: minX - 170, y: d3.min(nodes, n => n.y - TIER[n.tier].h / 2), x2: d3.max(nodes, n => n.x + TIER[n.tier].w / 2), y2: d3.max(nodes, n => n.y + TIER[n.tier].h / 2) };

    // origin for entering nodes: where the clicked person used to be
    const prevNode = lastFocus && gCards.selectAll('.card').filter(d => d.p && d.p.id === focus.id).node();
    const prev = prevNode ? d3.select(prevNode).datum() : null;
    const ox = prev ? prev.x : 0, oy = prev ? prev.y : 0;

    gLabels.selectAll('text').data(labels, d => d.text).join(
      en => en.append('text').attr('class', 'gen-label').attr('opacity', 0).attr('x', minX - 30).attr('y', d => d.y + 4).attr('text-anchor', 'end').text(d => d.text),
      up => up, ex => ex.transition(tr).attr('opacity', 0).remove()
    ).transition(tr).attr('opacity', 1).attr('x', minX - 30).attr('y', d => d.y + 4);

    gLinks.selectAll('path').data(links, d => d.key).join(
      en => en.append('path').attr('d', elbow).attr('opacity', 0),
      up => up, ex => ex.transition(tr).attr('opacity', 0).remove()
    ).attr('class', d => `link ${d.type}${d.ghost ? ' ghost' : ''}`)
      .transition(tr).attr('d', elbow).attr('opacity', 1);

    const cards = gCards.selectAll('.card').data(nodes, d => d.key).join(
      en => {
        const g = en.append('g').attr('class', 'card').attr('opacity', 0)
          .attr('transform', d => `translate(${(d.x + ox) / 2},${(d.y + oy) / 2}) scale(.85)`);
        g.append('rect').attr('class', 'bg').attr('rx', 2);
        g.append('rect').attr('class', 'frame').attr('rx', 1);
        g.append('line').attr('class', 'rule');
        g.append('circle').attr('class', 'av');
        g.append('image').attr('class', 'avph').attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', 'url(#tree-round)').style('display', 'none');
        g.append('circle').attr('class', 'avr');
        g.append('circle').attr('class', 'home-mark').attr('r', 2.5);
        const txt = g.append('g').attr('class', 'txt');
        txt.append('text').attr('class', 'avt').attr('text-anchor', 'middle');
        txt.append('text').attr('class', 'nm');
        txt.append('text').attr('class', 'sn');
        txt.append('text').attr('class', 'yr');
        txt.append('text').attr('class', 'rel').attr('text-anchor', 'end');
        return g;
      },
      up => up,
      ex => ex.transition(tr).attr('opacity', 0).attr('transform', d => `translate(${d.x},${d.y}) scale(.7)`).remove()
    );

    cards.each(function (d) {
      const g = d3.select(this);
      const { T, left, tx, textW, footW } = build(g, d);
      g.classed('focus', !!d.focus).classed('ghost', !!d.ghost).classed('sib', !!d.sib);
      if (d.ghost) {
        g.classed('is-home', false).attr('tabindex', null).attr('role', null).attr('aria-label', null);
        g.select('.av').style('fill', 'none').style('stroke', null);
        g.select('.avph').style('display', 'none');
        g.select('.avt').text('?').attr('opacity', null);
        g.select('.rel').text('');
        g.select('.yr').text('');
        fitText(g.select('.nm'), d.ghost === 'father' ? 'Unknown father' : 'Unknown mother', textW);
        fitText(g.select('.sn'), d.tier === 'far' ? '' : 'waiting to be found', textW);
        return;
      }
      const p = d.p;
      const isHome = p.id === app.homeId;
      const rel = home && !isHome ? t.relationship(home, p) : null;
      const relLabel = isHome ? 'home person' : rel ? rel.label : d.spouse ? 'spouse' : '';
      const hue = U.surnameColor(p.surname);
      g.classed('is-home', isHome).attr('tabindex', 0).attr('role', 'button');
      g.select('.av').style('fill', `color-mix(in oklch, ${hue} 20%, var(--card))`).style('stroke', hue);
      g.select('.avt').text(U.initials(p));
      // a matched photo covers the initials once its thumbnail is ready
      const ph = app.photoOf(p.id), img = g.select('.avph');
      if (ph) {
        Photos.thumb(ph.photo.path).then(url => {
          if (!url || g.datum().p !== p) return;
          img.attr('href', url).style('display', null);
          g.select('.avt').attr('opacity', 0);
        });
      } else { img.style('display', 'none').attr('href', null); g.select('.avt').attr('opacity', null); }

      const given = p.given || 'Unknown', first = given.split(' ')[0];
      const life = t.lifespan(p) || (p.living ? 'living' : '');
      if (d.tier === 'far') {
        fitText(g.select('.nm'), [first, p.surname].filter(Boolean).join(' '), textW);
        g.select('.sn').text('');
      } else {
        fitText(g.select('.nm'), given, textW);
        fitText(g.select('.sn'), p.surname || '', textW);
      }
      if (T.foot) {
        // dates take what they need on the left; the relationship gets the rest of the footer
        const used = fitText(g.select('.yr'), d.married ? [life, `m. ${d.married}`].filter(Boolean).join(' · ') : life, footW * 0.62);
        fitText(g.select('.rel'), relLabel, footW - used - (used ? 12 : 0));
      } else {
        fitText(g.select('.yr'), life, textW);
        g.select('.rel').text('');
      }
      g.attr('aria-label', [p.name, life, relLabel].filter(Boolean).join(', '));
    });

    const tipFor = d => {
      const p = d.p, bits = [];
      if (p.id === app.homeId) bits.push('Home person');
      else if (home) { const rel = t.relationship(home, p); if (rel) bits.push(`${home.given.split(' ')[0] || home.name}'s ${rel.label}`); }
      if (d.married) bits.push(`married ${d.married}`);
      else if (d.partner) bits.push(`partner ${d.partner.name}`);
      return U.tipHtml(t, p, bits.join(' · '));
    };
    cards.on('click', (e, d) => { if (d.p) app.go(d.p.id); })
      .on('keydown', (e, d) => { if (d.p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.go(d.p.id); } })
      .on('mouseenter', (e, d) => d.p && U.tip(tipFor(d), e))
      .on('mousemove', e => U.moveTip(e))
      .on('mouseleave', U.hideTip);

    cards.transition(tr).attr('opacity', 1).attr('transform', d => `translate(${d.x},${d.y})`);

    if (!opts.still) fit(lastFocus != null);
    lastFocus = focus.id;
  }

  function fit(animate) {
    if (!bounds) return;
    const b = { x: bounds.x, y: bounds.y, width: bounds.x2 - bounds.x, height: bounds.y2 - bounds.y };
    const w = app.visibleWidth(el), h = el.clientHeight;
    if (!el.clientWidth) return;
    // Fit to content, but keep the focus card in the middle so it stays the anchor.
    const k = Math.min(1.05, Math.max(0.3, Math.min(w / (b.width + 60), (h - 60) / (b.height + 120))));
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const target = d3.zoomIdentity.translate(w / 2 - cx * k, h / 2 - cy * k + 20).scale(k);
    (animate ? svg.transition().duration(650) : svg).call(zoom.transform, target);
  }

  return {
    init, render,
    reset() { lastFocus = null; },
    onResize() { if (svg) fit(true); },
    hint: 'Click anyone to bring them to the center · scroll to zoom · drag to pan',
  };
})();
