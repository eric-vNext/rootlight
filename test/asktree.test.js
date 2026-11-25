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
const LIV = { includeLiving: true }; // most checks below run with living relatives included; withholding has its own section

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
  assert.match(A.personLine(t, t.get('I8'), { home, ...LIV }), /b\. ~1962/); // approximate dates keep their marker
  assert.match(A.personLine(t, t.get('I2'), { home, ...LIV }), /no death recorded/);
}

// tree facts are aggregate and name the superlatives
{
  const f = A.facts(t, LIV);
  assert.match(f.text, /people: 53/);
  assert.match(f.text, /longest lives: I51 Florence Ashworth 94/);
  assert.match(f.text, /latest births: I4 Iris Ada Okafor 2021/);
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
  assert.match(A.relationText(t, home, t.get('I51'), LIV), /Florence Ashworth \(I51\) is the great-great-aunt of Maya Rose Ashworth \(I1\)\. Closest common ancestor: Henry Ashworth \(I26\)\. Path:/);
  assert.match(A.relationText(t, home, t.get('I3'), LIV), /husband/);
  const b = A.build(t, 'How am I related to Florence?', { homeId: 'I1', focusId: 'I1', ...LIV });
  assert.match(b.prompt, /RELATIONSHIPS \(computed by Rootlight\)\nFlorence Ashworth \(I51\) is the great-great-aunt of Maya Rose Ashworth \(I1\)/);
}

