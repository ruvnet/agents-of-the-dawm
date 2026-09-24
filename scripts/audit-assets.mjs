#!/usr/bin/env node
// W6 asset and provenance audit (P02). Inventories every non-code file in src/, index.html,
// public/ and dist/ (after a build), matches each against an explicit provenance register, and
// scans source and the built bundle for external URLs and network APIs used at runtime.
// Writes reports/asset-register.json. Exits 1 on any unknown asset, hash mismatch, or external
// runtime URL in first-party source.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'reports', 'asset-register.json');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** Authored code and data: not media assets (their provenance is the git history of this repo). */
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.map', '.txt', '.sh', '.d.ts']);
/** Media and binary types that need a register entry. Anything else is "unclassified" and fails. */
const MEDIA_EXT = new Map(Object.entries({
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.avif': 'image', '.svg': 'image', '.ico': 'image', '.bmp': 'image',
  '.ktx2': 'texture', '.basis': 'texture', '.hdr': 'texture', '.exr': 'texture', '.dds': 'texture',
  '.mp3': 'audio', '.ogg': 'audio', '.oga': 'audio', '.wav': 'audio', '.flac': 'audio', '.m4a': 'audio', '.aac': 'audio', '.opus': 'audio', '.weba': 'audio',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.eot': 'font',
  '.glb': 'model', '.gltf': 'model', '.obj': 'model', '.fbx': 'model', '.bin': 'model-data', '.drc': 'model', '.usdz': 'model', '.vrm': 'model',
  '.wasm': 'wasm',
}));

// ---------------------------------------------------------------- the provenance register
const receiptPath = join(ROOT, 'src/wasm/pkg/RECEIPT.json');
const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null;
/** Known assets keyed by sha256. Every entry cites its evidence. */
const REGISTER = new Map();
if (receipt) {
  REGISTER.set(receipt.wasmSha256, {
    id: 'worldgraph-wasm',
    kind: 'wasm',
    author: 'ruvnet/worldgraph contributors (upstream crate authors)',
    license: receipt.crateLicense,
    source: `${receipt.sourceRepo} @ ${receipt.sourceCommit} (crate ${receipt.crate} ${receipt.crateVersion})`,
    modification: `compiled from pinned source with ${receipt.wasmPack}, wasm-bindgen ${receipt.wasmBindgen}, ${receipt.rustc}, profile ${receipt.profile}, target ${receipt.target}, wasmOpt=${receipt.wasmOpt}; generated output committed unmodified`,
    attribution: `WorldGraph (c) ruvnet/worldgraph contributors, dual licensed ${receipt.crateLicense}; include the MIT and Apache-2.0 notices with any redistribution`,
    evidence: 'src/wasm/pkg/RECEIPT.json (wasmSha256, sourceCommit, crateLicense)',
    expectedBytes: receipt.wasmBytes,
  });
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const st = statSync(dir);
  if (st.isFile()) { out.push(dir); return out; }
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    walk(join(dir, name), out);
  }
  return out;
}

function extOf(f) {
  return f.endsWith('.d.ts') ? '.d.ts' : extname(f).toLowerCase();
}

// ---------------------------------------------------------------- build (dist/) freshness
const newest = (files) => files.reduce((m, f) => Math.max(m, statSync(f).mtimeMs), 0);
const srcFiles = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')].filter(existsSync);
let buildNote = 'dist/ present and newer than src/';
const distDir = join(ROOT, 'dist');
if (!existsSync(join(distDir, 'index.html')) || newest(walk(distDir)) < newest(srcFiles)) {
  buildNote = 'dist/ missing or older than src/: ran `npx vite build`';
  execSync('npx vite build', { stdio: ['ignore', 'ignore', 'inherit'] });
}

// ---------------------------------------------------------------- inventory
const scopes = [
  { scope: 'src', files: walk(join(ROOT, 'src')) },
  { scope: 'index.html', files: existsSync(join(ROOT, 'index.html')) ? [join(ROOT, 'index.html')] : [] },
  { scope: 'public', files: walk(join(ROOT, 'public')) },
  { scope: 'dist', files: walk(distDir) },
];

