// Turns the loaded tree into the small, grounded text Claude reads when someone asks a question.
// Pure functions only (no DOM), so test/asktree.test.js can run them in node. Exposes window.AskTree.
//
// Two sharing scopes, chosen by the visitor:
//   'relevant' (default)  only the people a question points at, plus their parents, spouses and children
//   'all'                 every person in the file, as text (falls back to 'relevant' if the tree is too big)
// Photos, notes and source citations are never included in either.
//
// Living relatives: unless opts.includeLiving is true, anyone the tree marks as living (no death record and not
// born more than 110 years ago) is sent as their ID, sex and family links only: no name, dates, places, job or
// marriage years. Their names are also taken out of the question. The panel shows real names again on screen,
// because answers refer to people by ID. Every function here withholds by default.
(function () {
  const STOP = new Set(('a an and are as at be been born by can could did die died do does for from had has have he her his how i in is it its ' +
    'lived me my of on or our she that the their them there they this to was were what when where which who whom whose why will with would you your ' +
    'tell about any all list show give find family tree people person anyone someone ancestors ancestor relatives relative came come').split(' '));
  const ME = /\b(i|me|my|mine|myself|am)\b/;
  const KIN_UP = /\b(parents?|mother|father|mom|dad|grand\w*|great\w*|ancestors?|forebears?)\b/;
  const KIN_SIDE = /\b(cousins?|aunts?|uncles?|nieces?|nephews?|siblings?|brothers?|sisters?)\b/;
  const KIN_DOWN = /\b(children|child|kids?|sons?|daughters?|grandchildren|grandkids?|descendants?)\b/;
  const LONGEST = /\b(longest|oldest|old age|lived to|eldest|age[ds]?|lifespans?|shortest|youngest|young)\b/;
  const MOST_KIDS = /\b(most children|most kids|biggest famil\w*|largest famil\w*|how many children)\b/;
  const EARLIEST = /\b(earliest|first|oldest records?|furthest back|farthest back|latest|most recent|newest)\b/;

  const MAX_RELEVANT = 70;          // people lines in 'relevant' scope
  const MAX_ALL_CHARS = 180000;     // the runtime accepts 256 KiB per request; leave room for rules and chat turns
  const REL_LINES_LIMIT = 1500;     // above this, 'all' scope skips per-person relationship labels (they cost a walk each)

  const deaccent = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = s => deaccent(String(s || '').toLowerCase()).match(/[a-z0-9']+/g) || [];
  const fold = s => words(s).join(' ');

  // ---------- living relatives ----------
  const withheld = (p, opts) => !!p && p.living && !(opts && opts.includeLiving);
  // how a person is named in text sent to Claude
  const nm = (p, opts) => (withheld(p, opts) ? 'living person' : p.name);
  const who = (p, opts) => `${nm(p, opts)} (${p.id})`;

  function yearText(e) {
    if (!e || !e.date || e.date.year == null) return '';
    const s = e.date.raw.toUpperCase();
    if (/\bBEF\b/.test(s)) return `before ${e.date.year}`;
    if (/\bAFT\b/.test(s)) return `after ${e.date.year}`;
    return (e.date.approx ? '~' : '') + e.date.year;
  }
  function eventText(e) {
    if (!e) return '';
    return [yearText(e), e.place].filter(Boolean).join(' ');
  }

  // ---------- one line per person ----------
  // e.g. I12 | Maria Novak (F) | b. 1921 Budapest, Hungary | d. 2004 New York, USA | occupation: seamstress
  //      | parents: I5, I6 | spouses: I13 (m. 1946) | children: I20, I21 | to home: grandmother
  // A withheld living person: I2 | living person (M) | details withheld | parents: I5, I6 | to home: brother
  function personLine(tree, p, opts = {}) {
    const hide = withheld(p, opts);
    const bits = hide ? [`${p.id} | living person (${p.sex}) | details withheld`] : [`${p.id} | ${p.name}${p.nick ? ` "${p.nick}"` : ''} (${p.sex})`];
    if (!hide) {
      if (p.birth) bits.push(`${p.birth.tag === 'BIRT' ? 'b.' : 'chr.'} ${eventText(p.birth) || '?'}`);
      if (p.death) bits.push(`${p.death.tag === 'DEAT' ? 'd.' : 'bur.'} ${eventText(p.death) || '?'}`);
      else if (p.living) bits.push('no death recorded');
      const age = tree.ageAtDeath(p);
      if (age != null && age >= 0 && age < 120) bits.push(`lived ~${age} years`);
      if (p.occupation) bits.push(`occupation: ${p.occupation}`);
      const moves = p.events.filter(e => ['EMIG', 'IMMI', 'NATU', 'RESI', 'MILI', 'EDUC', 'GRAD', 'RELI'].includes(e.tag));
      for (const e of moves.slice(0, 4)) bits.push(`${window.Gedcom.EVENT_LABELS[e.tag].toLowerCase()}: ${[e.value, eventText(e)].filter(Boolean).join(' ')}`);
    }
    const par = tree.parents(p);
    if (par.length) bits.push(`parents: ${par.map(x => x.id).join(', ')}`);
    const unions = tree.unions(p).filter(u => u.spouse);
    if (unions.length) {
      bits.push(`spouses: ${unions.map(u => {
        if (hide || withheld(u.spouse, opts)) return u.spouse.id; // a marriage year would date a living person
        const m = u.family.marriage && yearText(u.family.marriage);
        return u.spouse.id + (m ? ` (m. ${m})` : '') + (u.family.divorce ? ' (divorced)' : '');
      }).join(', ')}`);
    }
    const kids = tree.children(p);
    if (kids.length) bits.push(`children: ${kids.map(x => x.id).join(', ')}`);
    if (opts.home && opts.withRel !== false) {
      const r = tree.relationship(opts.home, p);
      if (r) bits.push(`to home: ${r.label}`);
    }
    return bits.join(' | ');
  }

  // ---------- facts about the whole tree (aggregate, a few names) ----------
  function facts(tree, opts = {}) {
    const all = [...tree.people.values()];
    const shared = all.filter(p => !withheld(p, opts)); // counts of names, places and jobs come only from people we may describe
    const tally = (list, key) => {
      const m = new Map();
      for (const p of list) for (const k of key(p)) if (k) m.set(k, (m.get(k) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const surnames = tally(shared, p => [p.surname]);
    const places = tally(shared, p => p.events.filter(e => e.place).map(e => window.Gedcom.placeShort(e.place, 2)));
    const occupations = tally(shared, p => [p.occupation]);
    const lifespans = shared.map(p => ({ p, age: tree.ageAtDeath(p) })).filter(x => x.age != null && x.age >= 0 && x.age < 120).sort((a, b) => b.age - a.age);
    const mostKids = all.map(p => [p, tree.children(p).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const born = shared.filter(p => tree.birthYear(p) != null).sort((a, b) => tree.birthYear(a) - tree.birthYear(b));
    const years = shared.map(p => tree.birthYear(p)).filter(y => y != null); // a living person's birth year would show in the range
    const top = (list, n = 6) => list.slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');
    const hidden = all.length - shared.length;
    const lines = [
      `people: ${all.length}, families: ${tree.families.size}, with no death recorded: ${all.filter(p => p.living).length}` +
        (years.length ? `, births recorded from ${Math.min(...years)} to ${Math.max(...years)}` : '') +
        (hidden ? `, living relatives whose details are withheld: ${hidden}` : ''),
      surnames.length && `most common surnames${hidden ? ' (not counting withheld living relatives)' : ''}: ${top(surnames)}`,
      places.length && `most common places${hidden ? ' (same)' : ''}: ${top(places)}`,
      occupations.length && `most common occupations${hidden ? ' (same)' : ''}: ${top(occupations)}`,
      lifespans.length && `longest lives: ${lifespans.slice(0, 5).map(x => `${x.p.id} ${x.p.name} ${x.age}`).join(', ')}`,
      lifespans.length > 5 && `shortest recorded lives: ${lifespans.slice(-3).reverse().map(x => `${x.p.id} ${x.p.name} ${x.age}`).join(', ')}`,
      mostKids.length && `most children: ${mostKids.map(([p, n]) => `${p.id} ${nm(p, opts)} ${n}`).join(', ')}`,
      born.length && `earliest births: ${born.slice(0, 3).map(p => `${p.id} ${p.name} ${tree.birthYear(p)}`).join(', ')}`,
      born.length && `latest births${hidden ? ' (not counting withheld living relatives)' : ''}: ${born.slice(-3).reverse().map(p => `${p.id} ${p.name} ${tree.birthYear(p)}`).join(', ')}`,
    ].filter(Boolean);
    return { text: lines.join('\n'), lifespans, mostKids, born };
  }

  // ---------- retrieval: who does this question point at? ----------
  // Runs on this computer, over everyone. Returns { direct: [ids matched by the question, best first], ids: [everyone to include] }.
  // opts.skipWithheld leaves withheld living people out of matching (for the find_people tool, which Claude drives).
  function retrieve(tree, question, opts = {}) {
    const limit = opts.limit || MAX_RELEVANT;
    const q = fold(question);
    const terms = words(question).filter(w => !STOP.has(w) && (w.length > 2 || /^\d+$/.test(w)));
    const home = opts.homeId && tree.get(opts.homeId);
    const focus = opts.focusId && tree.get(opts.focusId);
    const scores = new Map();
    const add = (id, n) => scores.set(id, (scores.get(id) || 0) + n);
    const skip = p => opts.skipWithheld && withheld(p, opts);

    for (const p of tree.people.values()) {
      if (skip(p)) continue;
      const nameW = new Set([...words(p.given), ...words(p.surname), ...words(p.nick)]);
      const placeW = new Set(p.events.flatMap(e => words(e.place)));
      const occW = new Set(words(p.occupation));
      const full = fold(p.name);
      let s = 0;
      if (full.length > 3 && q.includes(full)) s += 30;
      for (const w of terms) {
        if (nameW.has(w)) s += 10;
        else if (w.length >= 4 && [...nameW].some(n => n.startsWith(w))) s += 5;
        if (placeW.has(w)) s += 4;
        if (occW.has(w) || (w.length >= 5 && [...occW].some(o => o.startsWith(w.replace(/s$/, ''))))) s += 4;
      }
      if (s) add(p.id, s);
    }
    // years and decades: "1920s", "in 1918", "born in the 1800s"
    for (const m of q.matchAll(/\b(1[0-9]{3}|20[0-9]{2})(s?)\b/g)) {
      const y = +m[1], span = m[2] ? (y % 100 === 0 ? 100 : 10) : 0;
      for (const p of tree.people.values()) {
        if (skip(p)) continue;
        const b = tree.birthYear(p), d = tree.deathYear(p);
        if (span ? (b != null && b >= y && b < y + span) || (d != null && d >= y && d < y + span) : tree.aliveIn(p, y)) add(p.id, span ? 3 : 2);
      }
    }

    const direct = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const picked = [];
    const seen = new Set();
    const take = id => { if (id && !seen.has(id) && tree.get(id)) { seen.add(id); picked.push(id); } };

    // the question's own subjects first, then home and focus
    direct.slice(0, 25).forEach(take);
    if (home) take(home.id);
    if (focus) take(focus.id);

    // "my grandmother", "my cousins", "our ancestors": walk out from home
    if (home && (ME.test(q) || /\b(our|we)\b/.test(q) || KIN_UP.test(q) || KIN_SIDE.test(q) || KIN_DOWN.test(q))) {
      const greats = (q.match(/great/g) || []).length;
      if (KIN_UP.test(q) || KIN_SIDE.test(q)) [...tree.ancestors(home, Math.max(3, greats + 2)).keys()].forEach(take);
      if (KIN_SIDE.test(q)) for (const a of [...tree.ancestors(home, 3).keys()]) for (const d of tree.descendants(tree.get(a), 3).keys()) take(d);
      if (KIN_DOWN.test(q)) [...tree.descendants(home, 4).keys()].forEach(take);
    }

    // superlatives: answer from the whole tree, not only from names in the question
    const f = opts.facts || facts(tree, opts);
    if (LONGEST.test(q)) {
      f.lifespans.slice(0, 8).forEach(x => take(x.p.id));
      if (/\b(shortest|youngest|young)\b/.test(q)) f.lifespans.slice(-5).forEach(x => take(x.p.id));
    }
    if (MOST_KIDS.test(q)) f.mostKids.forEach(([p]) => take(p.id));
    if (EARLIEST.test(q)) { f.born.slice(0, 5).forEach(p => take(p.id)); f.born.slice(-5).forEach(p => take(p.id)); }
    (opts.extra || []).forEach(take); // people from the previous answer, for follow-ups

    // close family of everyone so far, so "who were her parents?" has its answer at hand
    const core = picked.slice();
    for (const id of core) {
      const p = tree.get(id);
      for (const x of [...tree.parents(p), ...tree.spouses(p), ...tree.children(p)]) take(x.id);
    }
    return { direct: direct.slice(0, 25), ids: picked.slice(0, limit), more: Math.max(0, picked.length - limit) };
  }

  // ---------- taking living relatives' names out of the question ----------
  // "Tell me about Leo" -> "Tell me about [person I2]". A first name or surname that also belongs to someone whose
  // details may be shared becomes a list of the candidates, so questions about them still work:
  // "Anna" -> "[Anna: living person I53, or Anna Russo (I41)]". Returns { text, ids } (ids: withheld people named).
  // Catches full names, first names, nicknames and surnames as the tree spells them, not misspellings.
  function redactQuestion(tree, question, opts = {}) {
    const text = String(question || '');
    const all = [...tree.people.values()];
    const hidden = all.filter(p => withheld(p, opts));
    if (!hidden.length) return { text, ids: [] };
    const owners = new Map(); // folded name -> { hidden: [people], shared: [people] }
    const own = (key, p) => {
      key = fold(key);
      if (!key || key.length < 2 || STOP.has(key)) return;
      if (!owners.has(key)) owners.set(key, { hidden: [], shared: [] });
      const o = owners.get(key), side = withheld(p, opts) ? o.hidden : o.shared;
      if (!side.includes(p)) side.push(p);
    };
    for (const p of all) {
      const given = words(p.given);
      own(p.name, p);
      own(p.given, p);
      if (given.length) { own(given[0], p); own(`${given[0]} ${p.surname}`, p); }
      own(p.nick, p);
      own(p.surname, p);
    }
    const keys = [...owners.keys()].filter(k => owners.get(k).hidden.length).sort((a, b) => b.length - a.length);
    if (!keys.length) return { text, ids: [] };
    // match on the accent-free form of the question, so "Zoe" finds "Zoë"
    const nfd = text.normalize('NFD');
    const letters = k => k.split('').map(c => (c === ' ' ? "[\\s.'-]+" : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{M}*')).join('');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${keys.map(letters).join('|')})(s?)(?![\\p{L}\\p{N}])`, 'giu');
    const ids = new Set();
    const out = nfd.replace(re, (whole, match, plural) => {
      const key = fold(match), o = owners.get(key);
      if (!o) return whole;
      const swap = replace(match, key, o);
      return swap === match ? whole : swap;
    });
    return { text: out.normalize('NFC'), ids: [...ids] };

    function replace(match, key, o) {
      if (!o) return match;
      // a family name that deceased relatives also carry ("Ashworth") says nothing about who is living: leave it
      if (o.shared.some(p => fold(p.surname) === key)) return match;
      o.hidden.forEach(p => ids.add(p.id));
      const isSurname = o.hidden.every(p => fold(p.surname) === key);
      const hiddenTxt = o.hidden.length === 1 ? `living person ${o.hidden[0].id}` : `living people ${o.hidden.map(p => p.id).join(', ')}`;
      if (!o.shared.length) return isSurname ? `[surname of ${hiddenTxt}]` : o.hidden.length === 1 ? `[person ${o.hidden[0].id}]` : `[one of ${hiddenTxt}]`;
      const shared = o.shared.slice(0, 6).map(p => `${p.name} (${p.id})`).join(', ');
      return `[${match.normalize('NFC')}: ${hiddenTxt}, or ${shared}${o.shared.length > 6 ? ', or others' : ''}]`;
    }
  }

  // ---------- relationships Rootlight computes (the model is told to use these, not to infer) ----------
  function pathText(tree, a, b, opts) {
    const path = tree.path(a, b);
    if (!path) return null;
    return path.map((s, i) => i === 0 ? who(s.person, opts) : `whose ${s.rel} is ${who(s.person, opts)}`).join(', ');
  }
  function relationText(tree, a, b, opts = {}) {
    if (!a || !b) return 'unknown person';
    if (a.id === b.id) return `${who(a, opts)} is the same person.`;
    const r = tree.relationship(a, b);
    const path = pathText(tree, a, b, opts);
    if (!r && !path) return `No connection between ${who(a, opts)} and ${who(b, opts)} is recorded in this tree.`;
    let s = r ? `${who(b, opts)} is the ${r.label} of ${who(a, opts)}.` : `${who(b, opts)} is connected to ${who(a, opts)} but has no named relationship.`;
    if (r && r.commonAncestor && r.da > 0 && r.db > 0) s += ` Closest common ancestor: ${who(r.commonAncestor, opts)}.`;
    if (path) s += ` Path: ${path}.`;
    return s;
  }
  function relationships(tree, direct, homeId, opts = {}) {
    const home = homeId && tree.get(homeId);
    const subjects = direct.slice(0, 4).map(id => tree.get(id)).filter(Boolean);
    const out = [];
    for (const p of subjects) if (home && p.id !== home.id) out.push(relationText(tree, home, p, opts));
    for (let i = 0; i < subjects.length; i++) for (let j = i + 1; j < Math.min(subjects.length, 3); j++) out.push(relationText(tree, subjects[i], subjects[j], opts));
    return out;
  }

  // ---------- the request ----------
  const RULES = (ctx) => `You answer questions about one family tree for people exploring it in Rootlight, a family-tree viewer. Write warmly and briefly, like a knowledgeable relative: usually under 150 words, a short list when the question asks for several people.

Rules:
- Use only the data below and tool results. Never invent people, dates, places, relationships or reasons. If the data doesn't say, say so plainly (for example "The tree doesn't record where she was born.").
- Relationship labels marked "to home" and the RELATIONSHIPS section are computed by Rootlight from the tree. Use them as given instead of working relationships out yourself.${ctx.tools ? ' For any other pair, call the relationship tool.' : ''}
- ${ctx.scope === 'all' ? 'This is the whole tree.' : `This is an excerpt of a larger tree (${ctx.total} people), chosen for the question. If the answer could depend on people not shown, say it's based on the people found${ctx.tools ? ', or call find_people to look further' : ''}.`}
- "I", "me", "my" and "we" mean the home person, ${ctx.home ? who(ctx.home, ctx.opts) : 'who is not set'}, unless the asker says otherwise. The person on screen is ${ctx.focus ? who(ctx.focus, ctx.opts) : 'nobody'}.
- "~" before a year means approximate. "no death recorded" means the tree has no death date; it does not prove the person is alive.${ctx.withholding ? `
- People shown as "living person" are living relatives. Their names and details are withheld for privacy, and names of living relatives in the question appear as placeholders such as [person I2]. Refer to them only by ID, as [[I2]]; the reader's screen shows their real name. Never guess their names, dates or places. If asked for their details, say the tree's details for living relatives aren't shared, and that turning on "Include living relatives" shares them.` : ''}
- Whenever you name a person from the tree, write them as [[ID|Name]], for example [[I12|Maria Novak]], so the reader can click through. Use only IDs that appear below or in tool results.
- Plain text only: short paragraphs, "- " bullets and **bold** are fine. No headings, tables or links.`;

  // Builds the text Claude reads. Returns { prompt, question, scope, sent: {people, chars, withheld}, ids, direct, fellBack }.
  // `question` is the question as it should be sent (living relatives' names taken out unless includeLiving).
  function build(tree, question, opts = {}) {
    const priv = { includeLiving: !!opts.includeLiving };
    const scope = opts.scope === 'all' ? 'all' : 'relevant';
    const home = opts.homeId && tree.get(opts.homeId);
    const focus = opts.focusId && tree.get(opts.focusId);
    const f = facts(tree, priv);
    const r = retrieve(tree, question, { homeId: opts.homeId, focusId: opts.focusId, facts: f, extra: opts.extra, limit: opts.limit, ...priv });
    let ids = r.ids, usedScope = scope, fellBack = false;
    let lines;
    if (scope === 'all') {
      const all = [...tree.people.values()];
      const withRel = all.length <= REL_LINES_LIMIT;
      lines = all.map(p => personLine(tree, p, { home, withRel, ...priv }));
      if (lines.join('\n').length > MAX_ALL_CHARS) { fellBack = true; usedScope = 'relevant'; }
      else ids = all.map(p => p.id);
    }
    if (usedScope === 'relevant') lines = ids.map(id => personLine(tree, tree.get(id), { home, ...priv }));
    const rels = relationships(tree, r.direct, opts.homeId, priv);
    const withheldIds = ids.filter(id => withheld(tree.get(id), priv));
    const data = [
      `TREE FACTS (computed from all ${tree.people.size} people)\n${f.text}`,
      rels.length ? `RELATIONSHIPS (computed by Rootlight)\n${rels.join('\n')}` : '',
      `PEOPLE (${usedScope === 'all' ? 'everyone' : `${lines.length} of ${tree.people.size}`}; fields: ID | name (sex) | birth | death | ... | parents | spouses | children | relationship to home)\n${lines.join('\n')}`,
    ].filter(Boolean).join('\n\n');
    const anyWithheld = [...tree.people.values()].some(p => withheld(p, priv));
    const rules = RULES({ scope: usedScope, total: tree.people.size, home, focus, tools: !!opts.tools, opts: priv, withholding: anyWithheld });
    const prompt = `${rules}\n\n${data}`;
    const q = redactQuestion(tree, question, priv);
    return { prompt, question: q.text, scope: usedScope, fellBack, ids, direct: r.direct, sent: { people: lines.length, chars: prompt.length + q.text.length, withheld: withheldIds.length } };
  }

  // People search for the find_people tool: same scoring as retrieve(), lines only for the best few.
  // Withheld living people are never matched, so a search can't confirm that a living person has some name or place.
  function find(tree, query, opts = {}) {
    const priv = { includeLiving: !!opts.includeLiving };
    const r = retrieve(tree, query, { limit: opts.limit || 12, skipWithheld: true, ...priv });
    const ids = r.direct.slice(0, opts.limit || 12);
    if (!ids.length) return 'No one in the tree matches that.';
    const home = opts.homeId && tree.get(opts.homeId);
    return ids.map(id => personLine(tree, tree.get(id), { home, ...priv })).join('\n');
  }

  // ---------- reading the answer back ----------
  // Splits an answer into text and person references. [[I12|Maria]] becomes {id, label}; unknown ids stay as text.
  function parseRefs(text, tree) {
    const out = [];
    const re = /\[\[([^\]|]{1,40})(?:\|([^\]]{1,120}))?\]\]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      const id = m[1].trim().replace(/^@|@$/g, '');
      const p = tree && tree.get(id);
      const label = (m[2] || '').trim() || (p ? p.name : id);
      out.push(p ? { id, label } : { text: label });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  // ids mentioned in an answer, for follow-up questions
  const refIds = (text, tree) => parseRefs(text, tree).filter(x => x.id).map(x => x.id);

  window.AskTree = { personLine, facts, retrieve, redactQuestion, relationText, relationships, build, find, parseRefs, refIds, withheld, MAX_ALL_CHARS };
})();
