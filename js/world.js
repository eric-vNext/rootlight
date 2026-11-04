// World history for the timeline: eras, key events, and public-domain imagery fetched from Wikimedia Commons.
window.World = (function () {
  // cat drives the fallback artwork colour and the medallion ring
  const CATS = {
    war: { name: 'Conflict', hue: 4 },
    politics: { name: 'Politics', hue: 265 },
    science: { name: 'Science', hue: 190 },
    culture: { name: 'Culture', hue: 320 },
    travel: { name: 'Exploration', hue: 150 },
    disaster: { name: 'Hardship', hue: 28 },
    tech: { name: 'Invention', hue: 45 },
  };

  const ERAS = [
    { y: 1450, end: 1600, name: 'Age of Discovery' },
    { y: 1600, end: 1685, name: 'Age of Sail' },
    { y: 1685, end: 1765, name: 'Enlightenment' },
    { y: 1765, end: 1848, name: 'Age of Revolution' },
    { y: 1848, end: 1901, name: 'Age of Steam' },
    { y: 1901, end: 1914, name: 'Belle Époque' },
    { y: 1914, end: 1919, name: 'The Great War' },
    { y: 1919, end: 1939, name: 'Jazz Age & Depression' },
    { y: 1939, end: 1945, name: 'Second World War' },
    { y: 1945, end: 1973, name: 'Atomic & Space Age' },
    { y: 1973, end: 2000, name: 'Information Age' },
    { y: 2000, end: 2100, name: 'Connected Age' },
  ];

  // wiki: English Wikipedia article for the summary (and, by default, its lead image)
  // img: a Commons file to use instead, where the lead image isn't public domain
  const EVENTS = [
    { y: 1492, label: 'Columbus reaches the Americas', wiki: 'Voyages of Christopher Columbus', img: 'Landing of Columbus (2) (cropped).jpg', cat: 'travel' },
    { y: 1517, label: 'Protestant Reformation begins', wiki: 'Ninety-five Theses', cat: 'politics' },
    { y: 1588, label: 'Spanish Armada defeated', wiki: 'Spanish Armada', cat: 'war' },
    { y: 1620, label: 'Mayflower sails to America', wiki: 'Mayflower', cat: 'travel' },
    { y: 1642, end: 1651, label: 'English Civil War', wiki: 'English Civil War', cat: 'war' },
    { y: 1666, label: 'Great Fire of London', wiki: 'Great Fire of London', cat: 'disaster' },
    { y: 1687, label: 'Newton publishes the Principia', wiki: 'Philosophiæ Naturalis Principia Mathematica', cat: 'science' },
    { y: 1755, label: 'Lisbon earthquake', wiki: '1755 Lisbon earthquake', cat: 'disaster' },
    { y: 1769, label: "Cook's first Pacific voyage", wiki: 'First voyage of James Cook', img: 'The Bark, Earl of Pembroke, later Endeavour, leaving Whitby Harbour in 1768 (cropped).jpg', cat: 'travel' },
    { y: 1776, label: 'American Declaration of Independence', wiki: 'United States Declaration of Independence', cat: 'politics' },
    { y: 1789, label: 'French Revolution begins', wiki: 'Storming of the Bastille', cat: 'politics' },
    { y: 1796, label: 'First smallpox vaccine', wiki: 'Edward Jenner', cat: 'science' },
    { y: 1803, end: 1815, label: 'Napoleonic Wars', wiki: 'Napoleonic Wars', img: 'Charge of the French Cuirassiers at Waterloo.jpg', cat: 'war' },
    { y: 1816, label: 'The Year Without a Summer', wiki: 'Year Without a Summer', img: 'Friedrich, Caspar David - Mönch am Meer - Alte Nationalgalerie in Berlin.jpg', cat: 'disaster' },
    { y: 1825, label: 'First passenger railway opens', wiki: 'Locomotion No. 1', cat: 'tech' },
    { y: 1837, label: 'Queen Victoria crowned', wiki: 'Coronation of Queen Victoria', cat: 'politics' },
    { y: 1839, label: 'Photography is born', wiki: 'Daguerreotype', cat: 'tech' },
    { y: 1845, end: 1852, label: 'Great Irish Famine', wiki: 'Great Famine (Ireland)', cat: 'disaster' },
    { y: 1848, label: 'Revolutions sweep Europe', wiki: 'Revolutions of 1848', cat: 'politics' },
    { y: 1849, label: 'California Gold Rush', wiki: 'California gold rush', cat: 'travel' },
    { y: 1851, label: 'The Great Exhibition', wiki: 'The Crystal Palace', cat: 'culture' },
    { y: 1859, label: 'Darwin publishes On the Origin of Species', wiki: 'On the Origin of Species', cat: 'science' },
    { y: 1861, end: 1865, label: 'American Civil War', wiki: 'American Civil War', cat: 'war' },
    { y: 1869, label: 'Transcontinental railroad completed', wiki: 'First transcontinental railroad', cat: 'tech' },
    { y: 1876, label: 'Telephone patented', wiki: 'Invention of the telephone', img: 'AGBell Notebook.jpg', cat: 'tech' },
    { y: 1879, label: 'The electric light bulb', wiki: 'Incandescent light bulb', img: 'Edison incandescent lights.jpg', cat: 'tech' },
    { y: 1886, label: 'Statue of Liberty unveiled', wiki: 'Statue of Liberty', cat: 'culture' },
    { y: 1889, label: 'Eiffel Tower opens', wiki: 'Eiffel Tower', cat: 'culture' },
    { y: 1892, label: 'Ellis Island opens', wiki: 'Ellis Island', img: 'Arriving at Ellis Island LCCN2014710704.jpg', cat: 'travel' },
    { y: 1896, label: 'First modern Olympic Games', wiki: '1896 Summer Olympics', cat: 'culture' },
    { y: 1903, label: 'First powered flight', wiki: 'Wright Flyer', cat: 'tech' },
    { y: 1908, label: 'Ford Model T rolls out', wiki: 'Ford Model T', cat: 'tech' },
    { y: 1912, label: 'Titanic sinks', wiki: 'Sinking of the Titanic', cat: 'disaster' },
    { y: 1914, end: 1918, label: 'First World War', wiki: 'World War I', cat: 'war' },
    { y: 1918, label: 'Influenza pandemic', wiki: 'Spanish flu', cat: 'disaster' },
    { y: 1920, label: 'Women win the vote in the US', wiki: 'Nineteenth Amendment to the United States Constitution', cat: 'politics' },
    { y: 1927, label: 'Lindbergh flies the Atlantic', wiki: 'Spirit of St. Louis', img: 'Charles Lindbergh and the Spirit of Saint Louis (Crisco restoration, with wings).jpg', cat: 'travel' },
    { y: 1929, label: 'Wall Street Crash', wiki: 'Wall Street crash of 1929', cat: 'disaster' },
    { y: 1934, label: 'The Dust Bowl', wiki: 'Dust Bowl', cat: 'disaster' },
    { y: 1939, end: 1945, label: 'Second World War', wiki: 'World War II', img: 'Approaching Omaha.jpg', cat: 'war' },
    { y: 1947, label: 'India and Pakistan independent', wiki: 'Indian independence movement', cat: 'politics' },
    { y: 1953, label: 'Everest summited · DNA decoded', wiki: '1953 British Mount Everest expedition', cat: 'travel' },
    { y: 1956, label: 'Hungarian Revolution', wiki: 'Hungarian Revolution of 1956', cat: 'politics' },
    { y: 1957, label: 'Sputnik opens the Space Age', wiki: 'Sputnik 1', cat: 'science' },
    { y: 1963, label: '"I Have a Dream"', wiki: 'March on Washington for Jobs and Freedom', cat: 'politics' },
    { y: 1969, label: 'First Moon landing', wiki: 'Apollo 11', cat: 'science' },
    { y: 1981, label: 'The personal computer arrives', wiki: 'IBM Personal Computer', cat: 'tech' },
    { y: 1989, label: 'Berlin Wall falls', wiki: 'Fall of the Berlin Wall', img: 'Crane removed part of Wall Brandenburg Gate.jpg', cat: 'politics' },
    { y: 1991, label: 'World Wide Web goes public', wiki: 'World Wide Web', img: 'The Blue Marble, AS17-148-22727.jpg', cat: 'tech' },
    { y: 2007, label: 'First iPhone', wiki: 'IPhone (1st generation)', cat: 'tech' },
    { y: 2020, label: 'COVID-19 pandemic', wiki: 'COVID-19 pandemic', img: 'USNS Comfort New York City 2020.jpg', cat: 'disaster' },
  ];

  const OVERRIDE = new Map(EVENTS.filter(e => e.img).map(e => [e.wiki, e.img]));
  const eraAt = y => ERAS.find(e => y >= e.y && y < e.end);

  // --- imagery --------------------------------------------------------------
  // Two batched lookups: Wikipedia gives each article's lead image and a short summary,
  // then Commons confirms the image's licence. Only public-domain / CC0 images are kept;
  // anything else (including local fair-use files) falls back to generated artwork.
  const CACHE_KEY = 'rootlight.world.v3';
  const FREE = /public domain|^pd|cc0|no restrictions/i;
  let memo = null, pending = null;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
  }
  function writeCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  }
  const strip = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim().replace(/\s+/g, ' '); };
  const api = (host, params) => fetch(`https://${host}/w/api.php?` + new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params }))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

  async function fetchBatch(titles) {
    const a = await api('en.wikipedia.org', {
      redirects: 1, prop: 'pageimages|extracts', piprop: 'name', exintro: 1, explaintext: 1, exsentences: 2, exlimit: 20,
      titles: titles.join('|'),
    });
    // follow normalisation and redirects back to the title we asked for
    const alias = new Map();
    for (const n of a.query.normalized || []) alias.set(n.to, n.from);
    for (const r of a.query.redirects || []) alias.set(r.to, alias.get(r.from) || r.from);
    const out = {};
    const byFile = new Map();
    for (const p of Object.values(a.query.pages)) {
      const asked = alias.get(p.title) || p.title;
      out[asked] = { extract: p.extract || '', page: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` };
      const file = OVERRIDE.get(asked) || p.pageimage;
      if (file) byFile.set('File:' + file.replace(/_/g, ' '), asked);
    }
    if (byFile.size) {
      const c = await api('commons.wikimedia.org', {
        prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: 1400,
        titles: [...byFile.keys()].join('|'),
      });
      const cn = new Map((c.query.normalized || []).map(n => [n.to, n.from]));
      for (const p of Object.values(c.query.pages)) {
        const info = p.imageinfo && p.imageinfo[0];
        const asked = byFile.get(cn.get(p.title) || p.title);
        if (!info || !asked) continue;
        const md = info.extmetadata || {};
        const license = md.LicenseShortName ? strip(md.LicenseShortName.value) : '';
        if (!FREE.test(license)) continue;
        const src = (info.thumburl || info.url).replace(/\?.*$/, '');
        out[asked].img = src;
        out[asked].thumb = src.replace(/\/\d+px-/, '/120px-');
        out[asked].credit = { artist: md.Artist ? strip(md.Artist.value).slice(0, 80) : '', license, page: info.descriptionurl };
      }
    }
    return out;
  }

  // Resolves to { [wiki title]: { extract, page, img?, thumb?, credit? } }. Never rejects.
  function imagery() {
    if (memo) return Promise.resolve(memo);
    if (pending) return pending;
    const cache = readCache();
    const missing = EVENTS.map(e => e.wiki).filter(w => !cache[w]);
    if (!missing.length) return Promise.resolve(memo = cache);
    const batches = [];
    for (let i = 0; i < missing.length; i += 20) batches.push(missing.slice(i, i + 20));
    pending = Promise.all(batches.map(b => fetchBatch(b).catch(() => ({}))))
      .then(parts => {
        memo = Object.assign(cache, ...parts);
        writeCache(memo);
        return memo;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  return { CATS, ERAS, EVENTS, eraAt, imagery };
})();
