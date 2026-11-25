// Gives the installed Rootlight app (Claude's "Install as app") its own Dock and window icon: the sprout logo from
// the favicon, gold on a night-sky tile. Only does anything inside the installed app's window; on the website and
// the artifact page window.claude is missing or offers no `app` module. Exposes window.AppIcon.draw for previewing.
window.AppIcon = (function () {
  // Draws the icon on a square canvas and returns a PNG data URL. macOS doesn't round or pad it, so the tile
  // keeps the standard icon-grid margin and corner radius itself.
  function draw(size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const u = size / 1024;                 // work in Apple's 1024 icon grid
    const inset = 100 * u, box = 824 * u, r = 185 * u;

    // night tile
    g.save();
    g.beginPath();
    g.roundRect(inset, inset, box, box, r);
    g.clip();
    const sky = g.createLinearGradient(0, inset, 0, inset + box);
    sky.addColorStop(0, '#1c2554');
    sky.addColorStop(1, '#0a0f22');
    g.fillStyle = sky;
    g.fillRect(0, 0, size, size);
    const glow = g.createRadialGradient(512 * u, 560 * u, 0, 512 * u, 560 * u, 420 * u);
    glow.addColorStop(0, 'rgba(242, 196, 109, 0.22)');
    glow.addColorStop(1, 'rgba(242, 196, 109, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    // a few fixed stars, like the app's sky
    for (const [x, y, s, a] of [[230, 250, 5, .8], [760, 210, 4, .7], [820, 420, 3, .5], [200, 520, 3, .45], [300, 800, 4, .4], [780, 760, 5, .55], [620, 160, 3, .5], [400, 190, 2.5, .45]]) {
      g.fillStyle = `rgba(230, 225, 255, ${a})`;
      g.beginPath(); g.arc(x * u, y * u, s * u, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    // the sprout from the favicon (64-unit viewBox), centred on the tile
    const k = 11 * u, ox = 512 * u - 32 * k, oy = 540 * u - 35 * k;
    const P = (x, y) => [ox + x * k, oy + y * k];
    g.strokeStyle = g.fillStyle = '#f2c46d';
    g.lineCap = 'round';
    g.lineWidth = 4.2 * k;
    g.shadowColor = 'rgba(242, 196, 109, 0.55)';
    g.shadowBlur = 40 * u;
    for (const [[x1, y1], [x2, y2]] of [[[32, 54], [32, 30]], [[32, 38], [22, 29]], [[32, 34], [41, 26]], [[32, 44], [40, 38]]]) {
      g.beginPath(); g.moveTo(...P(x1, y1)); g.lineTo(...P(x2, y2)); g.stroke();
    }
    for (const [x, y, rr] of [[22, 28, 4.4], [42, 25, 4.4], [32, 18, 5.6], [40.5, 37.5, 2.6]]) {
      g.beginPath(); g.arc(...P(x, y), rr * k, 0, Math.PI * 2); g.fill();
    }
    return c.toDataURL('image/png');
  }

  async function apply() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    let desktop = null;
    try { desktop = await window.claude.use('desktop'); } catch { return; }
    const dock = desktop && desktop.app && desktop.app.dock;
    if (!dock) return; // not the installed app's window
    try { await dock.setIcon(draw(512)); } catch (e) { console.warn('Rootlight: could not set the app icon', e); }
  }

  apply();
  return { draw };
})();
