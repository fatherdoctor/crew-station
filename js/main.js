/* Crew station: the loop. See docs/ARCHITECTURE.md for the module contracts. */
'use strict';

/* Boot: every preload goes through LOADQ (js/loadq.js: capped, timed out, retried once; the loading line counts the
   files). The whole boot (preloads, WORLD.init .. HUD.init and the first frame) is one try: a throw, an essential
   file that never arrives, or an uncaught error / rejection while booting replaces the loading text with the error
   (stack in the console) instead of leaving "loading the station" up. */
(async function main() {
  let booting = true;
  const onBootError = (ev) => { if (booting) LOADQ.showError((ev && (ev.error || ev.reason)) || (ev && ev.message) || ev); };
  addEventListener('error', onBootError); addEventListener('unhandledrejection', onBootError);
  const endBoot = () => { booting = false; removeEventListener('error', onBootError); removeEventListener('unhandledrejection', onBootError); };
  const stopProgress = LOADQ.onProgress(LOADQ.showProgress);

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });
  const qs = new URLSearchParams(location.search);
  const boardUrl = qs.get('board') || CONFIG.BOARD_URL;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || qs.get('reducedmotion') === '1';

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    if (typeof CAMERA !== 'undefined' && CAMERA.resize) CAMERA.resize(innerWidth, innerHeight, dpr);
  }
  addEventListener('resize', fit); fit();

  // the font is cosmetic: never wait on it longer than the loader timeout
  const fontReady = (document.fonts && document.fonts.load)
    ? Promise.race([document.fonts.load('16px VT323').catch(() => null), new Promise(res => setTimeout(res, LOADQ.config.timeoutMs))]) : Promise.resolve();
  let model, running = true, last = performance.now();
  try {
    const [m] = await Promise.all([
      BOARD.load(boardUrl, { demo: qs.get('demo') === '1', night: qs.get('night') === '1' }),
      SPRITES.load(CONFIG.SKINS),
      PROPS.preload(),
      BACKDROP.preload(),   
      fontReady,
    ]);
    model = m;
    if (LOADQ.failedBoot) throw new Error('boot error already shown');

    WORLD.init();
    PROPS.init();
    WORLD.finalize();
    AGENTS.init(model);
    FX.init(model);
    if (typeof CREWPANEL !== 'undefined') CREWPANEL.init(model);   // Crew panel: before the camera fits, so the fit uses the area beside it
    CAMERA.init(canvas);
    CAMERA.resize(innerWidth, innerHeight, Math.min(window.devicePixelRatio || 1, 2));
    if (CAMERA.fit) CAMERA.fit();
    HUD.init({ onPick: pick });
    HUD.setModel(model);
    PROPS.setInbox(model.inbox);
    BOARD.onChange((m) => { model = m; HUD.setModel(m); PROPS.setInbox(m.inbox); AGENTS.onModel(m); FX.onModel(m); });
    draw(performance.now());   // the first frame inside the boot try: a draw error shows instead of a blank stage
    stopProgress(); endBoot();
    const loading = document.getElementById('hud-loading'); if (loading) loading.remove();
    const st = LOADQ.stats;
    console.log('station: started in ' + Math.round(performance.now()) + ' ms, ' + st.done + ' files' + (st.failed.length ? ', missing: ' + st.failed.map(f => f.src).join(', ') : ''));
  } catch (e) {
    stopProgress(); endBoot();
    LOADQ.showError(e);
    return;
  }

  function pick(clientX, clientY) {
    const w = CAMERA.toWorld(clientX, clientY);
    const a = AGENTS.hitTest(w.x, w.y);
    if (a) { HUD.caption(AGENTS.captionFor(a, model)); return; }
    const p = PROPS.hitTest && PROPS.hitTest(w.x, w.y);
    if (p) { HUD.caption(p); return; }
    const mod = FX.hitTestModule && FX.hitTestModule(w.x, w.y);   // a Construction dock stack: its epic's details
    if (mod) { HUD.caption(FX.moduleCaption(mod, model)); return; }
    const t = ISO.fromScreen(w.x, w.y);
    const room = WORLD.roomAt(Math.floor(t.x), Math.floor(t.y));
    if (room) { HUD.caption(HUD.roomCaption ? HUD.roomCaption(room, model) : { title: room, lines: [] }); return; }
    HUD.caption(null);
  }

  let rafId = 0, frameErrorLogged = false;
  function schedule() { if (!rafId) rafId = requestAnimationFrame(frame); }
  function frame(now) {
    rafId = 0;
    if (!running) return;
    try { probe(now); draw(now); }
    catch (e) { if (!frameErrorLogged) { frameErrorLogged = true; console.error('station: frame error', e && e.stack ? e.stack : e); } }
    schedule();
  }
  function draw(now) {
    const dt = Math.min(0.1, Math.max(0, now - last) / 1000); last = now;
    const clock = BOARD.now ? BOARD.now() : new Date();
    AGENTS.tick(dt, model, clock);
    FX.tick(dt, model, clock, { reducedMotion });
    CAMERA.tick(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CONFIG.PALETTE.space; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    CAMERA.apply(ctx);
    BACKDROP.draw(ctx);
    // over the painting only live-state props (inbox, labels) and no FX dock modules.
    const propItems = PROPS.drawables(now / 1000);
    const fxItems = FX.drawables();
    const coverItems = BACKDROP.coverDrawables ? BACKDROP.coverDrawables() : [];   // painted walls hide figures behind them
    const items = [].concat(coverItems, propItems, AGENTS.drawables(), fxItems, typeof INTERACTIONS !== 'undefined' ? INTERACTIONS.drawables() : []);   // Interactions: held items, mugs, books, cargo, shuttle, particles
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) if (it.t !== 'label') it.draw(ctx);
    for (const it of items) if (it.t === 'label') it.draw(ctx);   // room name plates are signage: always over the set, under the night light
    const lightOpts = { night: model.isNight, litRooms: AGENTS.litRooms ? AGENTS.litRooms(model) : [], time: now / 1000 };
    BACKDROP.drawLight(ctx, lightOpts);   
    AGENTS.drawOverlay(ctx, CAMERA);   // nameplates first
    FX.drawOverlay(ctx, CAMERA);       // bubbles and tags on top of nameplates
    if (typeof INTERACTIONS !== 'undefined') INTERACTIONS.drawOverlay(ctx);   // Interactions: flickering hall lamp, shuttle in flight
    HUD.tick(dt, model, clock);
  }
  /* Canvas recovery: a mobile browser may drop the backing store of an offscreen canvas while the tab is in the
     background (iOS Safari; Chrome Android on a GPU context loss or memory pressure); the canvas then draws as
     transparent. The images the station is drawn from are Images (BACKDROP.harden), so only the canvases baked from them
     can go blank, and every module can bake them again: rebuildAll(). It runs on every return to the page (pageshow,
     persisted or not; visibilitychange to visible; the Page Lifecycle resume), on a canvas context loss / restore, and
     whenever the blank check (one known-opaque pixel of the hall layer, the hull layer, a wall strip and the star tile,
     plus each context's isContextLost) fails: on every return and every 5 s while the page is visible. */
  const BAKERS = () => [typeof BACKDROP !== 'undefined' && BACKDROP, typeof FX !== 'undefined' && FX].filter(M => M && M.rebuild);
  let lastRebuild = 0, lastProbe = 0;
  const PROBE_MS = 5000;
  function blankList() { try { return (typeof BACKDROP !== 'undefined' && BACKDROP.blankCheck) ? BACKDROP.blankCheck() : []; } catch (_) { return []; } }
  function rebuildAll(why) {
    const t0 = performance.now();
    for (const M of BAKERS()) { try { M.rebuild(why); } catch (e) { console.warn('station: rebuild failed', e); } }
    lastRebuild = performance.now();
    console.log('station: canvases rebuilt (' + why + ') in ' + Math.round(lastRebuild - t0) + ' ms');
  }
  function onReturn(why) {
    const blank = blankList();
    rebuildAll(why + (blank.length ? ', blank: ' + blank.join(', ') : ''));
    last = performance.now(); lastProbe = last;
  }
  function probe(now) {   // from the frame loop: one cheap check every PROBE_MS while visible
    if (now - lastProbe < PROBE_MS) return;
    lastProbe = now;
    const blank = blankList();
    if (blank.length) rebuildAll('probe: ' + blank.join(', '));
  }
  window.STATION_RECOVERY = { rebuildAll, onReturn, blankList, get lastRebuild() { return lastRebuild; } };
  canvas.addEventListener('contextrestored', () => onReturn('stage context restored'));
  canvas.addEventListener('contextlost', () => console.warn('station: stage context lost'));

  schedule();
  function resume(why) {
    if (document.hidden) return;
    onReturn(why);
    if (!running) { running = true; last = performance.now(); }
    schedule();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
    else resume('visible');
  });
  addEventListener('pageshow', (ev) => { resume(ev.persisted ? 'pageshow (from cache)' : 'pageshow'); });
  document.addEventListener('resume', () => resume('resume'));
})();
