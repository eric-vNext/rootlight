// "Ask about the family": a slide-out panel where a visitor asks plain-language questions and Claude answers from
// the tree. Only exists where the page runs inside Claude (the Rootlight app or its artifact page), which grants the
// "sample" capability; on the plain website the button never appears. Exposes window.Ask.
//
// Privacy: off until the visitor turns it on. Each question sends text built by js/asktree.js: only the people
// the question points at (default) or the whole tree, as the visitor chooses. Photos and notes are never sent.
// Living relatives are sent without names or details unless the visitor ticks "Include living relatives"; the
// panel puts their real names back on screen, since answers refer to people by ID.
window.Ask = (function () {
  const $ = s => document.querySelector(s);
  const { esc } = U;
  const KEY = 'rootlight.ask';
  const HISTORY = 3; // earlier question/answer pairs sent with a follow-up

  let sample = null, canTools = false, ready = false;
  let settings = { on: false, scope: 'relevant', living: false };
  let turns = [];    // { q, a, sent, error, pending, ids }
  let ctl = null;
  let blocked = '';  // set when Claude can't be used in this view at all

  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ } };

  // ---------- availability ----------
  async function init() {
    if (!window.claude || typeof window.claude.use !== 'function') return; // the plain website
    try { sample = await window.claude.use('sample'); } catch { sample = null; }
    if (!sample) return;
    try { canTools = !!(await sample.limits()).tools; } catch { canTools = false; }
    ready = true;
    $('#ask-btn').hidden = false;
    wire();
    render();
  }

  // ---------- panel ----------
  const isOpen = () => $('#app').classList.contains('ask-open');
  function open() {
    if (!ready || !App.tree) return;
    $('#app').classList.add('ask-open');
    $('#ask').setAttribute('aria-hidden', 'false');
    $('#ask-btn').setAttribute('aria-expanded', 'true');
    render();
    setTimeout(() => (settings.on && !blocked ? $('#ask-input') : $('#ask-on') || $('#ask-close')).focus(), 60);
  }
  function close() {
    $('#app').classList.remove('ask-open');
    $('#ask').setAttribute('aria-hidden', 'true');
    $('#ask-btn').setAttribute('aria-expanded', 'false');
  }
  const toggle = () => (isOpen() ? close() : open());

  // A new file starts a new conversation.
  function reset() {
    if (ctl) ctl.abort();
    turns = [];
    if (ready) render();
  }

  // ---------- rendering ----------
  function render() {
    const body = $('#ask-body');
    if (!body) return;
    const form = $('#ask-form');
    $('#ask-scope').hidden = !settings.on;
    for (const b of document.querySelectorAll('#ask-scope [data-scope]')) b.classList.toggle('on', b.dataset.scope === settings.scope);
    $('#ask-living').checked = !!settings.living;
    if (!settings.on) { form.hidden = true; body.innerHTML = intro(); return; }
    form.hidden = false;
    $('#ask-input').disabled = !!blocked;
    $('#ask-send').disabled = !!blocked || turns.some(t => t.pending);
    body.innerHTML = (turns.length ? turns.map(turnHtml).join('') : welcome()) + (blocked ? `<p class="ask-note">${esc(blocked)}</p>` : '');
    body.scrollTop = body.scrollHeight;
  }

  function intro() {
    return `<div class="ask-intro">
      <p class="ask-lede">Ask about the family in your own words, like <i>“Who lived longest?”</i> or <i>“Which ancestors came from Ireland?”</i>, and Claude answers from this tree.</p>
      <p>To answer, Rootlight sends text from your tree to Anthropic's Claude, using your Claude account. That text is names, dates, places, jobs and family links. Photos and notes are never sent, and nothing is sent until you ask.</p>
      <fieldset class="ask-choice">
        <legend>What may Claude see?</legend>
        <label><input type="radio" name="ask-scope" value="relevant" ${settings.scope !== 'all' ? 'checked' : ''}>
          <span><b>Only the people a question is about</b><em>Plus their parents, spouses and children. Sends the least.</em></span></label>
        <label><input type="radio" name="ask-scope" value="all" ${settings.scope === 'all' ? 'checked' : ''}>
          <span><b>The whole tree</b><em>Every person's text with each question. Best for big “who in the family…” questions.</em></span></label>
      </fieldset>
      <label class="ask-check"><input type="checkbox" id="ask-living-intro" ${settings.living ? 'checked' : ''}>
        <span><b>Include living relatives</b><em>When off, living relatives are sent without names, dates, places or jobs, and their names are taken out of your questions. Answers still show their names here.</em></span></label>
      <p class="ask-small">You can change this or turn it off any time. Answers can be wrong, so check them against the tree.</p>
      <div class="ask-actions"><button id="ask-on" class="btn">Turn on Ask</button><button id="ask-later" class="btn ghost">Not now</button></div>
    </div>`;
  }

  function welcome() {
    const t = App.tree, home = App.home, focus = App.focus;
    const far = home && [...t.ancestors(home, 4).entries()].filter(([, g]) => g >= 3).map(([id]) => t.get(id))[0];
    const ideas = [
      'Who lived longest?',
      far ? `How am I related to ${far.given.split(' ')[0]} ${far.surname}?` : null,
      'Where did our ancestors come from?',
      focus && home && focus.id !== home.id ? `Tell me about ${focus.given.split(' ')[0] || focus.name}` : 'Who was alive in 1918?',
    ].filter(Boolean);
    return `<div class="ask-welcome">
      <p class="ask-lede">What would you like to know about ${esc(home ? `${home.given.split(' ')[0]}'s` : 'the')} family?</p>
      <div class="ask-ideas">${ideas.map(q => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`;
  }

  function turnHtml(t, i) {
    const answer = t.a ? `<div class="ask-a">${md(t.pending ? t.a.replace(/\[\[[^\]]*$/, '') : t.a)}</div>` : '';
    const thinking = t.pending && !t.a ? `<div class="ask-a ask-thinking"><span></span><span></span><span></span> ${esc(t.status || 'Thinking…')}</div>` : '';
    const stop = t.pending ? `<button class="ask-link" data-stop>Stop</button>` : '';
    const err = t.error ? `<p class="ask-note">${esc(t.error)}${t.retry ? ` <button class="ask-link" data-retry="${i}">Try again</button>` : ''}</p>` : '';
    return `<div class="ask-turn"><p class="ask-q">${esc(t.q)}</p>${thinking}${answer}${err}${t.pending ? `<div class="ask-meta">${stop}</div>` : sentHtml(t)}</div>`;
  }

  // "What was sent" under each answer, so the visitor can see exactly whose details left the computer
  function sentHtml(t) {
    if (!t.sent) return '';
    const names = t.sent.ids.map(id => App.tree.get(id)).filter(Boolean);
    const scope = t.sent.scope === 'all' ? 'the whole tree' : `${names.length} of ${App.tree.people.size} people`;
    const extra = t.sent.fellBack ? ' (the whole tree was too large to send, so only the people this question is about were sent)' : '';
    const hid = names.filter(p => AskTree.withheld(p, { includeLiving: t.sent.living }));
    const held = hid.length ? ` · ${hid.length} living withheld` : '';
    const list = names.map(p => esc(p.name) + (hid.includes(p) ? ' <i>(name and details withheld)</i>' : '')).join(', ');
    const swapped = t.sent.swapped.map(id => App.tree.get(id)).filter(Boolean);
    return `<details class="ask-sent"><summary>Sent ${esc(scope)}${held} · ${Math.max(1, Math.round(t.sent.chars / 1024))} KB${esc(extra)}</summary>
      <p>${list}. Names, dates, places, jobs and family links only.</p>
      ${swapped.length ? `<p>Taken out of your question: ${swapped.map(p => esc(p.name)).join(', ')}.</p>` : ''}</details>`;
  }

  // Minimal formatting for answers: paragraphs, "- " lists, **bold**, and [[ID|Name]] person links.
  function md(text) {
    const parts = AskTree.parseRefs(text, App.tree);
    const links = [];
    let src = '';
    for (const p of parts) {
      if (p.id) { links.push(p); src += `\u0000${links.length - 1}\u0000`; }
      else src += p.text;
    }
    const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\u0000(\d+)\u0000/g, (_, n) => {
      const l = links[+n], p = App.tree.get(l.id);
      // Claude never saw a withheld living relative's name, so show the one in the tree
      const label = p.living ? p.name : l.label;
      return `<button class="ask-ref" data-goto="${esc(l.id)}" title="Go to ${esc(p.name)}">${esc(label)}</button>`;
    });
    // runs of "- " lines become lists; other runs of lines become paragraphs
    const bullet = /^\s*[-•*]\s+/;
    let html = '', run = [], inList = false;
    const flush = () => {
      if (run.length) html += inList ? `<ul>${run.map(l => `<li>${inline(l.replace(bullet, ''))}</li>`).join('')}</ul>` : `<p>${run.map(inline).join('<br>')}</p>`;
      run = [];
    };
    for (const line of src.trim().split('\n')) {
      if (!line.trim()) { flush(); continue; }
      const isItem = bullet.test(line);
      if (isItem !== inList) { flush(); inList = isItem; }
      run.push(line);
    }
    flush();
    return html;
  }

  // ---------- asking ----------
  function tools(sent) {
    if (!canTools) return undefined;
    const t = App.tree, priv = { includeLiving: sent.living };
    const note = ids => { for (const id of ids) if (!sent.ids.includes(id)) sent.ids.push(id); };
    return [
      {
        name: 'relationship',
        description: 'How person b is related to person a in this family tree, computed by Rootlight from the recorded family links. Returns the relationship label, the closest common ancestor and the path between them. Pass person IDs such as I12.',
        inputSchema: { type: 'object', properties: { a: { type: 'string', description: 'ID of the person the relationship is described from' }, b: { type: 'string', description: 'ID of the other person' } }, required: ['a', 'b'] },
        execute(input) {
          const a = t.get(String(input.a || '').trim()), b = t.get(String(input.b || '').trim());
          if (!a || !b) throw new Error('Unknown person ID');
          const out = AskTree.relationText(t, a, b, priv);
          note((t.path(a, b) || []).map(s => s.person.id));
          return out;
        },
      },
      {
        name: 'find_people',
        description: 'Search the whole family tree by name, place, occupation or year. Returns up to 12 matching people, one per line, in the same format as the PEOPLE section.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to search for, e.g. "Cork" or "Ludwig Bauer" or "1918"' } }, required: ['query'] },
        execute(input) {
          const out = AskTree.find(t, String(input.query || ''), { homeId: App.homeId, ...priv });
          note([...out.matchAll(/^(\S+) \|/gm)].map(m => m[1]));
          return out;
        },
      },
    ];
  }

  async function ask(question) {
    question = String(question || '').trim();
    if (!question || !sample || blocked || turns.some(t => t.pending)) return;
    const t = App.tree;
    const prev = turns.filter(x => x.a && !x.error).slice(-HISTORY);
    const extra = [...new Set(prev.slice(-2).flatMap(x => [...(x.ids || []), ...AskTree.refIds(x.a, t)]))];
    const living = !!settings.living;
    const built = AskTree.build(t, question, { scope: settings.scope, homeId: App.homeId, focusId: App.focusId, extra, tools: canTools, includeLiving: living });
    const swapped = living ? [] : AskTree.redactQuestion(t, question).ids;
    const turn = { q: question, qSent: built.question, a: '', pending: true, ids: built.direct.slice(0, 6), sent: { scope: built.scope, fellBack: built.fellBack, ids: built.ids.slice(), chars: built.sent.chars, living, swapped } };
    turns.push(turn);
    render();

    const input = [{ role: 'user', content: built.prompt }];
    for (const x of prev) input.push({ role: 'user', content: x.qSent }, { role: 'assistant', content: x.a });
    input.push({ role: 'user', content: `Question: ${built.question}` });

    ctl = new AbortController();
    const opts = { signal: ctl.signal, onText: ({ text }) => { turn.a = text; render(); }, tools: tools(turn.sent) };
    if (!opts.tools) { delete opts.tools; opts.cache = false; }
    try {
      const res = await sample(input, opts);
      turn.a = res.text;
      if (res.truncated) turn.error = 'The answer was cut short. Try asking for less at once.';
    } catch (e) {
      failed(turn, e || {});
    } finally {
      turn.pending = false;
      ctl = null;
      render();
    }
  }

  function failed(turn, e) {
    turn.a = e.code === 'refused' ? '' : (e.text || turn.a || '');
    const usage = e.reason === 'usage_limit';
    switch (e.code) {
      case 'cancelled': turn.error = 'Stopped.'; break;
      case 'not_granted':
        blocked = 'Claude wasn’t allowed for Rootlight in this window. You can allow it from this app’s permissions, then reopen it.'; break;
      case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed':
        blocked = 'Claude isn’t available to Rootlight here, so Ask is switched off for now.'; break;
      case 'rate_limited':
        turn.error = usage ? 'You’ve reached your Claude usage limit for now. Ask again once it resets.' : 'That’s a lot of questions at once. Wait a moment, then try again.';
        turn.retry = !usage; break;
      case 'session_expired': turn.error = 'Your Claude sign-in has expired. Sign in to Claude again, then ask.'; turn.retry = true; break;
      case 'refused': turn.error = 'Claude couldn’t answer that one. Try asking it another way.'; break;
      case 'prompt_too_large': turn.error = 'That needed more of the tree than fits in one question. Try a narrower question, or share only the people a question is about.'; break;
      case 'empty_completion': turn.error = 'No answer came back. Try rephrasing the question.'; break;
      default:
        turn.error = navigator.onLine === false ? 'You seem to be offline. Reconnect, then try again.' : 'Couldn’t reach Claude just now. Check your connection and try again.';
        turn.retry = true;
    }
  }

  // ---------- wiring ----------
  function wire() {
    $('#ask-btn').addEventListener('click', toggle);
    $('#ask-close').addEventListener('click', close);
    const panel = $('#ask');
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); $('#ask-btn').focus(); } });
    panel.addEventListener('click', e => {
      const el = e.target.closest('button, input');
      if (!el) return;
      if (el.dataset.goto && innerWidth < 760) close(); // the sheet covers the view on phones; app.js does the navigating
      else if (el.id === 'ask-on') {
        const pick = panel.querySelector('input[name="ask-scope"]:checked');
        settings = { on: true, scope: pick ? pick.value : 'relevant', living: !!(panel.querySelector('#ask-living-intro') || {}).checked };
        save(); render(); $('#ask-input').focus();
      } else if (el.id === 'ask-later') close();
      else if (el.id === 'ask-off') { settings.on = false; save(); reset(); render(); }
      else if (el.dataset.scope) { settings.scope = el.dataset.scope; save(); render(); }
      else if (el.id === 'ask-living') { settings.living = el.checked; save(); render(); }
      else if (el.dataset.ask) ask(el.dataset.ask);
      else if (el.hasAttribute('data-stop')) ctl && ctl.abort();
      else if (el.dataset.retry != null) { const t = turns[+el.dataset.retry]; if (t) { turns.splice(+el.dataset.retry, 1); ask(t.q); } }
    });
    const inp = $('#ask-input');
    $('#ask-form').addEventListener('submit', e => { e.preventDefault(); const q = inp.value; inp.value = ''; ask(q); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask-form').requestSubmit(); } });
  }

  init();
  return { open, close, toggle, reset, get available() { return ready; } };
})();