const assets = [];
const unknown = [];
const unclassified = [];
const codeCounts = {};
for (const { scope, files } of scopes) {
  for (const f of files) {
    const rel = relative(ROOT, f);
    const ext = extOf(f);
    if (CODE_EXT.has(ext)) { codeCounts[ext] = (codeCounts[ext] ?? 0) + 1; continue; }
    const kind = MEDIA_EXT.get(ext);
    const buf = readFileSync(f);
    const hash = sha256(buf);
    const entry = { path: rel, scope, kind: kind ?? 'unclassified', bytes: buf.length, sha256: hash };
    if (!kind) { unclassified.push(entry); continue; }
    const reg = REGISTER.get(hash);
    if (!reg) { unknown.push({ ...entry, problem: 'no provenance register entry for this sha256' }); continue; }
    if (reg.expectedBytes && reg.expectedBytes !== buf.length) { unknown.push({ ...entry, problem: `size ${buf.length} != receipt ${reg.expectedBytes}` }); continue; }
    const { expectedBytes: _e, ...prov } = reg;
    assets.push({ ...entry, ...prov });
  }
}

// ---------------------------------------------------------------- inline / procedural content (declared, not files)
const inline = [];
const menus = existsSync(join(ROOT, 'src/ui/menus.ts')) ? readFileSync(join(ROOT, 'src/ui/menus.ts'), 'utf8') : '';
if (/LOGO_SVG\s*=\s*'<svg/.test(menus)) inline.push({ id: 'ui-logo-svg', where: 'src/ui/menus.ts LOGO_SVG', kind: 'inline vector mark', author: 'this repository (W4 UI worker)', license: 'repository license (original work)', note: 'hand-written SVG path data in source; no external file' });
inline.push({ id: 'procedural-audio', where: 'src/audio/recipes.ts', kind: 'procedural WebAudio recipes', author: 'this repository (W5 audio worker)', license: 'repository license (original work)', note: 'oscillator/noise synthesis at runtime; no audio files' });
inline.push({ id: 'procedural-geometry', where: 'src/render/**', kind: 'three.js primitives and palette', author: 'this repository (W2 renderer worker)', license: 'repository license (original work)', note: 'boxes/capsules/instanced meshes built in code; no model or texture files' });
inline.push({ id: 'fonts', where: 'src/ui/styles.css', kind: 'system font stack', author: 'n/a', license: 'n/a', note: 'system-ui stack only; no webfont files or @font-face' });

// ---------------------------------------------------------------- bundled third-party software (SBOM-lite)
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const runtimeDeps = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies ?? {});
const software = runtimeDeps.map((name) => {
  const p = lock.packages?.[`node_modules/${name}`] ?? {};
  return { name, version: p.version ?? null, license: p.license ?? null, resolved: p.resolved ?? null, integrity: p.integrity ?? null, bundledIn: 'dist/assets/*.js' };
});

