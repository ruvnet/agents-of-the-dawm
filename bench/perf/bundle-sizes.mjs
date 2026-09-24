#!/usr/bin/env node
/**
 * Production bundle sizes (W7.PERF.01 baseline 2b). Run after `npx vite build`:
 *   node bench/perf/bundle-sizes.mjs --label before
 * Records raw + gzip (level 9) bytes per emitted file (source maps excluded) and the static import
 * graph from index.html, so the chunks on the critical path are explicit.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

const i = process.argv.indexOf('--label');
const label = i >= 0 ? process.argv[i + 1] : 'run';
const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => !f.endsWith('.map')).sort();
const rows = files.map((f) => {
  const buf = readFileSync(`${dir}/${f}`);
  const text = f.endsWith('.js') ? buf.toString('utf8') : '';
  // Static imports only (`import ... from "./x.js"` / `import "./x.js"`), not `import("./x.js")`.
  const staticImports = [...text.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+)["']/g)].map((m) => m[1]);
  const dynamicImports = [...text.matchAll(/import\(\s*["']\.\/([^"']+)["']\s*\)/g)].map((m) => m[1]);
  return { file: f, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, staticImports: [...new Set(staticImports)], dynamicImports: [...new Set(dynamicImports)] };
});
const html = readFileSync('dist/index.html', 'utf8');
const entry = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((m) => m[1]);
const critical = new Set();
const visit = (f) => { if (critical.has(f)) return; critical.add(f); rows.find((r) => r.file === f)?.staticImports.forEach(visit); };
entry.forEach(visit);
const crit = rows.filter((r) => critical.has(r.file));
const out = {
  label, sourceSha: execSync('git rev-parse HEAD').toString().trim(), entry,
  files: rows,
  staticCriticalPath: { files: [...critical], raw: crit.reduce((a, r) => a + r.raw, 0), gzip: crit.reduce((a, r) => a + r.gzip, 0) },
  total: { raw: rows.reduce((a, r) => a + r.raw, 0), gzip: rows.reduce((a, r) => a + r.gzip, 0) },
};
mkdirSync('bench/perf/results', { recursive: true });
writeFileSync(`bench/perf/results/bundle-${label}.json`, `${JSON.stringify(out, null, 2)}\n`);
for (const r of rows) console.log(`${r.file.padEnd(42)} raw ${String(r.raw).padStart(8)}  gzip ${String(r.gzip).padStart(7)}  ${critical.has(r.file) ? 'CRITICAL(static)' : ''}`);
console.log(`static critical path: raw ${out.staticCriticalPath.raw} gzip ${out.staticCriticalPath.gzip}`);
