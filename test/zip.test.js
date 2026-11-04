// Run: node test/zip.test.js
// Builds real zip files by hand and checks that Media can list and extract them.
const assert = require('assert');
const zlib = require('zlib');
global.window = {};
require('../js/media.js');
const { readZip, classify } = window.Media;

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
// entries: { name, data (Buffer), deflate, utf8 }
function makeZip(entries, { zip64 = false } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data || Buffer.alloc(0);
    const body = e.deflate ? zlib.deflateRawSync(data) : data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.utf8 ? 0x800 : 0, 6);
    lh.writeUInt16LE(e.deflate ? 8 : 0, 8); lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46 + name.length);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.utf8 ? 0x800 : 0, 8);
    ch.writeUInt16LE(e.deflate ? 8 : 0, 10); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42); name.copy(ch, 46);
    central.push(ch);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const asFile = (buf, name) => new File([buf], name);
const text = async b => Buffer.from(await b.arrayBuffer()).toString('utf8');
const jpeg = Buffer.from('fakejpegbytes'.repeat(50));

(async () => {
  // stored + deflated entries, folders, unicode names, macOS clutter
  const zip = makeZip([
    { name: 'gedcom.ged', data: Buffer.from('0 HEAD\n0 TRLR\n'), deflate: true },
    { name: 'media/', data: Buffer.alloc(0) },
    { name: 'media/ann.jpg', data: jpeg, deflate: true },
    { name: 'media/bo.png', data: jpeg },
    { name: 'media/Zoë é.JPG', data: jpeg, deflate: true, utf8: true },
    { name: '__MACOSX/media/._ann.jpg', data: Buffer.from('junk') },
    { name: '.DS_Store', data: Buffer.from('junk') },
    { name: 'notes.pdf', data: Buffer.from('%PDF') },
  ]);
  const list = await readZip(asFile(zip, 'family.gdz'));
  assert.deepStrictEqual(list.map(e => e.path).sort(), ['gedcom.ged', 'media/Zoë é.JPG', 'media/ann.jpg', 'media/bo.png', 'notes.pdf']);
  const ann = list.find(e => e.name === 'ann.jpg');
  assert.strictEqual(await text(await ann.blob()), jpeg.toString());
  assert.strictEqual(await text(await list.find(e => e.name === 'bo.png').blob()), jpeg.toString());
  assert.strictEqual(await text(await list.find(e => e.name === 'gedcom.ged').blob()), '0 HEAD\n0 TRLR\n');

  // classify: a .gdz gives the GEDCOM plus only its images
  let r = await classify([{ file: asFile(zip, 'family.gdz'), path: 'family.gdz' }]);
  assert.strictEqual(r.ged.name, 'gedcom.ged');
  assert.deepStrictEqual(r.photos.map(p => p.name).sort(), ['Zoë é.JPG', 'ann.jpg', 'bo.png']);

  // classify: a folder pick (ged + photos, nested ged loses to shallow one)
  const f = (name, data = 'x') => ({ file: asFile(Buffer.from(data), name.split('/').pop()), path: name });
  r = await classify([f('Family/tree.ged', '0 HEAD'), f('Family/old/backup.ged', '0 HEAD 0 HEAD'), f('Family/pics/a.jpg'), f('Family/pics/b.webp'), f('Family/.DS_Store'), f('Family/readme.txt')]);
  assert.strictEqual(r.ged.path, 'Family/tree.ged');
  assert.deepStrictEqual(r.photos.map(p => p.path), ['Family/pics/a.jpg', 'Family/pics/b.webp']);

  // classify: photos only (no GEDCOM), and a lone .txt is taken as the GEDCOM
  r = await classify([f('a.jpg'), f('b.png')]);
  assert.strictEqual(r.ged, null); assert.strictEqual(r.photos.length, 2);
  r = await classify([f('mytree.txt', '0 HEAD')]);
  assert.strictEqual(r.ged.name, 'mytree.txt');

  // damaged / not-a-zip input does not throw out of classify
  r = await classify([{ file: asFile(Buffer.from('definitely not a zip file at all'), 'x.zip'), path: 'x.zip' }]);
  assert.strictEqual(r.ged, null); assert.ok(r.note);
  await assert.rejects(readZip(asFile(Buffer.alloc(5), 'tiny.zip')));

  console.log('zip tests passed');
})().catch(e => { console.error(e); process.exit(1); });
