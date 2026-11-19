/**
 * 生成静态数据同步产物：
 *   www/data/manifest.json      版本清单（版本号 + 每个分片的哈希）
 *   www/data/ds/cXX.json        分片数据（站名已内联，可独立应用）
 * 并把版本号写回 www/data/snapshot.js（内置基线，离线首启用）。
 *
 * 运行：node scripts/build-dataset.mjs [版本号]
 * 版本号缺省用当天日期 + 序号，例如 2026111901。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SNAP = path.join(ROOT, 'www/data/snapshot.js');
const OUT = path.join(ROOT, 'www/data/ds');
const MANIFEST = path.join(ROOT, 'www/data/manifest.json');
const CHUNK_LINES = 50;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

const raw = fs.readFileSync(SNAP, 'utf8');
const m = raw.match(/window\.SNAPSHOT\s*=\s*([\s\S]*?);?\s*$/);
if (!m) throw new Error('snapshot.js 结构不符合预期');
const snap = JSON.parse(m[1].replace(/;\s*$/, ''));
const names = snap.names || [];

const version = Number(process.argv[2]) || Number(
  new Date().toISOString().slice(0, 10).replace(/-/g, '') + '01'
);

/* 统一成「站名内联」格式，分片可独立下载、独立校验 */
const lines = (snap.lines || []).map((L) => ({
  n: L.n,
  d: (L.d || []).map((d) => ({
    k: d.k,
    id: d.id,
    f: d.f,
    l: d.l,
    s: (d.s || []).map((s) => [names[s[0]] || '', s[1] || 0, s[2] || 0, s[3] || 0])
  }))
}));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const chunks = [];
for (let i = 0; i < lines.length; i += CHUNK_LINES) {
  const id = 'c' + String(chunks.length).padStart(2, '0');
  const body = JSON.stringify({ id: id, lines: lines.slice(i, i + CHUNK_LINES) });
  fs.writeFileSync(path.join(OUT, id + '.json'), body, 'utf8');
  chunks.push({
    id: id,
    hash: fnv1a(body),
    bytes: Buffer.byteLength(body),
    url: 'data/ds/' + id + '.json'
  });
}

const totalHash = fnv1a(chunks.map((c) => c.hash).join('|'));
const dirs = lines.reduce((a, l) => a + l.d.length, 0);
const stops = lines.reduce((a, l) => a + l.d.reduce((b, d) => b + d.s.length, 0), 0);

const manifest = {
  dataset: 'zhuji-bus',
  version: version,
  format: 3,
  generated: snap.generated || '',
  algorithm: 'fnv1a32',
  counts: { lines: lines.length, dirs: dirs, stops: stops, names: new Set(lines.flatMap((l) => l.d.flatMap((d) => d.s.map((s) => s[0])))).size },
  chunkLines: CHUNK_LINES,
  totalHash: totalHash,
  chunks: chunks
};
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

/* 内置基线同步版本号：离线首启即可判定本地数据新旧 */
if (snap.version !== version) {
  const patched = raw.replace(/"v":2,/, '"v":2,"version":' + version + ',');
  fs.writeFileSync(SNAP, patched, 'utf8');
}

console.log('version   :', version);
console.log('generated :', manifest.generated);
console.log('counts    :', JSON.stringify(manifest.counts));
console.log('chunks    :', chunks.length, '| total', (chunks.reduce((a, c) => a + c.bytes, 0) / 1024).toFixed(0) + ' KB');
console.log('totalHash :', totalHash);
console.log('manifest  :', path.relative(ROOT, MANIFEST));
