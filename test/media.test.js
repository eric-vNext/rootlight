// Run: node test/media.test.js
// Checks that photo references parse from every GEDCOM style we know about.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = {};
require('../js/gedcom.js');
const { build } = window.Gedcom;

const person = (id, name, body) => `0 @${id}@ INDI\n1 NAME ${name}\n${body}${body && !body.endsWith('\n') ? '\n' : ''}`;
const photos = t => id => t.get(id).media.map(m => m.name);

// GEDCOM 5.5: inline OBJE, FORM beside FILE, Windows absolute path
{
  const t = build(`0 HEAD\n${person('I1', 'Ann /Lee/', '1 OBJE\n2 FORM jpg\n2 FILE C:\\Users\\Ann\\Pictures\\ann 1950.jpg\n2 TITL Wedding day')}0 TRLR\n`);
  const m = t.get('I1').media[0];
  assert.strictEqual(m.file, 'C:\\Users\\Ann\\Pictures\\ann 1950.jpg');
  assert.strictEqual(m.name, 'ann 1950.jpg');
  assert.strictEqual(m.form, 'jpg');
  assert.strictEqual(m.title, 'Wedding day');
  assert.strictEqual(m.remote, false);
  assert.strictEqual(t.get('I1').photo, m);
}

// GEDCOM 5.5.1 / 7.0: pointer to a level-0 record, FORM under FILE, MIME-style form, records after the person
{
  const t = build(`0 HEAD\n${person('I1', 'Bo /Kay/', '1 OBJE @M1@\n1 OBJE @M2@')}` +
    `0 @M1@ OBJE\n1 FILE media/bo.JPEG\n2 FORM image/jpeg\n2 TITL Bo at five\n` +
    `0 @M2@ OBJE\n1 FILE media/will.pdf\n2 FORM application/pdf\n0 TRLR\n`);
  assert.deepStrictEqual(photos(t)('I1'), ['bo.JPEG']);
  assert.strictEqual(t.get('I1').media[0].form, 'jpg');
  assert.strictEqual(t.get('I1').media[0].title, 'Bo at five');
  assert.deepStrictEqual(t.mediaInfo, { refs: 2, images: 1, remote: 0, skipped: 1, broken: 0 });
}

// _PRIM marks the main photo, wherever the exporter put it; otherwise the first image wins
{
  const t = build(`0 HEAD\n` +
    person('I1', 'Cy /Dow/', '1 OBJE\n2 FILE a.jpg\n1 OBJE\n2 FILE b.jpg\n2 _PRIM Y\n1 OBJE\n2 FILE c.jpg\n') +
    person('I2', 'Di /Dow/', '1 OBJE\n2 FILE x.png\n1 OBJE\n2 FILE y.png\n') +
    person('I3', 'Ed /Dow/', '1 OBJE @M1@\n2 _PRIM Y\n1 OBJE @M2@\n') +
    `0 @M1@ OBJE\n1 FILE one.gif\n0 @M2@ OBJE\n1 FILE two.gif\n0 TRLR\n`);
  assert.strictEqual(t.get('I1').photo.name, 'b.jpg');
  assert.strictEqual(t.get('I2').photo.name, 'x.png');
  assert.strictEqual(t.get('I3').photo.name, 'one.gif'); // _PRIM on the referencing line counts
}

// remote links are flagged (never fetched); percent-encoding and query strings are unwrapped; no extension but a FORM still counts
{
  const t = build(`0 HEAD\n` + person('I1', 'Flo /Egg/',
    '1 OBJE\n2 FILE https://example.com/tree/pic%20one.jpg?size=big\n1 OBJE\n2 FORM png\n2 FILE https://example.com/img/12345\n'));
  const [a, b] = t.get('I1').media;
  assert.strictEqual(a.remote, true);
  assert.strictEqual(a.name, 'pic one.jpg');
  assert.strictEqual(b.form, 'png');
  assert.strictEqual(t.mediaInfo.remote, 2);
}

// robustness: dangling pointer, empty FILE, duplicate reference to one file, BLOB-only object, person with no media
{
  const t = build(`0 HEAD\n` + person('I1', 'Gus /Fox/', '1 OBJE @NOPE@\n1 OBJE\n2 FILE\n1 OBJE\n2 FILE d.jpg\n1 OBJE @M1@\n1 OBJE\n2 BLOB\n3 CONT abc\n') +
    person('I2', 'Hal /Fox/', '') + `0 @M1@ OBJE\n1 FILE d.jpg\n2 TITL Same file\n2 _PRIM Y\n0 TRLR\n`);
  assert.deepStrictEqual(photos(t)('I1'), ['d.jpg']);
  const m = t.get('I1').media[0];
  assert.strictEqual(m.title, 'Same file');
  assert.strictEqual(m.primary, true);
  assert.strictEqual(t.get('I2').photo, null);
  assert.strictEqual(t.mediaInfo.broken, 1);
}

// the demo family still parses and simply has no photos
{
  const t = build(fs.readFileSync(path.join(__dirname, '../sample/ashworth-family.ged'), 'utf8'));
  assert.strictEqual(t.people.size, 53);
  assert.strictEqual(t.mediaInfo.images, 0);
}

console.log('media tests passed');
