// Run: node test/asktree.test.js
// Checks the text Rootlight sends to Claude: what it contains, what it leaves out, and how answers link back to people.
const assert = require('assert');
global.window = {};
require('../js/gedcom.js');
require('../js/sample.js');
require('../js/asktree.js');
const { build: parse } = window.Gedcom;
const A = window.AskTree;
const t = parse(window.SAMPLE_GEDCOM);
const home = t.get('I1');

// one line per person: dates, places, family links and the computed relationship to home
{
  const line = A.personLine(t, t.get('I15'), { home });
  assert.match(line, /^I15 \| István Varga \(M\)/);
  assert.match(line, /b\. 1930 Budapest, Hungary/);
  assert.match(line, /d\. 2004 Cleveland, Ohio, USA/);
  assert.match(line, /immigrated: 1956 New York/);
  assert.match(line, /parents: I22, I23/);
  assert.match(line, /spouses: I16 \(m\. 1958\)/);
  assert.match(line, /to home: grandfather/);
  assert.match(A.personLine(t, t.get('I8'), { home }), /b\. ~1962/); // approximate dates keep their marker
  assert.match(A.personLine(t, t.get('I2'), { home }), /no death recorded/);
}

// tree facts are aggregate and name the superlatives
{
  const f = A.facts(t);
  assert.match(f.text, /people: 53/);
  assert.match(f.text, /longest lives: I51 Florence Ashworth 94/);
  assert.ok(f.ids.has('I51'));
}

// retrieval: names (with or without accents), places, occupations, years
{
  assert.strictEqual(A.retrieve(t, 'Tell me about Florence').direct[0], 'I51');
  assert.strictEqual(A.retrieve(t, 'Who was Istvan?').direct[0], 'I15');
  const ireland = A.retrieve(t, 'Which ancestors came from Ireland?').direct;
  for (const id of ['I20', 'I30', 'I31', 'I32']) assert.ok(ireland.includes(id), id);
  assert.ok(!ireland.includes('I24'), 'Naples-born Giuseppe does not match Ireland');
  assert.ok(A.retrieve(t, 'Was anyone a watchmaker?').direct.includes('I15'));
  const war = A.retrieve(t, 'Who was alive in 1916?').direct;
  assert.ok(war.includes('I19') && !war.includes('I1'));
}

// retrieval adds close family, home and focus, and stays within the limit
{
  const r = A.retrieve(t, 'Tell me about Florence', { homeId: 'I1', focusId: 'I5' });
  for (const id of ['I51', 'I26', 'I27', 'I1', 'I5']) assert.ok(r.ids.includes(id), id);
  assert.ok(!r.ids.includes('I38'), 'unrelated Italian line is left out');
  assert.ok(A.retrieve(t, 'my ancestors', { homeId: 'I1', limit: 10 }).ids.length <= 10);
}

// superlatives pull in the right people even when the question names nobody
{
  const r = A.retrieve(t, 'Who lived longest?', { homeId: 'I1' });
  assert.ok(r.ids.includes('I51') && r.ids.includes('I18'));
}

// relationships are computed here, not left for the model to infer
{
  assert.match(A.relationText(t, home, t.get('I51')), /Florence Ashworth \(I51\) is Maya Rose Ashworth's \(I1\) great-great-aunt\. Closest common ancestor: Henry Ashworth \(I26\)\. Path:/);
  assert.match(A.relationText(t, home, t.get('I3')), /husband/);
  const b = A.build(t, 'How am I related to Florence?', { homeId: 'I1', focusId: 'I1' });
  assert.match(b.prompt, /RELATIONSHIPS \(computed by Rootlight\)\nFlorence Ashworth \(I51\) is Maya Rose Ashworth's \(I1\) great-great-aunt/);
}

// relevant scope sends only part of the tree; whole-tree scope sends everyone; neither sends photos or notes
{
  const rel = A.build(t, 'Tell me about Florence', { homeId: 'I1', focusId: 'I1' });
  assert.strictEqual(rel.scope, 'relevant');
  assert.ok(rel.sent.people < 53 && rel.sent.people > 3);
  assert.match(rel.prompt, /excerpt of a larger tree \(53 people\)/);
  assert.ok(!/I38 \|/.test(rel.prompt));
  const all = A.build(t, 'Tell me about Florence', { homeId: 'I1', scope: 'all' });
  assert.strictEqual(all.scope, 'all');
  assert.strictEqual(all.sent.people, 53);
  assert.match(all.prompt, /I38 \| Antonio Ferraro/);
  for (const b of [rel, all]) {
    assert.ok(!/OBJE|\.jpe?g|\.png|NOTE/i.test(b.prompt), 'no photo references or notes');
    assert.match(b.prompt, /Never invent people/);
    assert.match(b.prompt, /\[\[ID\|Name\]\]/);
  }
}

// a name the tree doesn't hold retrieves nobody directly, so the model has nothing to invent from
{
  const b = A.build(t, 'How am I related to Ludwig?', { homeId: 'I1', focusId: 'I1' });
  assert.deepStrictEqual(b.direct, []);
  assert.ok(!/Ludwig \(/.test(b.prompt.split('PEOPLE')[1]));
}

// whole-tree scope falls back to relevant people when the tree is too large to send
{
  let ged = '0 HEAD\n';
  for (let i = 0; i < 2500; i++) ged += `0 @P${i}@ INDI\n1 NAME Person${i} /Longsurname${i % 50}/\n1 BIRT\n2 DATE ${1700 + (i % 300)}\n2 PLAC Some Village, Some County, Some Country\n1 OCCU Agricultural labourer and occasional carter\n`;
  const big = parse(ged + '0 TRLR\n');
  const b = A.build(big, 'Who was Person7?', { homeId: 'P1', scope: 'all' });
  assert.strictEqual(b.fellBack, true);
  assert.strictEqual(b.scope, 'relevant');
  assert.ok(b.prompt.length < A.MAX_ALL_CHARS);
}

// answers: [[ID|Name]] becomes a link; unknown ids become plain text
{
  const parts = A.parseRefs('Ask [[I51|Florence]] or [[I999|Ghost]], and [[I26]].', t);
  assert.deepStrictEqual(parts, [
    { text: 'Ask ' }, { id: 'I51', label: 'Florence' }, { text: ' or ' }, { text: 'Ghost' }, { text: ', and ' }, { id: 'I26', label: 'Henry Ashworth' }, { text: '.' },
  ]);
  assert.deepStrictEqual(A.refIds('[[I1|Maya]] and [[I4|Iris]]', t), ['I1', 'I4']);
}

// find_people tool output
assert.match(A.find(t, 'Cork', { homeId: 'I1' }), /I30 \| Patrick Doyle/);
assert.strictEqual(A.find(t, 'zzzz'), 'No one in the tree matches that.');

console.log('asktree tests passed');
