// Hourglass tree: ancestors above, descendants below, siblings and spouses alongside.
window.TreeView = (function () {
  const W = 184, H = 70, GAP = 22, ROW = H + 64;
  const GEN_UP = ['', 'Parents', 'Grandparents', 'Great-grandparents', '2× great-grandparents', '3× great-grandparents', '4× great-grandparents', '5× great-grandparents'];
  const GEN_DOWN = ['', 'Children', 'Grandchildren', 'Great-grandchildren', '2× great-grandchildren'];
  let el, app, svg, root, gLinks, gCards, gLabels, zoom, up = 3, down = 2, lastFocus = null, ctl, bounds = null;

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function init(container, ctx) {
    el = container; app = ctx;
    svg = d3.select(el).append('svg');
    root = svg.append('g');
    gLabels = root.append('g');
    gLinks = root.append('g');
    gCards = root.append('g');
    zoom = d3.zoom().scaleExtent([0.15, 2.2]).on('zoom', e => root.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);
    ctl = d3.select(el).append('div').attr('class', 'fan-legend');
    ctl.html(`
      <div class="seg" title="Generations of ancestors"><button disabled style="opacity:.6">Ancestors</button><button data-k="up" data-d="-1">−</button><button class="on" data-v="up">${up}</button><button data-k="up" data-d="1">+</button></div>
      <div class="seg" title="Generations of descendants"><button disabled style="opacity:.6">Descendants</button><button data-k="down" data-d="-1">−</button><button class="on" data-v="down">${down}</button><button data-k="down" data-d="1">+</button></div>
      <div class="seg"><button data-fit>⤢ Fit</button></div>`);
    ctl.selectAll('[data-k]').on('click', function () {
      const k = this.dataset.k, d = +this.dataset.d;
      if (k === 'up') up = Math.max(1, Math.min(7, up + d)); else down = Math.max(0, Math.min(4, down + d));
      ctl.select('[data-v=up]').text(up); ctl.select('[data-v=down]').text(down);
      render(app.focus, { fit: true });
    });
    ctl.select('[data-fit]').on('click', () => fit(true));
  }

  function layout(focus) {
    const t = app.tree;
    const nodes = [], links = [], labels = [];
    const seen = new Map();
    const key = id => { const n = (seen.get(id) || 0) + 1; seen.set(id, n); return n === 1 ? id : `${id}#${n}`; };

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
    d3.tree().nodeSize([W + GAP, ROW]).separation((a, b) => a.parent === b.parent ? 1 : 1.12)(ancRoot);
    let maxUp = 0;
    ancRoot.each(n => {
      if (n.depth === 0) return;
      maxUp = Math.max(maxUp, n.depth);
      const x = n.x, y = -n.depth * ROW;
      if (n.data.ghost) nodes.push({ key: `ghost-${n.parent.data.p.id}-${n.data.ghost}`, ghost: n.data.ghost, x, y });
      else nodes.push({ key: key(n.data.p.id), p: n.data.p, x, y });
      links.push({ key: `a-${n.parent.data.p ? n.parent.data.p.id : ''}-${n.data.p ? n.data.p.id : n.data.ghost}-${n.depth}`, type: 'up', sx: x, sy: y + H / 2, tx: n.parent.x, ty: -n.parent.depth * ROW - H / 2, ghost: !!n.data.ghost });
      if (n.parent && n.parent.children && n.parent.children[0] === n && n.parent.children[1]) {
        const o = n.parent.children[1];
        if (!n.data.ghost && !o.data.ghost) links.push({ key: `m-${n.data.p.id}-${o.data.p.id}`, type: 'marriage', sx: x + W / 2, sy: y, tx: o.x - W / 2, ty: y });
      }
    });

    // focus
    nodes.push({ key: key(focus.id), p: focus, x: 0, y: 0, focus: true });

    // siblings to the left
    const sibs = t.siblings(focus);
    const fb = t.birthYear(focus) ?? 0;
    const older = sibs.filter(s => (t.birthYear(s) ?? 0) <= fb), younger = sibs.filter(s => (t.birthYear(s) ?? 0) > fb);
    const sibRow = [...older, ...younger];
    const parentsY = -ROW;
    const famX = ancRoot.children ? (ancRoot.children[0].x + (ancRoot.children[1] ? ancRoot.children[1].x : ancRoot.children[0].x)) / 2 : 0;
    sibRow.reverse().forEach((s, i) => {
      const x = -(i + 1) * (W + GAP * 0.6);
      nodes.push({ key: key(s.id), p: s, x, y: 0, sib: true });
      links.push({ key: `s-${s.id}`, type: 'sib', sx: famX, sy: parentsY + H / 2, tx: x, ty: -H / 2 });
    });

    // spouses to the right; descendants below each union
    const unions = t.unions(focus);
    let cursorX = 0;
    let unionMids = [];
    unions.forEach((u, i) => {
      let mid = 0;
      if (u.spouse) {
        const x = (i + 1) * (W + GAP);
        nodes.push({ key: key(u.spouse.id), p: u.spouse, x, y: 0, spouse: true, married: u.family.marriage && u.family.marriage.date ? u.family.marriage.date.year : null });
        links.push({ key: `fm-${u.spouse.id}`, type: 'marriage', sx: (i === 0 ? W / 2 : x - GAP - W / 2), sy: 0, tx: x - W / 2, ty: 0 });
        mid = i === 0 ? x / 2 : x - (W + GAP) / 2;
      }
      unionMids.push(mid);
    });

    if (down > 0) {
      const descRoot = d3.hierarchy({ p: focus, depth: 0 }, d => {
        if (d.depth >= down) return null;
        const kids = d.depth === 0 ? unions.flatMap((u, ui) => u.children.map(c => ({ p: c, ui }))) : t.children(d.p).map(c => ({ p: c }));
        return kids.map(k => ({ ...k, depth: d.depth + 1 }));
      });
      d3.tree().nodeSize([W + GAP, ROW]).separation((a, b) => a.parent === b.parent ? 1 : 1.15)(descRoot);
      const offset = unionMids.length ? d3.mean(unionMids) : 0;
      descRoot.each(n => {
        if (n.depth === 0) return;
        const x = n.x + offset, y = n.depth * ROW;
        const sp = t.spouses(n.data.p);
        nodes.push({ key: key(n.data.p.id), p: n.data.p, x, y, partner: sp[0] });
        let sx, sy;
        if (n.depth === 1) { sx = unionMids[n.data.ui] ?? 0; sy = 0; }
        else { sx = n.parent.x + offset; sy = n.parent.y + H / 2; }
        links.push({ key: `d-${n.data.p.id}-${n.depth}`, type: 'down', sx, sy: n.depth === 1 ? (unions[n.data.ui] && unions[n.data.ui].spouse ? 0 : H / 2) : sy, tx: x, ty: y - H / 2 });
      });
      for (let g = 1; g <= Math.min(down, descRoot.height); g++) labels.push({ y: g * ROW, text: GEN_DOWN[g] || `${g - 2}× great-grandchildren` });
    }
    for (let g = 1; g <= maxUp; g++) labels.push({ y: -g * ROW, text: GEN_UP[g] || `${g - 2}× great-grandparents` });
    labels.push({ y: 0, text: sibRow.length ? 'Siblings & self' : 'Self' });
    return { nodes, links, labels };
  }

  function elbow(d) {
    if (d.type === 'marriage') return `M${d.sx},${d.sy}L${d.tx},${d.ty}`;
    const my = (d.sy + d.ty) / 2;
    return `M${d.sx},${d.sy}V${my}H${d.tx}V${d.ty}`;
  }

  function render(focus, opts = {}) {
    const t = app.tree;
    const home = app.home;
    const { nodes, links, labels } = layout(focus);
    const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    const tr = d3.transition().duration(dur).ease(d3.easeCubicInOut);
    const minX = d3.min(nodes, n => n.x) - W / 2;
    bounds = { x: minX - 170, y: d3.min(nodes, n => n.y) - H / 2, x2: d3.max(nodes, n => n.x) + W / 2, y2: d3.max(nodes, n => n.y) + H / 2 };

    // origin for entering nodes: where the clicked person used to be
    const prevNode = lastFocus && gCards.selectAll('.card').filter(d => d.p && d.p.id === focus.id).node();
    const prev = prevNode ? d3.select(prevNode).datum() : null;
    const ox = prev ? prev.x : 0, oy = prev ? prev.y : 0;

    gLabels.selectAll('text').data(labels, d => d.text).join(
      en => en.append('text').attr('class', 'gen-label').attr('opacity', 0).attr('x', minX - 30).attr('y', d => d.y + 4).attr('text-anchor', 'end').text(d => d.text),
      up => up, ex => ex.transition(tr).attr('opacity', 0).remove()
    ).transition(tr).attr('opacity', 1).attr('x', minX - 30).attr('y', d => d.y + 4);

    gLinks.selectAll('path').data(links, d => d.key).join(
      en => en.append('path').attr('class', d => `link ${d.type === 'marriage' ? 'marriage' : ''}`).attr('d', elbow).attr('opacity', 0).style('stroke-dasharray', d => d.ghost ? '3 4' : null),
      up => up, ex => ex.transition(tr).attr('opacity', 0).remove()
    ).transition(tr).attr('d', elbow).attr('opacity', d => d.ghost ? 0.4 : 1);

    const cards = gCards.selectAll('.card').data(nodes, d => d.key).join(
      en => {
        const g = en.append('g').attr('class', 'card').attr('opacity', 0)
          .attr('transform', d => `translate(${(d.x + ox) / 2},${(d.y + oy) / 2}) scale(.85)`);
        g.append('rect').attr('class', 'bg').attr('x', -W / 2).attr('y', -H / 2).attr('width', W).attr('height', H).attr('rx', 14);
        g.append('rect').attr('class', 'strip').attr('x', -W / 2).attr('y', -H / 2 + 12).attr('width', 3.5).attr('height', H - 24).attr('rx', 2);
        g.append('circle').attr('class', 'av').attr('cx', -W / 2 + 28).attr('cy', 0).attr('r', 17);
        g.append('text').attr('class', 'avt').attr('x', -W / 2 + 28).attr('y', 5).attr('text-anchor', 'middle').style('font', '500 13px Fraunces, serif').style('fill', '#fff');
        g.append('text').attr('class', 'rel').attr('x', -W / 2 + 54).attr('y', -H / 2 + 17);
        g.append('text').attr('class', 'nm').attr('x', -W / 2 + 54).attr('y', -2);
        g.append('text').attr('class', 'sn').attr('x', -W / 2 + 54).attr('y', 14);
        g.append('text').attr('class', 'yr').attr('x', -W / 2 + 54).attr('y', H / 2 - 10);
        return g;
      },
      up => up,
      ex => ex.transition(tr).attr('opacity', 0).attr('transform', d => `translate(${d.x},${d.y}) scale(.7)`).remove()
    );

    cards.classed('focus', d => !!d.focus).classed('ghost', d => !!d.ghost);
    cards.each(function (d) {
      const g = d3.select(this);
      if (d.ghost) {
        g.select('.strip').attr('fill', 'none');
        g.select('.av').attr('fill', 'none').attr('stroke', U.css('--line-strong')).attr('stroke-dasharray', '3 3');
        g.select('.avt').text('?').style('fill', U.css('--ink-3'));
        g.select('.rel').text('');
        g.select('.nm').text(d.ghost === 'father' ? 'Unknown father' : 'Unknown mother');
        g.select('.sn').text('waiting to be found');
        g.select('.yr').text('');
        return;
      }
      const p = d.p;
      const rel = home && home.id !== p.id ? t.relationship(home, p) : null;
      g.select('.strip').attr('fill', U.sexColor(p));
      g.select('.av').attr('fill', U.surnameColor(p.surname, U.isNight() ? 40 : 45)).attr('stroke', d.focus ? U.css('--gold') : 'none').attr('stroke-width', 2).attr('stroke-dasharray', null);
      g.select('.avt').text(U.initials(p)).style('fill', '#fff');
      g.select('.rel').text(p.id === app.homeId ? '⌂ home' : rel ? clip(rel.label, 24) : d.spouse ? 'spouse' : '');
      g.select('.nm').text(clip(p.given || 'Unknown', 17));
      g.select('.sn').text(clip(p.surname || '', 18));
      const life = t.lifespan(p);
      g.select('.yr').text(d.married ? `${life} · m. ${d.married}` : d.partner ? `${life}${life ? ' · ' : ''}⚭ ${clip(d.partner.given.split(' ')[0], 10)}` : life || (p.living ? 'living' : ''));
    });

    cards.on('click', (e, d) => { if (d.p) app.go(d.p.id); })
      .on('mouseenter', (e, d) => d.p && U.tip(U.tipHtml(t, d.p), e))
      .on('mousemove', e => U.moveTip(e))
      .on('mouseleave', U.hideTip);

    cards.transition(tr).attr('opacity', 1).attr('transform', d => `translate(${d.x},${d.y})`);

    fit(lastFocus != null);
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
