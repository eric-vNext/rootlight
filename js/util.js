// Shared helpers. Exposes window.U.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isNight = () => document.documentElement.dataset.theme !== 'parchment';

  // Each surname gets its own stable hue, so families read as color bands.
  function surnameColor(surname, l) {
    const h = hash((surname || '?').toLowerCase()) % 360;
    return `hsl(${h} ${isNight() ? 55 : 45}% ${l ?? (isNight() ? 58 : 42)}%)`;
  }
  function sexColor(p) { return p.sex === 'M' ? css('--male') : p.sex === 'F' ? css('--female') : css('--unknown'); }
  function avatarBg(p) {
    const a = surnameColor(p.surname, isNight() ? 42 : 40), b = surnameColor(p.given, isNight() ? 30 : 30);
    return `linear-gradient(135deg, ${a}, ${b})`;
  }
  function initials(p) {
    const g = (p.given || '').trim()[0] || '';
    const s = (p.surname || '').trim()[0] || '';
    return (g + s).toUpperCase() || '?';
  }
  // data-photo makes js/photos.js swap the person's picture in once it is ready; the initials stay underneath until then
  function photoAttr(p) {
    const ph = window.App && App.tree && App.photoOf(p.id);
    return ph ? ` data-photo="${esc(ph.photo.path)}"` : '';
  }
  function dot(p, cls = 'dot') {
    return `<span class="${cls}" style="background:${avatarBg(p)}"${photoAttr(p)}>${esc(initials(p))}</span>`;
  }
  const centuryColor = d3.scaleSequential(d3.interpolateRgbBasis(['#6a5acd', '#3f8fd2', '#2bb39a', '#a6c34a', '#f2b544', '#ec6f5a', '#d6497b']));

  // ---------- tooltip ----------
  const tipEl = () => document.getElementById('tooltip');
  function tip(html, evt) {
    const t = tipEl();
    t.innerHTML = html;
    t.classList.add('show');
    moveTip(evt);
  }
  function moveTip(evt) {
    const t = tipEl();
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { tipEl().classList.remove('show'); }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = document.getElementById('toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // A light world-history backdrop, used by the timeline and the story panel.
  const WORLD = window.World.EVENTS;

  function personChip(tree, p, sub) {
    const life = tree.lifespan(p);
    return `<button class="person-chip" data-goto="${esc(p.id)}">
      ${dot(p)}
      <span><div class="nm">${esc(p.name)}</div><div class="sub">${esc([sub, life].filter(Boolean).join(' · '))}</div></span>
    </button>`;
  }

  function tipHtml(tree, p, extra) {
    const b = p.birth, d = p.death;
    const lines = [];
    if (b) lines.push(`b. ${Gedcom.formatDate(b.date) || '?'}${b.place ? ' · ' + Gedcom.placeShort(b.place) : ''}`);
    if (d) lines.push(`d. ${Gedcom.formatDate(d.date) || '?'}${d.place ? ' · ' + Gedcom.placeShort(d.place) : ''}`);
    if (p.occupation) lines.push(p.occupation);
    return `<b>${esc(p.name)}</b>${lines.map(l => `<div class="t-sub">${esc(l)}</div>`).join('')}${extra ? `<div style="color:var(--gold);margin-top:3px">${esc(extra)}</div>` : ''}`;
  }

  window.U = { esc, hash, css, isNight, surnameColor, sexColor, avatarBg, initials, photoAttr, dot, centuryColor, tip, moveTip, hideTip, toast, WORLD, personChip, tipHtml };
})();