// ---------------------------------------------------------------- external URL / network API scan
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const URL_RE = /\bhttps?:\/\/[^\s'"`)<>\\]+/g;
const NAMESPACE_RE = /^https?:\/\/www\.w3\.org\//;
const NET_API_RE = /\b(fetch\s*\(|navigator\.sendBeacon|new\s+WebSocket|new\s+EventSource|XMLHttpRequest|importScripts\s*\(|new\s+Worker\s*\(|new\s+SharedWorker\s*\(|\.src\s*=\s*['"`]https?:)/g;

const sourceUrls = [];
const sourceNetApis = [];
for (const f of walk(join(ROOT, 'src'))) {
  const ext = extOf(f);
  if (!['.ts', '.js', '.mjs', '.css', '.html'].includes(ext) || ext === '.d.ts') continue;
  const rel = relative(ROOT, f);
  const code = stripComments(readFileSync(f, 'utf8'));
  code.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) {
      sourceUrls.push({ file: rel, line: i + 1, url: m[0], namespace: NAMESPACE_RE.test(m[0]), context: line.trim().slice(0, 160) });
    }
    for (const m of line.matchAll(NET_API_RE)) sourceNetApis.push({ file: rel, line: i + 1, api: m[0], context: line.trim().slice(0, 160) });
  });
}
for (const f of [join(ROOT, 'index.html')]) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(URL_RE)) sourceUrls.push({ file: 'index.html', line: null, url: m[0], namespace: NAMESPACE_RE.test(m[0]), context: '' });
}

const bundle = [];
for (const f of walk(join(distDir, 'assets')).filter((x) => x.endsWith('.js') || x.endsWith('.css'))) {
  const txt = readFileSync(f, 'utf8');
  const urls = [...new Set([...txt.matchAll(URL_RE)].map((m) => m[0]))];
  const apis = {};
  for (const m of txt.matchAll(NET_API_RE)) apis[m[1].replace(/\s+/g, '')] = (apis[m[1].replace(/\s+/g, '')] ?? 0) + 1;
  bundle.push({ file: relative(ROOT, f), bytes: txt.length, absoluteUrls: urls.map((u) => ({ url: u, namespace: NAMESPACE_RE.test(u) })), networkApiMentions: apis });
}
const distHtml = existsSync(join(distDir, 'index.html')) ? readFileSync(join(distDir, 'index.html'), 'utf8') : '';
const distHtmlExternal = [...distHtml.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]).filter((u) => /^(https?:)?\/\//.test(u));

const runtimeExternalInSource = sourceUrls.filter((u) => !u.namespace);

// ---------------------------------------------------------------- verdict and report
const problems = [];
if (!receipt) problems.push('src/wasm/pkg/RECEIPT.json missing: the WorldGraph wasm has no provenance');
if (unknown.length) problems.push(`${unknown.length} asset file(s) without a provenance register entry or with a hash/size mismatch`);
if (unclassified.length) problems.push(`${unclassified.length} file(s) of an unclassified type`);
if (runtimeExternalInSource.length) problems.push(`${runtimeExternalInSource.length} absolute URL literal(s) in first-party runtime source (non-comment)`);
if (distHtmlExternal.length) problems.push(`dist/index.html references external resources: ${distHtmlExternal.join(', ')}`);
const wasmInSrc = assets.filter((a) => a.kind === 'wasm' && a.scope === 'src').length;
const wasmInDist = assets.filter((a) => a.kind === 'wasm' && a.scope === 'dist').length;
if (receipt && (wasmInSrc !== 1 || wasmInDist !== 1)) problems.push(`expected the WorldGraph wasm exactly once in src and dist; found src=${wasmInSrc} dist=${wasmInDist}`);

const report = {
  schema: 'floodline-asset-register/1',
  generatedAt: new Date().toISOString(),
  command: 'npm run audit:assets',
  sourceSha: sh('git rev-parse HEAD'),
  lockfileSha256: sha256(readFileSync(join(ROOT, 'package-lock.json'))),
  build: buildNote,
  requirement: 'P02 original rights provenance: every asset has author, license, source, modification and attribution; zero unknown entries',
  verdict: problems.length ? 'FAIL' : 'PASS',
  problems,
  scopes: scopes.map((s) => ({ scope: s.scope, files: s.files.length })),
  codeAndDataFileCounts: codeCounts,
  assets,
  unknown,
  unclassified,
  inlineAndProceduralContent: inline,
  bundledSoftware: software,
  externalUrlScan: {
    method: 'regex scan for absolute http(s) URLs and network APIs; first-party source is scanned with comments stripped; the built bundle is scanned verbatim (third-party library strings included)',
    firstPartySourceUrls: sourceUrls,
    firstPartySourceNetworkApis: sourceNetApis,
    runtimeExternalUrlsInFirstPartySource: runtimeExternalInSource,
    distIndexHtmlExternalRefs: distHtmlExternal,
    bundle,
    note: 'Bundle URLs are string constants inside three.js (docs links in warnings, XML namespaces). Whether any is fetched at runtime is measured by the P05 e2e network log (reports/e2e/p05-privacy.json), not by this static scan.',
  },
};
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

console.log(`asset audit: ${report.verdict}`);
console.log(`  assets registered: ${assets.map((a) => `${a.path} (${a.kind}, ${a.license})`).join('; ') || 'none'}`);
console.log(`  unknown: ${unknown.length}, unclassified: ${unclassified.length}, external runtime URLs in first-party source: ${runtimeExternalInSource.length}`);
for (const p of problems) console.log(`  PROBLEM: ${p}`);
console.log(`  report: ${relative(ROOT, OUT)}`);
process.exit(problems.length ? 1 : 0);
