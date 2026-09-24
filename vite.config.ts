import { defineConfig, type Plugin } from 'vite';

/**
 * W7.PERF.01: every backend attempt the renderer can make except the last-resort classic
 * WebGLRenderer uses `three/webgpu`, so its lazily imported chunk is on the path to the first
 * controllable frame on every supported browser. The dynamic import only starts after boot,
 * IndexedDB and the capability probe; a `modulepreload` hint lets the browser fetch and compile it
 * in parallel with the entry chunk instead. It is a hint only: nothing executes until the renderer
 * imports it, so backend selection and behaviour are unchanged.
 */
function preloadWebGpuChunk(): Plugin {
  return {
    name: 'floodline-preload-webgpu',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.name === 'three.webgpu');
        if (!chunk) return html;
        return {
          html,
          tags: [{ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `./${chunk.fileName}` }, injectTo: 'head' }],
        };
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preloadWebGpuChunk()],
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Cache separation only: three's core stays in its own long-lived vendor chunk, so an app
        // code change does not invalidate ~600 kB of unchanged library bytes. Same critical bytes.
        codeSplitting: {
          groups: [{ name: 'vendor-three', test: /node_modules[\\/]three[\\/]build[\\/]three\.(core|module)\.js/ }],
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
});
