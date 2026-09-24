// In-page recorder for scripts/bench-frame.mjs. Injected with page.addInitScript before any app
// script. Test-side only: it reads timing and the public debug handle, never changes game state.
//
// window.__benchCfg = { glMode: 'observe' | 'force-classic' } is set by a preceding init script.
(() => {
  const cfg = window.__benchCfg || { glMode: 'observe' };
  const bench = {
    firstControllableMs: null, // performance.now() (ms since navigation start) when readiness became controllable
    readyText: null,
    frames: [], // rAF deltas (ms) while the simulation exists
    ticksPerFrame: [],
    recording: false,
    ctx: [],
  };
  window.__bench = bench;

  // Renderer path discriminator: which module requested the game canvas context.
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  let forced = 0;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const lines = (new Error().stack || '').split('\n').slice(2).map((s) => s.trim());
    const frame = lines.find((l) => /assets\//.test(l)) || lines[0] || '';
    const module = /three\.webgpu/.test(frame) ? 'three.webgpu-chunk' : /assets\/index-/.test(frame) ? 'main-chunk' : 'other';
    let blocked = false;
    if (cfg.glMode === 'force-classic' && type === 'webgl2' && this.isConnected && module === 'three.webgpu-chunk' && forced === 0) { forced += 1; blocked = true; }
    bench.ctx.push({ type, onGameCanvas: this.isConnected, module, blocked });
    if (blocked) return null;
    return origGetContext.call(this, type, attrs);
  };

  // First controllable frame: the loader's readiness line gains `is-ready` when the renderer
  // reports 'controllable' (src/ui/menus.ts setReadiness), i.e. after the first real draw.
  const mo = new MutationObserver(() => {
    if (bench.firstControllableMs !== null) return;
    const el = document.querySelector('.fl-ready.is-ready');
    if (el) { bench.firstControllableMs = performance.now(); bench.readyText = el.textContent; mo.disconnect(); }
  });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ['class'] }));

  let last = null;
  let lastTick = null;
  const loop = (t) => {
    const h = window.__floodline;
    const sim = h && h.sim && h.sim();
    if (sim && bench.recording) {
      const tick = sim.state().tick;
      if (last !== null) { bench.frames.push(t - last); bench.ticksPerFrame.push(tick - (lastTick ?? tick)); }
      last = t;
      lastTick = tick;
    } else { last = null; lastTick = null; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
