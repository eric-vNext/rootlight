// Run: node test/match.test.js
// Checks that photo references in a GEDCOM pair up with the files the user supplied.
const assert = require('assert');
global.window = {};
require('../js/gedcom.js');
require('../js/media.js');
const { build } = window.Gedcom;
const { match, pieces } = window.Media;

const ged = people => '0 HEAD\n' + people.map(([id, files]) =>
  `0 @${id}@ INDI\n1 NAME P${id} /Test/\n` + files.map(f => `1 OBJE\n2 FILE ${f}\n`).join('')).join('') + '0 TRLR\n';
const supplied = (...paths) => paths.map(path => ({ path, name: path.split('/').pop(), size: 1, blob: async () => null }));
const run = (people, ...paths) => { const t = build(ged(people)); return { t, ...match(t, supplied(...paths)) }; };
const first = (r, id) => r.byPerson.get(id).items[0];

// path pieces: Windows drives, escapes, queries, Mac vs Windows accents
assert.deepStrictEqual(pieces('C:\\Users\\Sam\\Pictures\\Ann\\A%20B.JPG?x=1'), ['users', 'sam', 'pictures', 'ann', 'a b.jpg']);
assert.deepStrictEqual(pieces('Zoe\u0301.jpg'), pieces('Zo\u00e9.jpg'));
assert.deepStrictEqual(pieces('file:///home/x/./y/../z.png'), ['home', 'x', 'y', 'z.png']);

// Windows absolute path, user picked a differently named folder
{
  const r = run([['1', ['C:\\Users\\Sam\\Pictures\\Ann\\wedding.jpg']]], 'Pictures/Ann/wedding.jpg', 'Pictures/Bo/other.jpg');
  assert.strictEqual(first(r, '1').status, 'matched');
  assert.strictEqual(first(r, '1').photo.path, 'Pictures/Ann/wedding.jpg');
  assert.strictEqual(first(r, '1').how, 'path');
  assert.strictEqual(r.report.unused, 1);
}

// zip prefix, bare names, case, escapes, accents written two ways
{
  const r = run([['1', ['media/ann.jpg']], ['2', ['BO.PNG']], ['3', ['my%20pic.jpg']], ['4', ['Zoe\u0301.jpg']]],
    'media/ann.jpg', 'extra/bo.png', 'my pic.jpg', 'Zo\u00e9.jpg');
  for (const id of ['1', '2', '3', '4']) assert.strictEqual(first(r, id).status, 'matched', id);
  assert.strictEqual(first(r, '2').how, 'path'); // a bare name that is unique is a clean match
  assert.strictEqual(r.report.matched, 4);
  assert.strictEqual(r.report.unused, 0);
}

// same file name in two folders: the longer shared ending wins
{
  const r = run([['1', ['D:\\fam\\ann\\1.jpg']], ['2', ['D:\\fam\\bo\\1.jpg']]], 'pics/bo/1.jpg', 'pics/ann/1.jpg');
  assert.strictEqual(first(r, '1').photo.path, 'pics/ann/1.jpg');
  assert.strictEqual(first(r, '2').photo.path, 'pics/bo/1.jpg');
}

// a true tie is reported, not guessed
{
  const r = run([['1', ['1.jpg']]], 'a/1.jpg', 'b/1.jpg');
  const it = first(r, '1');
  assert.strictEqual(it.status, 'ambiguous');
  assert.deepStrictEqual(it.options.sort(), ['a/1.jpg', 'b/1.jpg']);
  assert.strictEqual(r.byPerson.get('1').cover, null);
  assert.strictEqual(r.report.ambiguous, 1);
  assert.strictEqual(r.report.unused, 2);
}

// a tie settles when the rival is firmly taken by another reference
{
  const r = run([['1', ['x/a/1.jpg']], ['2', ['1.jpg']]], 'a/1.jpg', 'b/1.jpg');
  assert.strictEqual(first(r, '1').photo.path, 'a/1.jpg');
  assert.strictEqual(first(r, '2').status, 'matched');
  assert.strictEqual(first(r, '2').photo.path, 'b/1.jpg');
  assert.strictEqual(first(r, '2').how, 'claimed');
}

// only the file name agrees -> still matched, but flagged as weaker
{
  const r = run([['1', ['C:\\old\\place\\face.jpg']]], 'new/face.jpg');
  assert.strictEqual(first(r, '1').status, 'matched');
  assert.strictEqual(first(r, '1').how, 'name');
}

// extension changed by the exporter -> fuzzy; exact name always beats fuzzy
{
  const r = run([['1', ['face.png']], ['2', ['same.jpg']]], 'face.jpg', 'same.jpg', 'same.png');
  assert.strictEqual(first(r, '1').how, 'fuzzy');
  assert.strictEqual(first(r, '2').photo.path, 'same.jpg');
  assert.strictEqual(first(r, '2').how, 'path');
  assert.strictEqual(r.report.fuzzy, 1);
}

// web links are counted, never matched, even if a file shares the name
{
  const r = run([['1', ['https://example.com/img/ann.jpg']]], 'ann.jpg');
  assert.strictEqual(first(r, '1').status, 'remote');
  assert.strictEqual(r.report.remote, 1);
  assert.strictEqual(r.report.matched, 0);
}

// the cover is the main photo if it matched, otherwise the first one that did
{
  const t = build(`0 HEAD\n0 @1@ INDI\n1 NAME A /B/\n1 OBJE\n2 FILE one.jpg\n1 OBJE\n2 FILE two.jpg\n2 _PRIM Y\n1 OBJE\n2 FILE three.jpg\n0 TRLR\n`);
  let r = match(t, supplied('one.jpg', 'two.jpg', 'three.jpg'));
  assert.strictEqual(r.byPerson.get('1').cover.photo.path, 'two.jpg');
  r = match(t, supplied('one.jpg', 'three.jpg'));
  assert.strictEqual(r.byPerson.get('1').cover.photo.path, 'one.jpg');
  assert.strictEqual(r.report.missing, 1);
  assert.deepStrictEqual(r.report.missingList.map(m => m.file), ['two.jpg']);
}

// wrong folder: nothing matches, everything is reported; no photos supplied at all is fine too
{
  const r = run([['1', ['a.jpg']], ['2', ['b.jpg']]], 'unrelated/x.jpg');
  assert.strictEqual(r.report.matched, 0);
  assert.strictEqual(r.report.missing, 2);
  assert.strictEqual(r.report.unused, 1);
  assert.strictEqual(match(r.t, []).report.missing, 2);
}

// the same photo may legitimately belong to several people (a group shot)
{
  const r = run([['1', ['group.jpg']], ['2', ['C:\\x\\group.jpg']]], 'pics/group.jpg');
  assert.strictEqual(first(r, '1').photo, first(r, '2').photo);
  assert.strictEqual(r.report.unused, 0);
}

// people with no photos are left out; and it is fast on a large tree
{
  const people = Array.from({ length: 5000 }, (_, i) => [String(i), [`C:\\Pics\\f${i % 1500}\\img${i}.jpg`]]);
  const files = people.map(([, [f]]) => 'photos/' + f.split('\\').slice(-2).join('/'));
  const t = build(ged(people.concat([['none', []]])));
  const t0 = Date.now();
  const r = match(t, supplied(...files));
  assert.ok(Date.now() - t0 < 1000, 'matching 5000 refs should take well under a second');
  assert.strictEqual(r.report.matched, 5000);
  assert.strictEqual(r.byPerson.has('none'), false);
}

console.log('match tests passed');
