import { defineConfig } from 'vite';

// W7.PERF.01 note: a `modulepreload` hint for the lazily imported three/webgpu chunk was tried and
// REJECTED: under the R01 network (50 Mbps, cold cache) it competed with the entry chunk for
// bandwidth and delayed the first controllable frame by ~30 ms (interleaved A/B, see
// bench/perf/results/ab-startup-throttled*.json). The dynamic import stays as the renderer's lazy load.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Cache separation only: three's core lives in its own long-lived vendor chunk, so an app
        // code change does not invalidate ~730 kB (raw) of unchanged library bytes on returning
        // visits. Same critical bytes on a cold load; no measurable cold-start change in A/B.
        codeSplitting: {
          groups: [{ name: 'vendor-three', test: /node_modules[\\/]three[\\/]build[\\/]three\.(core|module)\.js/ }],
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
});