// relevant scope sends only part of the tree; whole-tree scope sends everyone; neither sends photos or notes
{
  const rel = A.build(t, 'Tell me about Florence', { homeId: 'I1', focusId: 'I1', ...LIV });
  assert.strictEqual(rel.scope, 'relevant');
  assert.ok(rel.sent.people < 53 && rel.sent.people > 3);
  assert.match(rel.prompt, /excerpt of a larger tree \(53 people\)/);
  assert.ok(!/I38 \|/.test(rel.prompt));
  const all = A.build(t, 'Tell me about Florence', { homeId: 'I1', scope: 'all', ...LIV });
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
  const b = A.build(t, 'How am I related to Ludwig?', { homeId: 'I1', focusId: 'I1', ...LIV });
  assert.deepStrictEqual(b.direct, []);
  assert.ok(!/Ludwig \(/.test(b.prompt.split('PEOPLE')[1]));
}

// whole-tree scope falls back to relevant people when the tree is too large to send
{
  let ged = '0 HEAD\n';
  for (let i = 0; i < 2500; i++) ged += `0 @P${i}@ INDI\n1 NAME Person${i} /Longsurname${i % 50}/\n1 BIRT\n2 DATE ${1700 + (i % 300)}\n2 PLAC Some Village, Some County, Some Country\n1 OCCU Agricultural labourer and occasional carter\n`;
  const big = parse(ged + '0 TRLR\n');
  const b = A.build(big, 'Who was Person7?', { homeId: 'P1', scope: 'all', ...LIV });
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

// ---------- living relatives (the default: withheld) ----------
const living = [...t.people.values()].filter(p => p.living);
assert.strictEqual(living.length, 12);
// every name, nickname, birth year, place and job of a living person; places or jobs that someone who has died also has don't count
const sharedText = [...t.people.values()].filter(p => !p.living).map(p => A.personLine(t, p, LIV)).join('\n');
const secrets = living.flatMap(p => [p.name, p.given, p.nick, p.birth && p.birth.place, p.occupation, p.birth && p.birth.date && String(p.birth.date.year)])
  .filter(s => s && !sharedText.includes(s));
const leaks = text => secrets.filter(s => text.includes(s));

// person lines keep ID, sex and family links only
{
  assert.strictEqual(A.personLine(t, t.get('I2'), { home }), 'I2 | living person (M) | details withheld | parents: I5, I6 | to home: brother');
  assert.strictEqual(A.personLine(t, t.get('I5'), { home }), 'I5 | living person (M) | details withheld | parents: I12, I13 | spouses: I6 | children: I1, I2 | to home: father');
  assert.ok(!/\(m\./.test(A.personLine(t, t.get('I6'), { home }))); // a marriage year would date a living person
  assert.match(A.personLine(t, t.get('I12'), { home }), /spouses: I13 \(m\. 1959\), I14 \(m\. 1984\)/); // both spouses deceased: kept
  assert.ok(!/\(m\./.test(A.personLine(t, t.get('I3'), { home })));
}

// nothing about living people anywhere in the text sent, in either scope, for a spread of questions
for (const scope of ['relevant', 'all']) {
  for (const q of ['Who lived longest?', 'How am I related to Florence?', 'Who was born latest?', 'Tell me about my cousins', 'Who had the most children?', 'Where did our ancestors come from?']) {
    const b = A.build(t, q, { homeId: 'I1', focusId: 'I5', scope });
    assert.deepStrictEqual(leaks(b.prompt), [], `${scope}: ${q}`);
    assert.match(b.prompt, /names and details are withheld for privacy/);
    assert.match(b.prompt, /the home person, living person \(I1\)/);
  }
}
{
  const b = A.build(t, 'How am I related to Florence?', { homeId: 'I1', focusId: 'I1' });
  assert.match(b.prompt, /Florence Ashworth \(I51\) is the great-great-aunt of living person \(I1\)\. Closest common ancestor: Henry Ashworth \(I26\)\. Path: living person \(I1\), whose parent is living person \(I5\), whose parent is Robert Walter Ashworth \(I12\)/);
  assert.ok(b.sent.withheld > 0);
  const f = A.facts(t);
  assert.match(f.text, /living relatives whose details are withheld: 12/);
  assert.match(f.text, /most children: I26 Henry Ashworth 3, I27 Alice Pickering 3, I5 living person 2/);
  assert.match(f.text, /latest births \(not counting withheld living relatives\): I14 June Palmer 1940/);
  assert.deepStrictEqual(leaks(f.text), []);
}

// living relatives' names come out of the question; shared family names and other people's names stay
{
  const r = q => A.redactQuestion(t, q);
  assert.deepStrictEqual(r('How am I related to Leo?'), { text: 'How am I related to [person I2]?', ids: ['I2'] });
  assert.strictEqual(r('What did Maya Rose Ashworth study?').text, 'What did [person I1] study?');
  assert.strictEqual(r('leo ashworth and NORA').text, '[person I2] and [person I10]');
  assert.strictEqual(r('Where do the Okafors come from?').text, 'Where do the [surname of living people I3, I4] come from?');
  assert.strictEqual(r('Tell me about Anna').text, 'Tell me about [Anna: living person I53, or Anna Russo (I41)]');
  assert.strictEqual(r('Were the Ashworths from Leeds?').text, 'Were the Ashworths from Leeds?');
  assert.strictEqual(r('Tell me about Florence and István').text, 'Tell me about Florence and István');
  assert.strictEqual(r('Leo\'s job?').text, '[person I2]\'s job?');
  assert.strictEqual(r('Who is Leopold?').text, 'Who is Leopold?'); // whole words only
  assert.strictEqual(A.redactQuestion(t, 'How am I related to Leo?', LIV).text, 'How am I related to Leo?');
  assert.strictEqual(A.build(t, 'Is Leo a carpenter?', { homeId: 'I1' }).question, 'Is [person I2] a carpenter?');
}
{
  // accents in the tree, none in the question
  const ged = '0 HEAD\n0 @A@ INDI\n1 NAME Zoë /Brontë/\n0 @B@ INDI\n1 NAME Old /Brontë/\n1 DEAT\n2 DATE 1900\n0 TRLR\n';
  const z = parse(ged);
  assert.strictEqual(A.redactQuestion(z, 'Where is Zoe?').text, 'Where is [person A]?');
  assert.strictEqual(A.redactQuestion(z, 'Where is Zoë Brontë?').text, 'Where is [person A]?');
}

{
  // a deceased husband and a living wife: the marriage year is dropped from both lines, other details of his stay
  const ged = '0 HEAD\n0 @H@ INDI\n1 NAME Hal /Roe/\n1 SEX M\n1 BIRT\n2 DATE 1940\n1 DEAT\n2 DATE 2001\n1 FAMS @F@\n0 @W@ INDI\n1 NAME Wren /Roe/\n1 SEX F\n1 BIRT\n2 DATE 1952\n1 FAMS @F@\n0 @F@ FAM\n1 HUSB @H@\n1 WIFE @W@\n1 MARR\n2 DATE 1975\n0 TRLR\n';
  const m = parse(ged);
  assert.strictEqual(A.personLine(m, m.get('H')), 'H | Hal Roe (M) | b. 1940 | d. 2001 | lived ~61 years | spouses: W');
  assert.strictEqual(A.personLine(m, m.get('W')), 'W | living person (F) | details withheld | spouses: H');
  assert.match(A.personLine(m, m.get('H'), LIV), /spouses: W \(m\. 1975\)/);
}

// the find_people tool never matches living people, so it can't confirm a living person's name or place
assert.strictEqual(A.find(t, 'Leo', { homeId: 'I1' }), 'No one in the tree matches that.');
assert.ok(!/^I1 /m.test(A.find(t, 'Portland', { homeId: 'I1' })));
assert.match(A.find(t, 'Leo', { homeId: 'I1', ...LIV }), /I2 \| Leo James Ashworth/);
assert.strictEqual(A.find(t, 'zzzz'), 'No one in the tree matches that.');

console.log('asktree tests passed');
