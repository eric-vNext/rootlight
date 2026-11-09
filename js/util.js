// Shared helpers. Exposes window.U.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isNight = () => document.documentElement.dataset.theme !== 'parchment';

  // Each surname gets its own stable hue, so families read as color bands. The hue is all that varies: lightness and
  // chroma are held low and even so no family shouts. tone 'line' is for hairlines, rings and type on the page
  // (it follows the theme); tone 'fill' is a deeper ink for solid areas that carry light lettering.
  function surnameColor(surname, tone) {
    const h = hash((surname || '?').toLowerCase()) % 360;
    if (tone === 'fill') return `oklch(0.5 0.08 ${h})`;
    return isNight() ? `oklch(0.72 0.065 ${h})` : `oklch(0.45 0.075 ${h})`;
  }
  function sexColor(p) { return p.sex === 'M' ? css('--male') : p.sex === 'F' ? css('--female') : css('--unknown'); }
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
    return `<span class="${cls}" style="--h:${surnameColor(p.surname)}"${photoAttr(p)}>${esc(initials(p))}</span>`;
  }
  // 0..1 → a muted ramp from iron blue through moss and ochre to oxide red
  const centuryColor = v => `oklch(${(0.46 + 0.1 * Math.sin(Math.PI * v)).toFixed(3)} 0.085 ${Math.round(255 - 225 * Math.max(0, Math.min(1, v)))})`;
  // n evenly spaced inks of equal weight, for categories
  const inkScale = n => d3.range(n).map(i => `oklch(${i % 2 ? 0.56 : 0.47} 0.085 ${Math.round(35 + i * 360 / Math.max(n, 1)) % 360})`);

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
    return `<b>${esc(p.name)}</b>${lines.map(l => `<div class="t-sub">${esc(l)}</div>`).join('')}${extra ? `<div class="t-rel">${esc(extra)}</div>` : ''}`;
  }

  window.U = { esc, hash, css, isNight, surnameColor, sexColor, initials, photoAttr, dot, centuryColor, inkScale, tip, moveTip, hideTip, toast, WORLD, personChip, tipHtml };
})();
