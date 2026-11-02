/* Crew station: INTERACTIONS. The crew using the station: ambient actions on the room objects (coffee, books, benches,
   planters, holotable, screens, cabinets, the reactor valve), Drones fixing hall lamps and loading the shuttle, and the
   shuttle's own loop. Contract: docs/ARCHITECTURE.md.

   Truth rule: nothing here claims work. BOARD decides a figure's state; AGENTS decides its plan (work, blocked, ask,
   charge, roam). Interactions only fill time inside a plan: roaming figures (queued / done-today / sleeping by day) do
   about one action per 90 s and otherwise sit at their own seat; working figures stretch or sip at their desk; blocked
   figures fidget at their desk; waiting and charging figures are never touched. The shuttle's cargo is the board's
   real closures and merges today (BOARD.model.events of kind closure | merge); no such event, no cargo, no flight.

   Wiring: AGENTS calls roam(a) / desk(a, mode) / pose(a) / cancel(a) / tick(dt, model) at lines marked
   "// Interactions:"; main.js adds drawables() to the depth sort and drawOverlay(ctx) after FX.drawOverlay. State
   persists in sessionStorage 'crewstation.interactions.state'. Silent. prefers-reduced-motion (or ?reducedmotion=1) halves the
   action frequency and skips the particles. */
'use strict';

const INTERACTIONS = (() => {
  let QS; try { QS = new URLSearchParams(location.search); } catch (_) { QS = new URLSearchParams(''); }
  const REDUCED = (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || QS.get('reducedmotion') === '1';
  const K = REDUCED ? 2 : 1;
  const EVERY = [60 * K, 120 * K];          // s between actions of one roaming figure (mean 90 s; 180 s reduced)
  const WORK_EVERY = [150 * K, 270 * K];    // working figure: a stretch or a sip at the desk
  const FIDGET_EVERY = [14, 28];            // blocked figure: stretch / head turn at the desk
  const LAMP_BREAK = [180, 420];            // real s until the next hall lamp starts flickering (one at a time)
  /* Helping Drones: while the board has a member with helpers_running > 0, each Drone assigned to that member loops
     inside the member's room: every HELPER_JOB_SEC it picks a new short job from the room's interactables (or a dash to
     free floor), walks there at HELPER_SPEED x the normal Drone walk, and holds a HELPER_ACTION_SEC action pose. */
  const HELPER_JOB_SEC = [3, 8], HELPER_SPEED = 1.5, HELPER_ACTION_SEC = [1, 3];
  const STORE = 'crewstation.interactions.state';
  const ITEM_K = { 'mug-full': 0.55, 'mug-empty': 0.55, 'book-closed': 0.6, 'book-open': 0.6, folder: 0.6, 'small-crate': 0.85, 'watering-can': 0.7, wrench: 0.6, hammer: 0.6, parcel: 0.8 };
  const FX_K = 1;                         // effect sprites (32 px) drawn at 1:1
  /* Hand point per facing, frame px from the feet point (scaled with the figure). Facing straight up-screen the item is
     behind the body; facing up-right / up-left the hands show past the shoulder, so the item is drawn there, in front. */
  const HAND = { south: [0, -23], 'south-east': [8, -24], east: [11, -25], 'north-east': [12, -29], north: [0, -28], 'north-west': [-12, -29], west: [-11, -25], 'south-west': [-8, -24] };
  const BEHIND = new Set(['north']);

  /* Shuttle: the pad shell paints only the ring; the parked shuttle stands on the ring centre, measured on the shell at
     world (31.1, 36.9) (BACKDROP's ROOM_TABLE note says local (4.8, 4.0)). Sheet: 6 cells 256 x 192; the native anchor
     (128, 176) sits ~26 px below the landing feet, so the cell point between the four feet (128, 148) goes on the ring
     centre (ground). Footprint 4x3 around it. */
  const SHUTTLE = { anchor: { x: 31.1, y: 36.9 }, ground: [128, 148], fp: { x: 29, y: 35, w: 4, h: 3 }, rampFootPx: [204, 170], hatchPx: [176, 150], liftZ: 110 };
  const PHASE_SEC = { closing: 2.5, engines: 3, lifting: 4.5, flight: 11, away: 600, 'return': 11, landing: 4.5 };
  const NEXT = { closing: 'engines', engines: 'lifting', lifting: 'flight', flight: 'away', away: 'return', 'return': 'landing', landing: 'landed' };

  /* ---------- assets ---------- */
  const img = { items: null, shuttle: null }, frm = { items: {}, shuttle: {} };
  function loadAtlas(name, base) {   // non-essential, each sheet on its own: a missing one only silences what draws from it
    if (typeof LOADQ === 'undefined') return;
    Promise.all([LOADQ.json(base + '.json'), LOADQ.image(base + '.png')])
      .then(([j, im]) => { if (j && im && j.frames) { img[name] = im; frm[name] = j.frames; } else console.warn('interactions: ' + base + ' missing'); });
  }
  loadAtlas('items', 'assets/props/items'); loadAtlas('shuttle', 'assets/props/shuttle');

  /* ---------- helpers ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const cen = t => ({ x: Math.floor(t.x) + 0.5, y: Math.floor(t.y) + 0.5 });
  const sameTile = (a, b) => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y);
  const roomRect = key => CONFIG.ROOMS.find(r => r.key === key);
  const api = () => AGENTS._ix;
  const DIRS = () => SPRITES.DIRS;
  function dir8(dx, dy) { return SPRITES.headingToDir ? SPRITES.headingToDir(dx, dy) : 'south'; }
  /* The nearest facing a skin actually has for a track (so a pose never falls back to a standing rot frame). */
  function poseDir(skin, track, want) {
    if (SPRITES.hasTrack(skin, track + '_' + want)) return want;
    const D = DIRS(), i = D.indexOf(want);
    for (let d = 1; d <= 4; d++) for (const j of [i + d, i - d]) { const dd = D[(j + 8) % 8]; if (SPRITES.hasTrack(skin, track + '_' + dd)) return dd; }
    return null;
  }
  const isRight = dir => dir === 'east' || dir === 'north-east' || dir === 'south-east' || (dir === 'north' && Math.random() < 0.5);

  /* ---------- state (persisted) ---------- */
  let S = null, dirty = false, saveT = 0, T = 0, built = false, model = null;
  function fresh() { return { v: 1, day: null, mugs: [], bar: 3, books: [], folderOut: false, lamps: {}, lampNext: null,
    shuttle: { phase: 'landed', since: Date.now(), loaded: [], shipped: [], trip: 0, unload: 0 } }; }
  function loadState() { try { const j = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (j && j.v === 1 && j.shuttle) return j; } catch (_) {} return null; }
  function save() {
    const out = JSON.parse(JSON.stringify(S));
    for (const m of out.mugs) if (m.at === 'held') m.at = deskOf(m.owner) ? 'desk' : 'bar';   // a carried mug reloads at its desk
    try { sessionStorage.setItem(STORE, JSON.stringify(out)); } catch (_) {}
    dirty = false;
  }
  const touch = () => { dirty = true; };

  /* ---------- registry ---------- */
  const reg = { list: [], by: {} }, spots = { read: [], bars: [], cargo: null, ramp: null };
  let seatSet = new Set(), doorSet = new Set();
  function addIx(it) { reg.list.push(it); (reg.by[it.kind] = reg.by[it.kind] || []).push(it); return it; }
  function freeFloor(x, y, room) {
    const r = roomRect(room);
    if (r && !(x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) return false;
    return WORLD.walkable(x, y) && !WORLD.isBlocked(x, y) && !seatSet.has(x + ',' + y) && !doorSet.has(x + ',' + y);
  }
  /* Stand tiles beside a footprint, front sides first (south, east: the figure stays visible), with the facing toward it. */
  function standsFor(fp, room) {
    const out = [];
    const push = (x, y, dx, dy) => { if (freeFloor(x, y, room)) out.push({ x, y, face: dir8(dx, dy) }); };
    for (let x = fp.x; x < fp.x + fp.w; x++) push(x, fp.y + fp.h, 0, -1);
    for (let y = fp.y; y < fp.y + fp.h; y++) push(fp.x + fp.w, y, -1, 0);
    for (let y = fp.y; y < fp.y + fp.h; y++) push(fp.x - 1, y, 1, 0);
    for (let x = fp.x; x < fp.x + fp.w; x++) push(x, fp.y - 1, 0, 1);
    return out;
  }
  const KINDS = [   // (room, object name) -> interactable kind; the actions per kind are below
    ['lounge', /cafe bar/, 'bar'], ['watch', /coffee machine/, 'bar'], ['lounge', /planter/, 'planter'],
    ['workshop', /hydraulic press/, 'press'], ['workshop', /lathe/, 'lathe'], ['workshop', /drill bench/, 'drill'],
    ['bench', /workbench (vise|testing)/, 'workbench'], ['records', /archive shelves/, 'cabinet'],
    ['planning', /war table|terrain holotable/, 'table'], ['reactor', /control console/, 'console'], ['reactor', /coolant tanks/, 'valve'],
    ['pad', /service crane/, 'cargo'], ['library', /drawer cabinet|book stand/, 'shelf'],
  ];
  function deskOf(key) {
    const b = typeof BACKDROP !== 'undefined' && BACKDROP.deskTileOf ? BACKDROP.deskTileOf(key) : null;
    const s = seatOf(key); if (!b || !s || (b.x === s.x && b.y === s.y)) return null;
    return b;
  }
  function seatOf(key) { for (const r of CONFIG.ROOMS) if (r.seats && r.seats[key]) return Object.assign({ room: r.key }, r.seats[key]); return null; }
  function build() {
    reg.list.length = 0; for (const k in reg.by) delete reg.by[k];
    spots.read.length = 0; spots.bars.length = 0;
    seatSet = new Set(); for (const r of CONFIG.ROOMS) for (const k in (r.seats || {})) seatSet.add(r.seats[k].x + ',' + r.seats[k].y);
    doorSet = new Set(); for (const d of WORLD.doorTiles()) { doorSet.add(d.x + ',' + d.y); doorSet.add(d.ox + ',' + d.oy); }
    const items = (typeof OBJECTS !== 'undefined' && OBJECTS.items) || [];
    for (const o of items) {
      const k = KINDS.find(([room, re]) => room === o.room && re.test(o.name)); if (!k) continue;
      const stands = standsFor(o.fp, o.room); if (!stands.length) continue;
      const it = addIx({ key: o.room + ':' + o.name, room: o.room, name: o.name, kind: k[2], fp: o.fp, stands,
        at: { x: o.fp.x + o.fp.w / 2, y: o.fp.y + o.fp.h / 2 } });
      if (it.kind === 'bar') spots.bars.push(it);
      if (it.kind === 'cargo') spots.cargo = it;
    }
    // painted (shell) furniture: Library shelves on the north and west walls, the Watch screen wall; and the globe hero
    const lib = roomRect('library');
    if (lib) {
      const st = [];
      for (let x = lib.x + 1; x < lib.x + lib.w; x++) if (freeFloor(x, lib.y, 'library')) st.push({ x, y: lib.y, face: dir8(0, -1) });
      for (let y = lib.y + 1; y < lib.y + lib.h; y++) if (freeFloor(lib.x, y, 'library')) st.push({ x: lib.x, y, face: dir8(-1, 0) });
      if (st.length) addIx({ key: 'library:shelves', room: 'library', name: 'shelves', kind: 'shelf', fp: { x: lib.x, y: lib.y, w: lib.w, h: 1 }, stands: st, at: { x: lib.x + 3, y: lib.y } });
    }
    const w = roomRect('watch'), sd = items.find(o => o.room === 'watch' && /screen desk/.test(o.name));
    if (w && sd) { const st = []; for (let x = sd.fp.x; x < sd.fp.x + sd.fp.w; x++) if (freeFloor(x, sd.fp.y + 1, 'watch')) st.push({ x, y: sd.fp.y + 1, face: dir8(0, -1) });
      if (st.length) addIx({ key: 'watch:screen wall', room: 'watch', name: 'screen wall', kind: 'screens', fp: sd.fp, stands: st, at: { x: sd.fp.x + 2, y: sd.fp.y } }); }
    // the globe: stands on its south rim, facing north
    const globe = typeof OBJECTS !== 'undefined' && OBJECTS.heroes && OBJECTS.heroes.find(h => h.name === 'globe');
    if (globe) { const st = standsFor(globe.fp, globe.room).filter(t => t.y >= globe.fp.y + globe.fp.h);
      if (st.length) addIx({ key: globe.room + ':holotable', room: globe.room, name: 'holotable', kind: 'table', fp: globe.fp, stands: st, at: globe.centre }); }
    // reading places: the Library sofa (two cushions, facing grid east; the sitter sits on the front edge so it sorts in
    // front of the sofa's depth strips) and the Garden couch's open cushion
    const sofa = items.find(o => o.room === 'library' && o.name === 'sofa');
    if (sofa) for (let i = 0; i < sofa.fp.h; i++) {
      const ax = sofa.fp.x + sofa.fp.w, ay = sofa.fp.y + i;
      if (WORLD.walkable(ax, ay)) spots.read.push({ key: 'sofa' + i, room: 'library', pt: { x: sofa.fp.x + sofa.fp.w - 0.08, y: ay + 0.5 }, approach: { x: ax, y: ay }, dir: 'south-east', busy: null });
    }
    const couch = (typeof OBJECTS !== 'undefined' ? OBJECTS.footprints() : []).find(f => f.room === 'lounge' && f.name === 'couch');
    if (couch) for (const k of couch.open || []) { const [x, y] = k.split(',').map(Number); if (seatSet.has(k) || !WORLD.walkable(x, y)) continue;
      spots.read.push({ key: 'couch' + x, room: 'lounge', pt: { x: x + 0.5, y: y + 0.5 }, approach: { x, y }, dir: SPRITES.faceDir('south'), busy: null }); }
    // the shuttle ramp: foot and hatch from the sheet's pixels, as tile points on the pad
    const A = ISO.toScreen(SHUTTLE.anchor.x, SHUTTLE.anchor.y), toT = (px, z) => ISO.fromScreen(A.sx + px[0] - SHUTTLE.ground[0], A.sy + px[1] - SHUTTLE.ground[1] + (z || 0));
    const foot = toT(SHUTTLE.rampFootPx), hatch = toT(SHUTTLE.hatchPx, 14);
    let ft = { x: Math.floor(foot.x), y: Math.floor(foot.y) };
    if (!WORLD.walkable(ft.x, ft.y) || inShuttle(ft.x, ft.y)) {
      let best = null, bd = 1e9;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = ft.x + dx, y = ft.y + dy; if (!WORLD.walkable(x, y) || inShuttle(x, y) || WORLD.roomAt(x, y) !== 'pad') continue; const d = Math.hypot(x + 0.5 - foot.x, y + 0.5 - foot.y); if (d < bd) { bd = d; best = { x, y }; } }
      if (best) ft = best;
    }
    spots.ramp = { foot: ft, footPt: foot, hatch };
    seedMugs();
    built = true;
    console.log('interactions: ' + reg.list.length + ' interactables (' + reg.list.map(i => i.key + ' x' + i.stands.length).join(', ') + '); ' + spots.read.length + ' reading places; ramp foot ' + ft.x + ',' + ft.y);
  }
  // mugs: one per crew member with a desk
  function seedMugs() { for (const m of Object.values(CONFIG.MEMBERS)) if (!m.pool && deskOf(m.key) && !S.mugs.some(q => q.owner === m.key)) S.mugs.push({ owner: m.key, at: 'desk', full: false }); }
  const inShuttle = (x, y) => x >= SHUTTLE.fp.x && x < SHUTTLE.fp.x + SHUTTLE.fp.w && y >= SHUTTLE.fp.y && y < SHUTTLE.fp.y + SHUTTLE.fp.h;

  /* ---------- action scripts ---------- */
  // steps: {go: tile} walk there; {glide: point} slide (sofa, ramp); {pose: {...}} play frames; {call: fn}
  const G = t => ({ go: t });
  const GL = p => ({ glide: p });
  const C = fn => ({ call: fn });
  function P(track, dir, secs, o) { return { pose: Object.assign({ track, dir, secs, fps: 2 }, o || {}) }; }
  const counts = {}, starts = [];
  let idleSec = 0;
  function start(a, name, steps) {
    a.ix = { name, steps, i: 0, begun: false, until: 0, t0: 0, fxAt: 0, plan: a.plan };
    a.path = null; a.target = null; a.onArrive = null; a.act = 'ix'; a.ixPose = null;
    counts[name] = (counts[name] || 0) + 1; starts.push({ t: T, name, who: a.isDrone ? 'drone' : a.key, plan: a.plan });
  }
  function next(a) { a.ix.i++; a.ix.begun = false; }
  /* Is the held item drawn? Only during a pose step (standing at the destination) whose frames do not already show it. */
  function heldShown(a) { const ix = a.ix, st = ix && ix.steps[ix.i]; return a.act === 'ix' && !!st && !!st.pose && ix.begun && !!a.ixPose && a.ixPose.showHeld !== false; }
  function finish(a) { releaseHelp(a); a.ix = null; a.ixPose = null; if (a.act === 'ix') a.act = 'idle'; }
  function begin(a, st) {
    const ix = a.ix; ix.begun = true; ix.arrived = false;
    if (st.go) {
      if (sameTile(a, st.go)) { a.x = Math.floor(a.x) + 0.5; a.y = Math.floor(a.y) + 0.5; ix.arrived = true; return; }
      if (!api().goTo(a, st.go, x => { if (x.ix) x.ix.arrived = true; x.act = 'ix'; })) { cancel(a); }
      return;
    }
    if (st.glide) { const p = { x: st.glide.x, y: st.glide.y }; a.path = [p]; a.target = p; a.onArrive = x => { if (x.ix) x.ix.arrived = true; x.act = 'ix'; }; a.act = 'walk'; return; }
    if (st.pose) {
      const p = st.pose; ix.t0 = T; ix.until = T + p.secs; ix.fxAt = T + (p.fxDelay || 0.2);
      const dir = poseDir(a.skin, p.track, p.dir) || p.dir;
      a.act = 'ix'; a.dir = dir; a.ixPose = { track: SPRITES.hasTrack(a.skin, p.track + '_' + dir) ? p.track : (p.fallback || 'rot'), dir, frame: 0, showHeld: p.showHeld !== false };
      if (p.at) { a.x = p.at.x; a.y = p.at.y; }
      return;
    }
    if (st.call) { st.call(a); next(a); }
  }
  /* Advances a figure's script; true while the figure belongs to an interaction. */
  function drive(a) {
    const ix = a.ix; if (!ix) return false;
    if (a.act === 'walk') return true;
    const st = ix.steps[ix.i];
    if (!st) { finish(a); return true; }
    if (!ix.begun) { begin(a, st); if (a.ix && st.call) drive(a); return true; }
    if (st.go || st.glide) { if (ix.arrived) next(a); else if (a.act !== 'walk') cancel(a); return true; }
    if (st.pose) {
      const p = st.pose, k = T - ix.t0;
      a.ixPose.frame = Math.floor(k * p.fps);
      if (p.swap && Math.floor(k / p.swap) % 2) a.ixPose.dir = poseDir(a.skin, p.track, p.swapDir) || a.ixPose.dir; else if (p.swap) a.ixPose.dir = poseDir(a.skin, p.track, p.dir) || p.dir;
      if (p.fx && T >= ix.fxAt) { ix.fxAt = T + p.fx.every; const at = typeof p.fx.at === 'function' ? p.fx.at(a) : p.fx.at; spawnFx(p.fx.kind, at); }
      if (T >= ix.until) { if (p.end) p.end(a); a.ixPose = null; next(a); }
      return true;
    }
    return true;
  }
  /* Drops whatever the figure was doing (a board plan change, an event, a talk): items go where they belong. */
  function cancel(a) {
    if (!a.ix && !a.held) return;
    if (a.heldMug) { const m = a.heldMug; if (deskOf(m.owner)) m.at = 'desk'; else { S.mugs.splice(S.mugs.indexOf(m), 1); S.bar++; } a.heldMug = null; }
    if (a.heldMugBar) { S.bar++; a.heldMugBar = false; }
    if (a.ixSpot) { a.ixSpot.busy = null; a.ixSpot = null; }
    if (a.ixCargo) { claims.cargo.delete(a.ixCargo); a.ixCargo = null; }
    if (a.ixUnload) { S.shuttle.unload++; a.ixUnload = false; }
    if (a.ixLamp != null) { claims.lamp.delete(a.ixLamp); a.ixLamp = null; }
    releaseHelp(a);
    a.held = null; a.ix = null; a.ixPose = null; if (a.act === 'ix') a.act = 'idle';
    touch();
  }
  const claims = { cargo: new Map(), lamp: new Map(), unload: 0, help: new Map() };   // help: "x,y" stand tile -> helper id
  function releaseHelp(a) { if (a.ixHelp) { for (const k of a.ixHelp) if (claims.help.get(k) === a.id) claims.help.delete(k); a.ixHelp = null; } }

  /* ----- individual actions (each returns {name, steps} or null) ----- */
  const seatTile = a => a.seat ? { x: a.seat.x, y: a.seat.y } : null;
  function deskFace(a) { const d = deskOf(a.key), s = seatTile(a); return d && s ? dir8(d.x - s.x, d.y - s.y) : (a.dir || 'south'); }
  const at = (x, y, z) => ({ x, y, z: z || 0 });
  function standOf(it, a) { const free = it.stands.filter(s => !AGENTS.list.some(o => o !== a && (sameTile(o, s) || (o.target && sameTile(o.target, s))))); return free.length ? pick(free) : null; }

  function coffee(a) {
    const own = spots.bars.find(b => b.room === a.berth), lounge = spots.bars.find(b => b.room === 'lounge');
    const bar = own || lounge; if (!bar) return null;
    const st = standOf(bar, a); if (!st) return null;
    const mug = S.mugs.find(m => m.owner === a.key), desk = deskOf(a.key), seat = seatTile(a);
    const steps = [];
    if (mug && mug.at === 'desk' && seat) steps.push(G(seat), P('rot', deskFace(a), 1.2), C(x => { mug.at = 'held'; x.heldMug = mug; x.held = mug.full ? 'mug-full' : 'mug-empty'; touch(); }));
    else if (S.bar <= 0) return null;
    const machine = at(bar.at.x, bar.at.y, 34);
    steps.push(G(st), P('rot', st.face, 6, { fx: { kind: 'steam', at: machine, every: 0.7 } }),
      C(x => {
        if (!x.heldMug) {   // a spare from the bar: it becomes this figure's desk mug, or is drunk at the bar
          if (S.bar <= 0) return; S.bar--;
          if (desk && seat && !S.mugs.some(m => m.owner === x.key)) { const nm = { owner: x.key, at: 'held', full: true }; S.mugs.push(nm); x.heldMug = nm; } else x.heldMugBar = true;
        } else x.heldMug.full = true;
        x.held = 'mug-full'; touch(); }));
    if (desk && seat) steps.push(G(seat), P('drink', deskFace(a), 4, { showHeld: false, fps: 1 }),
      C(x => { const m = x.heldMug; if (m) { m.at = 'desk'; m.full = true; } else if (x.heldMugBar) { S.bar++; x.heldMugBar = false; } x.heldMug = null; x.held = null; touch(); }));
    else steps.push(P('drink', st.face, 4, { showHeld: false, fps: 1 }), C(x => { if (x.heldMugBar) { S.bar++; x.heldMugBar = false; } x.held = null; touch(); }));
    return { name: 'coffee', steps };
  }
  function sip(a) {
    const mug = S.mugs.find(m => m.owner === a.key && m.at === 'desk' && m.full), seat = seatTile(a);
    if (!mug || !seat) return null;
    return { name: 'sip', steps: [G(seat), P('drink', deskFace(a), 4, { fps: 1 }), C(() => { mug.full = false; touch(); })] };
  }
  function stretch(a) { const seat = seatTile(a); return seat ? { name: 'stretch', steps: [G(seat), P('stretch', 'south', 4, { fps: 1.5 })] } : null; }
  function deskRead(a) {
    const seat = seatTile(a); if (!seat) return null;
    const dir = SPRITES.faceDir((a.seat && a.seat.face) || 'north'), has = !!poseDir(a.skin, 'read', dir) && SPRITES.hasTrack(a.skin, 'read_' + dir);
    return { name: 'read-desk', steps: [G(seat), C(x => { x.held = has ? null : 'book-open'; }),
      P(has ? 'read' : 'sit', dir, rnd(12, 20), { fps: 0.4, fx: { kind: 'page', at: x => at(x.x, x.y, 26), every: 3 } }), C(x => { x.held = null; })] };
  }
  function readingSpot(a) {
    const free = spots.read.filter(s => !s.busy && (s.room === a.berth || (a.member.leisure || []).includes(s.room)));
    return free.length ? pick(free) : null;
  }
  function library(a) {
    const shelves = (reg.by.shelf || []).filter(i => i.room === 'library'); if (!shelves.length) return null;
    const shelf = pick(shelves), st = standOf(shelf, a); if (!st) return null;
    const browse = [P('rot', st.face, 2), P('point', 'north', 3, { fps: 1 })];
    if (S.books.length && (S.books.length >= 3 || Math.random() < 0.45)) {   // shelve a book someone left out
      const b = S.books[0], sp = spots.read.find(s => s.key === b.spot);
      const tile = sp ? sp.approach : st;
      return { name: 'shelve-book', steps: [G(tile), P('rot', sp ? sp.dir : 'south', 1), C(x => { const i = S.books.indexOf(b); if (i >= 0) S.books.splice(i, 1); x.held = 'book-closed'; touch(); }),
        G(st)].concat(browse, [C(x => { x.held = null; })]) };
    }
    const sp = readingSpot(a);
    if (!sp) return { name: 'browse-shelf', steps: [G(st)].concat(browse) };
    const has = SPRITES.hasTrack(a.skin, 'read_' + sp.dir);
    return { name: 'read-' + (sp.room === 'library' ? 'sofa' : 'couch'), steps: [C(x => { sp.busy = x.id; x.ixSpot = sp; }), G(st)].concat(browse, [C(x => { x.held = 'book-closed'; }), G(sp.approach), GL(sp.pt),
      C(x => { x.held = has ? null : 'book-open'; }),
      P(has ? 'read' : 'sit', sp.dir, rnd(16, 26), { fps: 0.4, fx: { kind: 'page', at: x => at(x.x, x.y, 30), every: 3 } }),
      C(x => { x.held = null; if (S.books.length < 4 && !S.books.some(b => b.spot === sp.key)) S.books.push({ spot: sp.key }); touch(); }),
      GL(cen(sp.approach)), C(x => { sp.busy = null; x.ixSpot = null; })]) };
  }
  function water(a) {
    const ps = reg.by.planter || []; if (!ps.length) return null;
    const p = pick(ps), st = standOf(p, a); if (!st) return null;
    return { name: 'water-plants', steps: [G(st), C(x => { x.held = 'watering-can'; }),
      P('carry', st.face, 8, { fx: { kind: 'mist', at: at(p.at.x, p.at.y, 18), every: 0.6 } }), C(x => { x.held = null; })] };
  }
  function bench(a, kinds) {
    const objs = kinds.flatMap(k => reg.by[k] || []).filter(o => o.room === a.berth); if (!objs.length) return null;
    const o = pick(objs), st = standOf(o, a); if (!st) return null;
    const right = isRight(st.face), sparks = o.kind === 'press' || o.kind === 'workbench';
    return { name: 'bench-' + o.kind, steps: [G(st), P('bench', right ? 'east' : 'west', 8, { fps: 5, showHeld: false,
      fx: sparks ? { kind: 'sparks', at: at(o.at.x, o.at.y, 30), every: 0.45 } : null })] };
  }
  /* lean over a table and point: the own room's tables; a member whose room has none (Cobalt, since the Bridge
     floor is open) visits the globe holotable in the Watch */
  function table(a) {
    let t = (reg.by.table || []).filter(o => o.room === a.berth);
    if (!t.length) t = (reg.by.table || []).filter(o => o.name === 'holotable'); if (!t.length) return null;
    const o = pick(t), st = standOf(o, a); if (!st) return null;
    return { name: 'table-' + a.berth, steps: [G(st), P('lean', 'north', 5, { fps: 1 }), P('point', 'north', 3, { fps: 1.5 })] };
  }
  function scan(a) {
    const s = (reg.by.screens || [])[0]; if (!s) return null;
    const st = standOf(s, a); if (!st) return null;
    return { name: 'scan-screens', steps: [G(st), P('rot', 'north-east', 6, { swap: 1.5, swapDir: 'north-west' }), P('point', 'north', 2.5, { fps: 1.5 })] };
  }
  function files(a) {
    const cabs = reg.by.cabinet || [], seat = seatTile(a); if (!cabs.length || !seat) return null;
    const c = pick(cabs), st = standOf(c, a); if (!st) return null;
    if (S.folderOut) return { name: 'file-folder', steps: [G(seat), P('rot', deskFace(a), 1), C(x => { x.held = 'folder'; }), G(st), P('rot', st.face, 3), C(x => { x.held = null; S.folderOut = false; touch(); })] };
    return { name: 'fetch-folder', steps: [G(st), P('rot', st.face, 3), C(x => { x.held = 'folder'; }), G(seat), P('rot', deskFace(a), 1), C(x => { x.held = null; S.folderOut = true; touch(); })] };
  }
  function reactor(a) {
    const con = (reg.by.console || [])[0], val = (reg.by.valve || [])[0];
    if (val && Math.random() < 0.6) { const st = standOf(val, a); if (st) return { name: 'reactor-valve', steps: [G(st), P('bench', isRight(st.face) ? 'east' : 'west', 3, { fps: 3, showHeld: false }),
      P('rot', st.face, 3, { fx: { kind: 'steam', at: at(val.at.x, val.at.y, 40), every: 0.6 } })] }; }
    if (con) { const st = standOf(con, a) || seatTile(a); if (st) return { name: 'reactor-gauges', steps: [G(st), P('lean', 'north', 5, { fps: 1 })] }; }
    return null;
  }
  function roomAction(a) {
    switch (a.berth) {
      case 'library': return library(a);
      case 'lounge': return Math.random() < 0.5 ? water(a) : library(a);
      case 'workshop': return bench(a, ['press', 'lathe', 'drill']);
      case 'bench': return bench(a, ['workbench']);
      case 'bridge': case 'planning': return table(a);
      case 'watch': return Math.random() < 0.5 ? scan(a) : (table(a) || scan(a));   // the screen wall or the globe
      case 'records': return files(a);
      case 'reactor': return reactor(a);
      default: return deskRead(a);
    }
  }
  function choose(a) {
    const c = [], add = (w, f) => { if (f) c.push([w, f]); };
    add(5, roomAction(a)); add(2, coffee(a)); add(2, sip(a)); add(1, stretch(a)); add(1, deskRead(a));
    if ((a.member.leisure || []).includes('library') && a.berth !== 'library' && Math.random() < 0.5) add(1, library(a));
    add(1, 'wander');
    let tot = c.reduce((s, x) => s + x[0], 0), r = Math.random() * tot;
    for (const [w, f] of c) { r -= w; if (r <= 0) return f; }
    return null;
  }

  /* ---------- Drone jobs: shuttle cargo, unloading, hall lamps ---------- */
  function cargoIds() {
    const ev = (model && model.events) || [], ids = [];
    for (const e of ev) if (e.kind === 'closure' || e.kind === 'merge') { const id = e.kind + ':' + (e.card || e.label || ''); if (!ids.includes(id)) ids.push(id); }
    return ids;
  }
  function pending() { const sh = S.shuttle; return cargoIds().filter(id => !sh.loaded.includes(id) && !sh.shipped.includes(id)); }
  function cargoJob(a) {
    const sh = S.shuttle; if (sh.phase !== 'landed' || !spots.cargo || !spots.ramp) return null;
    const cst = standOf(spots.cargo, a); if (!cst) return null;
    const foot = spots.ramp.foot, hatch = spots.ramp.hatch;
    if (sh.unload > 0) {
      sh.unload--; a.ixUnload = true; touch();
      return { name: 'shuttle-unload', steps: [G(foot), GL(hatch), P('rot', 'north-west', 0.8), C(x => { x.held = 'small-crate'; }), GL(cen(foot)), G(cst), P('rot', cst.face, 1), C(x => { x.held = null; x.ixUnload = false; touch(); })] };
    }
    const id = pending().find(i => !claims.cargo.has(i)); if (!id) return null;
    claims.cargo.set(id, a.id); a.ixCargo = id;
    return { name: 'shuttle-load', steps: [G(cst), P('rot', cst.face, 1.5), C(x => { x.held = 'small-crate'; }), P('rot', cst.face, 0.6), G(foot), P('rot', 'north-west', 1.5), GL(hatch), P('rot', 'north-west', 0.6, { showHeld: false }),   // the crate shows at the pickup and in the load pose at the ramp foot (in view), not while walking or inside the hatch
      C(x => { if (!sh.loaded.includes(id)) sh.loaded.push(id); claims.cargo.delete(id); x.ixCargo = null; x.held = null; touch(); }), GL(cen(foot))] };
  }
  function lamps() { return (typeof FX !== 'undefined' && FX._debug && FX._debug.hallLamps) || []; }
  function lampStand(l) {
    const f = ISO.fromScreen(l.fx, l.fy), x0 = Math.floor(f.x), y0 = Math.floor(f.y);
    let best = null, bd = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = x0 + dx, y = y0 + dy; if (!WORLD.walkable(x, y)) continue; const d = Math.hypot(x + 0.5 - f.x, y + 0.5 - f.y); if (d < bd) { bd = d; best = { x, y }; } }
    return best;
  }
  function lampJob(a) {
    const L = lamps(); const bad = Object.keys(S.lamps).map(Number).filter(i => L[i] && !claims.lamp.has(i)); if (!bad.length) return null;
    const i = bad[0], l = L[i], st = lampStand(l); if (!st) { delete S.lamps[i]; return null; }
    claims.lamp.set(i, a.id); a.ixLamp = i;
    return { name: 'fix-lamp', steps: [G(st), C(x => { x.held = 'wrench'; }), P('reach', 'south', 7, { fps: 2, showHeld: false, fx: { kind: 'sparks', at: { sx: l.hx, sy: l.hy, depth: ISO.depth(st.x + 0.5, st.y + 0.5, 0) + 0.3 }, every: 0.9 } }),
      C(x => { delete S.lamps[i]; claims.lamp.delete(i); x.ixLamp = null; x.held = null; touch(); })] };
  }

  /* ---------- helping Drones: a fast job loop inside the helped member's room ---------- */
  const helpStats = new Map();   // drone id -> {jobs, tiles: Set "x,y" of the action-pose tiles, byName}
  const N4 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], HELP_REACH = 4;
  /* A tile a helper may stop on: free floor of the room (WORLD.walkable: floor polygon and keep-outs; not blocked), not a
     seat or a door tile, not 4-adjacent to one (the helped member's seat and every doorway stay clear), not claimed by the
     other helper, not where another figure stands or is heading. */
  function helpTileOk(x, y, room, a) {
    if (WORLD.roomAt(x, y) !== room || !freeFloor(x, y, room)) return false;
    for (const [dx, dy] of N4) { const k = (x + dx) + ',' + (y + dy); if (seatSet.has(k) || doorSet.has(k)) return false; }
    const c = claims.help.get(x + ',' + y); if (c != null && c !== a.id) return false;
    return !AGENTS.list.some(o => o !== a && (sameTile(o, { x: x + 0.5, y: y + 0.5 }) || (o.target && Math.floor(o.target.x) === x && Math.floor(o.target.y) === y)));
  }
  /* A random tile from the list whose walk from p crosses no seat tile (the helped member sits there; the room's other
     seats stay clear too); null when a few tries find none. */
  function pickClear(list, p) {
    const pool = list.slice();
    for (let i = 0; i < 4 && pool.length; i++) {
      const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const path = WORLD.path({ x: Math.floor(p.x), y: Math.floor(p.y) }, t);
      if (path && !path.some(q => seatSet.has(Math.floor(q.x) + ',' + Math.floor(q.y)))) return t;
    }
    return null;
  }
  function helpSpeed() { return CONFIG.TIMING.walkTilesPerSec * 0.7 * 1.25 * HELPER_SPEED; }   // AGENTS: SPEED_K 0.7, Drones 1.25
  /* One job: walk to a stand tile and hold an action pose there. The pose length brings the job near its HELPER_JOB_SEC
     allowance, within HELPER_ACTION_SEC. Items appear only in the pose steps (heldShown). */
  function helpJob(a, host) {
    const room = (host.seat && host.seat.room) || host.berth;
    const here = Math.floor(a.x) + ',' + Math.floor(a.y);
    const ok = t => !!t && (t.x + ',' + t.y) !== here && helpTileOk(t.x, t.y, room, a);
    const allowance = rnd(HELPER_JOB_SEC[0], HELPER_JOB_SEC[1]);
    const poseSecs = t => { const walk = (Math.abs(t.x + 0.5 - a.x) + Math.abs(t.y + 0.5 - a.y)) / helpSpeed() * 1.2;
      return Math.max(HELPER_ACTION_SEC[0], Math.min(HELPER_ACTION_SEC[1], allowance - walk)); };
    // short hops keep the loop frantic: prefer tiles within HELP_REACH (grid steps) of the helper, else anywhere in the room
    const md = t => Math.abs(t.x + 0.5 - a.x) + Math.abs(t.y + 0.5 - a.y);
    const near = list => { const n = list.filter(t => md(t) <= HELP_REACH); return n.length ? n : list; };
    const floor = near((WORLD.tilesOf ? WORLD.tilesOf(room) : []).filter(ok));
    const c = [], add = (w, f) => c.push([w, f]);
    for (const it of reg.list) {
      if (it.room !== room || it.key === a.helpLast) continue;
      const st = it.stands.filter(ok).filter(t => md(t) <= HELP_REACH + 1); if (!st.length) continue;
      add(3, () => { const t = pickClear(st, a); if (!t) return null; return objHelp(a, it, t, poseSecs(t)); });
    }
    const desk = deskOf(host.key);   // tap the helped member's terminal from the desk's ends (never the seat side, never behind the screens)
    if (desk && a.helpLast !== 'terminal') { const st = standsFor({ x: desk.x, y: desk.y, w: 1, h: 1 }, room).filter(t => t.y === desk.y || t.x === desk.x && t.y > desk.y).filter(ok).filter(t => md(t) <= HELP_REACH + 1);
      if (st.length) add(2, () => { const t = pickClear(st, a); if (!t) return null; return { key: 'terminal', name: 'help-terminal', tiles: [t], steps: [G(t), P('point', t.face, poseSecs(t), { fps: 2 })] }; }); }
    if (floor.length) {
      add(1, () => { const t = pickClear(floor, a); if (!t) return null; return { key: 'reach', name: 'help-reach', tiles: [t], steps: [G(t), C(x => { x.held = 'wrench'; }),
        P('reach', 'south', poseSecs(t), { fps: 3, showHeld: false, fx: { kind: 'sparks', at: at(t.x + 0.5, t.y + 0.5, 62), every: 0.5 } }), C(x => { x.held = null; })] }; });
      if (floor.length > 1) add(1.5, () => {   // carry a crate or a tool between two spots: shown at the pick-up and set-down poses only
        const t1 = pickClear(floor, a); if (!t1) return null;
        const t2 = pickClear(floor.filter(t => t !== t1 && Math.abs(t.x - t1.x) + Math.abs(t.y - t1.y) >= 2 && Math.abs(t.x - t1.x) + Math.abs(t.y - t1.y) <= HELP_REACH), { x: t1.x + 0.5, y: t1.y + 0.5 }); if (!t2) return null;
        const item = Math.random() < 0.6 ? 'small-crate' : (Math.random() < 0.5 ? 'wrench' : 'hammer'), s = Math.max(HELPER_ACTION_SEC[0], poseSecs(t1) / 2);
        return { key: 'carry', name: 'help-carry', tiles: [t1, t2], steps: [G(t1), C(x => { x.held = item; }), P('rot', 'south-east', s), G(t2), P('rot', 'south-west', s), C(x => { x.held = null; })] }; });
      add(c.length ? 0.8 : 1, () => { const t = pickClear(floor, a); if (!t) return null; return { key: 'dash', name: 'help-dash', tiles: [t], steps: [G(t), P('head', Math.random() < 0.5 ? 'east' : 'south', HELPER_ACTION_SEC[0], { fps: 2 })] }; });
    }
    for (let tries = 0; tries < 4 && c.length; tries++) {
      let r = Math.random() * c.reduce((s, x) => s + x[0], 0), f = c[c.length - 1][1];
      for (const [w, g] of c) { r -= w; if (r <= 0) { f = g; break; } }
      const j = f(); if (j) return j;
    }
    return null;
  }
  function objHelp(a, it, t, secs) {
    const right = isRight(t.face), o = at(it.at.x, it.at.y, 30), base = { key: it.key, name: 'help-' + it.kind, tiles: [t] };
    const benchP = (fx, fps) => P('bench', right ? 'east' : 'west', secs, { fps: fps || 6, showHeld: false, fx: fx || null });
    const pose = {
      press: () => benchP({ kind: 'sparks', at: o, every: 0.35 }),
      workbench: () => benchP({ kind: 'sparks', at: o, every: 0.35 }),
      lathe: () => benchP(), drill: () => benchP(),
      valve: () => benchP({ kind: 'steam', at: at(it.at.x, it.at.y, 40), every: 0.5 }, 4),
      console: () => P('lean', 'north', secs, { fps: 2 }),
      table: () => P(Math.random() < 0.5 ? 'lean' : 'point', 'north', secs, { fps: 2 }),
      screens: () => P('rot', 'north-east', secs, { swap: 0.5, swapDir: 'north-west' }),
      bar: () => P('rot', t.face, secs, { fx: { kind: 'steam', at: at(it.at.x, it.at.y, 34), every: 0.5 } }),
    }[it.kind];
    if (pose) return Object.assign(base, { steps: [G(t), pose()] });
    const item = { cabinet: 'folder', shelf: 'book-closed', planter: 'watering-can', cargo: 'small-crate' }[it.kind] || 'wrench';
    const p = it.kind === 'planter' ? P('carry', t.face, secs, { fps: 2, fx: { kind: 'mist', at: at(it.at.x, it.at.y, 18), every: 0.4 } })
      : it.kind === 'shelf' ? P('point', 'north', secs, { fps: 2 }) : P('rot', t.face, secs);
    return Object.assign(base, { steps: [G(t), C(x => { x.held = item; }), p, C(x => { x.held = null; })] });
  }
  /* Helping plan (AGENTS doHelp): true while the loop drives the Drone; a finished job starts the next one at once. */
  function help(a, host) {
    if (!ready() || !host) return false;
    if (a.ix) return drive(a);
    const j = helpJob(a, host); if (!j) return false;
    a.ixHelp = j.tiles.map(t => t.x + ',' + t.y); for (const k of a.ixHelp) claims.help.set(k, a.id);
    a.helpLast = j.key;
    start(a, j.name, j.steps);
    const st = helpStats.get(a.id) || { jobs: 0, tiles: new Set(), byName: {} }; helpStats.set(a.id, st);
    st.jobs++; st.byName[j.name] = (st.byName[j.name] || 0) + 1; for (const k of a.ixHelp) st.tiles.add(k);
    drive(a);
    return true;
  }

  /* ---------- hooks called by AGENTS ---------- */
  function ready() { return built && typeof AGENTS !== 'undefined' && !!AGENTS._ix; }
  /* Roam plan (queued / done-today / sleeping by day, and Drones between jobs). true = handled, AGENTS skips its wander. */
  function roam(a) {
    if (!ready()) return false;
    if (a.ix) return drive(a);
    if (a.isDrone) {
      if (a.plan !== 'roam') return false;
      const job = cargoJob(a) || lampJob(a);
      if (job) { start(a, job.name, job.steps); return true; }
      return false;
    }
    if (a.plan !== 'roam') return false;
    if (a.ixWander && T < a.ixWander) return false;   // the rare walk to another room (AGENTS' own wander)
    // the action clock runs only while the figure roams (tick), so plan changes neither bank nor lose actions
    if (a.ixDue == null) a.ixDue = rnd(3, EVERY[1]);
    if ((a.ixIdle || 0) >= a.ixDue) {
      a.ixIdle = 0; a.ixDue = rnd(EVERY[0], EVERY[1]);
      const f = choose(a);
      if (f === 'wander') { a.ixWander = T + 40; counts.wander = (counts.wander || 0) + 1; starts.push({ t: T, name: 'wander', who: a.key, plan: a.plan }); return false; }
      if (f) { start(a, f.name, f.steps); drive(a); return true; }
    }
    // otherwise: sit at the own seat
    const seat = seatTile(a); if (!seat) return false;
    if (sameTile(a, seat)) { if (a.act !== 'sit') api().sitDown(a, 'sit'); return true; }
    if (a.act === 'walk') return true;
    if (api().goTo(a, seat, x => api().sitDown(x, 'sit'))) return true;
    return false;
  }
  /* Work and blocked plans, once the figure is at its seat: desk actions only. true while one runs. */
  function desk(a, mode) {
    if (!ready()) return false;
    if (a.ix) return drive(a);
    if (mode === 'blocked') {
      a.fidgetAt = Infinity;   // AGENTS' gesture fidget gives way to stretch / head turns
      if (a.ixFidget == null) a.ixFidget = T + rnd(4, FIDGET_EVERY[1]);
      if (T < a.ixFidget) return false;
      a.ixFidget = T + rnd(FIDGET_EVERY[0], FIDGET_EVERY[1]) * K;
      start(a, 'fidget', Math.random() < 0.5 ? [P('stretch', 'south', 3, { fps: 1.5 })] : [P('head', 'east', 1.3), P('rot', 'south', 0.6), P('head', 'south', 1.3)]);
      return drive(a);
    }
    if (a.ixWork == null) a.ixWork = T + rnd(20, WORK_EVERY[1]);
    if (T < a.ixWork) return false;
    a.ixWork = T + rnd(WORK_EVERY[0], WORK_EVERY[1]);
    const f = sip(a) || stretch(a); if (!f) return false;
    start(a, f.name, f.steps);
    return drive(a);
  }
  /* The frame AGENTS draws for a figure in an interaction (null = AGENTS' own choice). */
  function pose(a) {
    if (a.act === 'ix' && a.ixPose) return a.ixPose;
    // Walking presentation: a figure carrying an item walks with the normal walk animation and no
    // carry pose or bob; the item is drawn only in the pose steps at the destination (heldShown)
    return null;
  }

  /* ---------- shuttle ---------- */
  /* BACKDROP's WORLD.finalize hook unblocks every tile and re-blocks its own objects before the nav grid is rebuilt; the
     landed shuttle's tiles are kept out of that sweep here so they stay blocked across any finalize. */
  let padBlocked = null, unblockWrapped = false;
  function wrapUnblock() {
    if (unblockWrapped) return; unblockWrapped = true;
    const orig = WORLD.unblock;
    WORLD.unblock = function (x, y) { if (padBlocked && inShuttle(x, y)) return; return orig.call(this, x, y); };
  }
  function setPadBlocked(on) {
    if (padBlocked === on) return; wrapUnblock(); padBlocked = on;
    for (let y = SHUTTLE.fp.y; y < SHUTTLE.fp.y + SHUTTLE.fp.h; y++) for (let x = SHUTTLE.fp.x; x < SHUTTLE.fp.x + SHUTTLE.fp.w; x++) on ? WORLD.block(x, y) : WORLD.unblock(x, y);
    WORLD.finalize();
  }
  const onGround = ph => ph === 'landed' || ph === 'closing' || ph === 'engines' || ph === 'lifting' || ph === 'landing';
  function setPhase(ph, since) {
    const sh = S.shuttle; sh.phase = ph; sh.since = since || Date.now();
    if (ph === 'lifting') { sh.shipped = sh.shipped.concat(sh.loaded); sh.trip = sh.loaded.length; sh.loaded = []; counts['shuttle-depart'] = (counts['shuttle-depart'] || 0) + 1; }
    if (ph === 'landed' && sh.trip) { sh.unload = Math.min(3, sh.trip); sh.trip = 0; counts['shuttle-land'] = (counts['shuttle-land'] || 0) + 1; }
    setPadBlocked(onGround(ph));
    touch();
  }
  function boardHour() { try { return BOARD.now().getHours(); } catch (_) { return 12; } }
  function carrying() { return AGENTS.list.some(a => a.ix && (a.ixCargo || a.ixUnload)); }
  function tickShuttle() {
    const sh = S.shuttle;
    if (sh.phase === 'landed') {
      const n = sh.loaded.length;
      if (n && (n >= 3 || boardHour() >= 18) && !carrying() && sh.unload === 0) setPhase('closing');
      return;
    }
    let guard = 0;   // catch up phases that ended while the tab was hidden or across a reload
    while (sh.phase !== 'landed' && guard++ < 10) {
      const dur = PHASE_SEC[sh.phase] * 1000, el = Date.now() - sh.since;
      if (el < dur) break;
      setPhase(NEXT[sh.phase], sh.since + dur);
    }
  }
  function shuttleFrame() {
    const sh = S.shuttle, el = (Date.now() - sh.since) / 1000, u = Math.min(1, el / (PHASE_SEC[sh.phase] || 1));
    const ease = x => x * x * (3 - 2 * x);
    switch (sh.phase) {
      case 'landed': return { f: (pending().length || sh.unload || sh.loaded.length || carrying()) ? 'landed-open' : 'landed-closed', z: 0 };
      case 'closing': return { f: 'landed-closed', z: 0 };
      case 'engines': return { f: 'engines-lit', z: 0 };
      case 'lifting': return { f: 'lifting', z: ease(u) * SHUTTLE.liftZ };
      case 'landing': return { f: 'lifting', z: (1 - ease(u)) * SHUTTLE.liftZ };
      case 'flight': return flightAt(u);
      case 'return': return flightAt(1 - u);
      default: return null;
    }
  }
  /* Out over the hull edge (south-west of the pad: space) banking, then climbing away up-left and shrinking. */
  function flightAt(u) {
    const p0 = [0, -SHUTTLE.liftZ], p1 = [-380, 340], p2 = [-1500, -760];   // bends out below the Core room's hull edge, then climbs away
    const q = (i) => (1 - u) * (1 - u) * p0[i] + 2 * (1 - u) * u * p1[i] + u * u * p2[i];
    return { f: u < 0.35 ? 'flight-banked' : 'fly-away', mirror: u < 0.35, dx: q(0), dy: q(1), s: 1 - 0.82 * u, a: u > 0.85 ? (1 - u) / 0.15 : 1, air: true };
  }
  function drawShuttleSprite(ctx, f, x0, x1) {
    const fr = frm.shuttle && frm.shuttle[f.f]; if (!fr || !img.shuttle) return;
    const A = ISO.toScreen(SHUTTLE.anchor.x, SHUTTLE.anchor.y);
    const s = f.s || 1, ax = SHUTTLE.ground[0], ay = SHUTTLE.ground[1];
    const ox = Math.round(A.sx + (f.dx || 0)), oy = Math.round(A.sy + (f.dy || 0) - (f.z || 0));
    ctx.save(); ctx.imageSmoothingEnabled = false;
    if (f.a != null && f.a < 1) ctx.globalAlpha = Math.max(0, f.a);
    if (x0 != null) { ctx.beginPath(); ctx.rect(x0, oy - 400, x1 - x0, 800); ctx.clip(); }
    if (f.mirror) { ctx.translate(ox, oy); ctx.scale(-s, s); ctx.drawImage(img.shuttle, fr.x, fr.y, fr.w, fr.h, -ax, -ay, fr.w, fr.h); }
    else ctx.drawImage(img.shuttle, fr.x, fr.y, fr.w, fr.h, Math.round(ox - ax * s), Math.round(oy - ay * s), Math.round(fr.w * s), Math.round(fr.h * s));
    ctx.restore();
  }
  function shuttleStrips() {   // 32 px screen-column strips, each at the depth of the front-most footprint tile under it
    const A = ISO.toScreen(SHUTTLE.anchor.x, SHUTTLE.anchor.y), x0 = A.sx - SHUTTLE.ground[0], x1 = x0 + 256, fp = SHUTTLE.fp, out = [];
    const tiles = []; for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) tiles.push({ x, y });
    const ds = tiles.map(t => t.x - t.y), dmin = Math.min(...ds), dmax = Math.max(...ds);
    for (let k = Math.floor(x0 / 32); k * 32 < x1; k++) {
      let near = tiles.filter(t => { const d = t.x - t.y; return d === k || d === k + 1; });
      if (!near.length) { const d = k + 1 < dmin ? dmin : dmax; near = tiles.filter(t => t.x - t.y === d); }
      out.push({ x0: Math.max(x0, k * 32), x1: Math.min(x1, (k + 1) * 32), depth: Math.max(...near.map(t => t.x + t.y + 1)) });
    }
    return out;
  }
  let stripCache = null;

  /* ---------- particles (steam, sparks, mist, page flips) ---------- */
  const parts = [];
  const FXDEF = { steam: { frames: ['steam-puff-1', 'steam-puff-2', 'steam-puff-3'], ttl: 1.4, rise: 22 }, sparks: { frames: ['sparks-1', 'sparks-2', 'sparks-3'], ttl: 0.45, rise: 0 },
    mist: { frames: ['water-mist-1', 'water-mist-2', 'water-mist-3'], ttl: 0.9, rise: -6 }, page: { frames: ['page-flip-1', 'page-flip-2'], ttl: 0.5, rise: 4 } };
  function spawnFx(kind, p) {
    if (REDUCED || !p || parts.length > 60) return;
    let sx, sy, depth;
    if (p.sx != null) { sx = p.sx; sy = p.sy; depth = p.depth; }
    else { const s = ISO.toScreen(p.x, p.y, p.z || 0); sx = s.sx; sy = s.sy; depth = ISO.depth(p.x, p.y, 0) + 0.6; }
    parts.push({ kind, sx: sx + rnd(-3, 3), sy, depth, t: 0 });
  }
  function tickParts(dt) { for (let i = parts.length - 1; i >= 0; i--) { parts[i].t += dt; if (parts[i].t > FXDEF[parts[i].kind].ttl) parts.splice(i, 1); } }
  function drawItem(ctx, name, sx, sy, k) {
    const fr = frm.items && frm.items[name]; if (!fr || !img.items) return;
    const w = Math.max(1, Math.round(fr.w * k)), h = Math.max(1, Math.round(fr.h * k));
    ctx.drawImage(img.items, fr.x, fr.y, fr.w, fr.h, Math.round(sx - w / 2), Math.round(sy - h / 2), w, h);
  }

  /* ---------- hall lamps: a flickering lamp until a Drone fixes it ---------- */
  function tickLamps() {
    const L = lamps(); if (!L.length) return;
    if (S.lampNext == null) S.lampNext = Date.now() + rnd(20, 60) * 1000;
    if (!Object.keys(S.lamps).length && Date.now() >= S.lampNext) { S.lamps[Math.floor(Math.random() * L.length)] = 'flicker'; S.lampNext = Date.now() + rnd(LAMP_BREAK[0], LAMP_BREAK[1]) * 1000; touch(); }
  }
  function drawLampFlicker(ctx) {
    const L = lamps();
    for (const k of Object.keys(S.lamps)) {
      const l = L[+k]; if (!l) continue;
      const on = REDUCED ? false : (Math.sin(T * 23 + +k) + Math.sin(T * 7.3) * 0.8 + Math.sin(T * 41) * 0.5) > 0.9;
      if (on) continue;
      ctx.fillStyle = 'rgba(8,6,4,0.82)'; ctx.beginPath(); ctx.ellipse(Math.round(l.hx), Math.round(l.hy), 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(Math.round(l.fx), Math.round(l.fy), 22, 11, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- tick + draw ---------- */
  function tick(dt, m) {
    T += dt; if (m) model = m;
    if (!S) { S = loadState() || fresh(); }
    if (!built) { if (typeof OBJECTS === 'undefined' || !WORLD.doorTiles || !AGENTS.list.length || !AGENTS._ix) return; build(); setPadBlocked(onGround(S.shuttle.phase)); }
    if (model && model.today && S.day !== model.today) {   // a new board day: the shuttle's manifest starts over
      if (S.day) { S.shuttle.shipped = []; if (S.shuttle.phase === 'landed') S.shuttle.loaded = []; }
      S.day = model.today; touch();
    }
    for (const a of AGENTS.list) if ((a.ix && (a.plan !== a.ix.plan || a.event || a.act === 'talk')) || (!a.ix && a.held)) cancel(a);   // the board's plan always wins
    tickShuttle(); tickLamps(); tickParts(dt);
    for (const a of AGENTS.list) if (!a.isDrone && a.plan === 'roam') { idleSec += dt; a.ixIdle = (a.ixIdle || 0) + dt; }
    saveT += dt; if (dirty && saveT > 3) { saveT = 0; save(); }
  }
  function figPoint(a) { const f = api(); const s0 = ISO.toScreen(a.x, a.y), s = f.snapPoint(s0.sx, s0.sy), sc = f.figureScale(a); return { sx: s.sx, sy: s.sy + 4 * sc, sc }; }
  const list = [];
  function drawables() {
    list.length = 0;
    if (!built) return list;
    // held items
    for (const a of AGENTS.list) {
      if (!a.held || !heldShown(a)) continue;   // never while walking or gliding: only in a pose step at the destination
      const dir = (a.ixPose && a.ixPose.dir) || a.dir, h = HAND[dir] || HAND.south, behind = BEHIND.has(dir);
      list.push({ depth: ISO.depth(a.x, a.y, 0) + (behind ? 0.005 : 0.015), draw: ctx => {
        const p = figPoint(a);
        drawItem(ctx, a.held, p.sx + h[0] * p.sc, p.sy + h[1] * p.sc, (ITEM_K[a.held] || 0.6) * p.sc);
      } });
    }
    // mugs on desks and spare mugs on the bar
    for (const m of S.mugs) {
      if (m.at !== 'desk') continue;
      const d = deskOf(m.owner), s = seatOf(m.owner); if (!d || !s) continue;
      const px = d.x + 0.5 + (s.x - d.x) * 0.3 + (s.y - d.y) * 0.32, py = d.y + 0.5 + (s.y - d.y) * 0.3 - (s.x - d.x) * 0.32;
      list.push({ depth: ISO.depth(s.x + 0.5, s.y + 0.5, 0) - 0.03, draw: ctx => { const q = ISO.toScreen(px, py, 27); drawItem(ctx, m.full ? 'mug-full' : 'mug-empty', q.sx, q.sy, 0.55); } });
    }
    const lb = spots.bars.find(b => b.room === 'lounge');
    if (lb) for (let i = 0; i < Math.min(3, S.bar); i++) { const x = lb.fp.x + lb.fp.w - 0.7 - i * 0.45, y = lb.fp.y + 0.6;
      list.push({ depth: ISO.depth(lb.fp.x + lb.fp.w, lb.fp.y + 1, 0) + 0.01, draw: ctx => { const q = ISO.toScreen(x, y, 30); drawItem(ctx, 'mug-empty', q.sx, q.sy, 0.5); } }); }
    // books left on the sofa / couch
    for (const b of S.books) { const sp = spots.read.find(s => s.key === b.spot); if (!sp || sp.busy) continue;
      list.push({ depth: ISO.depth(sp.pt.x, sp.pt.y, 0) + 0.02, draw: ctx => { const q = ISO.toScreen(sp.pt.x, sp.pt.y, 12); drawItem(ctx, 'book-closed', q.sx, q.sy, 0.55); } }); }
    // the cargo waiting at the pad crane: one crate per real closure / merge not yet loaded
    if (spots.cargo && S.shuttle.phase === 'landed') {
      const n = Math.min(4, pending().filter(id => !claims.cargo.has(id)).length), st = spots.cargo.stands[0];
      for (let i = 0; i < n; i++) { const x = st.x + 0.78, y = st.y + 0.2 + (i % 2) * 0.3, z = Math.floor(i / 2) * 11;
        list.push({ depth: ISO.depth(x, y, 0), draw: ctx => { const q = ISO.toScreen(x, y, z); drawItem(ctx, 'small-crate', q.sx, q.sy - 6, 0.85); } }); }
    }
    // the shuttle on the pad (depth strips) while it is on the ground
    if (img.shuttle && onGround(S.shuttle.phase)) {
      const f = shuttleFrame();
      if (f) {
        if (!stripCache) stripCache = shuttleStrips();
        if (f.z > 0) list.push({ depth: ISO.depth(SHUTTLE.fp.x, SHUTTLE.fp.y, 0), draw: ctx => drawPadShadow(ctx, f.z) });
        for (const s of stripCache) list.push({ depth: s.depth + 0.02, draw: ctx => drawShuttleSprite(ctx, f, s.x0, s.x1) });
        if (f.f === 'landed-open' && S.shuttle.loaded.length) {   // the loaded crates, stacked inside the hatch
          const h = spots.ramp && spots.ramp.hatch;
          if (h) for (let i = 0; i < Math.min(3, S.shuttle.loaded.length); i++) list.push({ depth: stripCache[stripCache.length - 1].depth + 0.03, draw: ctx => { const q = ISO.toScreen(h.x - 0.25 - i * 0.18, h.y - 0.3, 16 + i * 2); drawItem(ctx, 'small-crate', q.sx, q.sy, 0.7); } });
        }
      }
    }
    // particles
    for (const p of parts) list.push({ depth: p.depth, draw: ctx => {
      const d = FXDEF[p.kind], u = p.t / d.ttl, fi = Math.min(d.frames.length - 1, Math.floor(u * d.frames.length));
      ctx.save(); ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1; drawItem(ctx, d.frames[fi], p.sx, p.sy - 10 - d.rise * u, FX_K); ctx.restore();
    } });
    return list;
  }
  function drawPadShadow(ctx, z) {
    const A = ISO.toScreen(SHUTTLE.anchor.x, SHUTTLE.anchor.y), k = 1 - z / (SHUTTLE.liftZ * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * k).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(A.sx, A.sy - 14, 90 * k, 40 * k, 0, 0, Math.PI * 2); ctx.fill();
  }
  /* After FX.drawOverlay: a flickering hall lamp, the shuttle in flight (over everything), the ?ixdebug=1 overlay. */
  function drawOverlay(ctx) {
    if (!built) return;
    drawLampFlicker(ctx);
    const ph = S.shuttle.phase;
    if (img.shuttle && (ph === 'flight' || ph === 'return')) { const f = shuttleFrame(); if (f) drawShuttleSprite(ctx, f); }
    if (QS.get('ixdebug') === '1') drawDebug(ctx);
  }
  function drawDebug(ctx) {
    ctx.save(); ctx.font = '9px monospace'; ctx.textAlign = 'center';
    for (const it of reg.list) for (const s of it.stands) { const q = ISO.toScreen(s.x + 0.5, s.y + 0.5); ctx.fillStyle = 'rgba(0,255,120,0.35)'; ISO.tilePath(ctx, s.x, s.y); ctx.fill(); ctx.fillStyle = '#9f9'; ctx.fillText(it.kind, q.sx, q.sy + 3); }
    for (const sp of spots.read) { const q = ISO.toScreen(sp.pt.x, sp.pt.y); ctx.fillStyle = '#ff0'; ctx.fillRect(q.sx - 2, q.sy - 2, 4, 4); }
    if (spots.ramp) { const r = spots.ramp; ctx.fillStyle = 'rgba(255,200,0,0.4)'; ISO.tilePath(ctx, r.foot.x, r.foot.y); ctx.fill(); const q = ISO.toScreen(r.hatch.x, r.hatch.y); ctx.fillStyle = '#f0f'; ctx.fillRect(q.sx - 3, q.sy - 3, 6, 6); }
    ctx.font = '14px monospace'; lamps().forEach((l, i) => { ctx.fillStyle = S.lamps[i] ? '#f44' : '#ff0'; ctx.fillText('L' + i, l.hx, l.hy - 8); });
    const fp = SHUTTLE.fp; ctx.strokeStyle = '#0ff'; for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) { ISO.tilePath(ctx, x, y); ctx.stroke(); }
    ctx.restore();
  }

  /* ---------- debug hook (screenshots, soak) ---------- */
  const _debug = {
    /* per Drone: {id, helpFor, jobs, tiles: ["x,y" action-pose tiles], byName} since the last helpers(true) */
    helpers(reset) { if (reset) helpStats.clear(); return AGENTS.list.filter(a => a.isDrone).map(a => { const s = helpStats.get(a.id) || { jobs: 0, tiles: new Set(), byName: {} }; return { id: a.id, helpFor: a.helpFor, jobs: s.jobs, tiles: Array.from(s.tiles), byName: s.byName }; }); },
    get helpClaims() { return Array.from(claims.help.entries()); },
    get state() { return S; }, get reg() { return reg; }, get spots() { return spots; }, counts, starts, get idleSec() { return idleSec; }, get T() { return T; }, REDUCED,
    pending, cargoIds,
    /* force an action on a crew member now: kind = coffee | sip | stretch | read-desk | library | water | bench | table | scan | files | reactor | room */
    force(key, kind) {
      const a = AGENTS.byKey[key] || AGENTS.list.find(x => x.isDrone && x.id === key); if (!a) return 'no figure ' + key;
      cancel(a); a.event = null;
      const fn = { coffee, sip, stretch, 'read-desk': deskRead, library, water, table, scan, files, reactor, room: roomAction,
        bench: x => bench(x, ['press', 'lathe', 'drill', 'workbench']), press: x => bench(x, ['press']) }[kind];
      const f = fn && fn(a); if (!f) return 'no action ' + kind + ' for ' + key;
      a.plan = a.plan === 'roam' ? a.plan : 'roam'; start(a, f.name, f.steps); drive(a); return f.name;
    },
    lamp(i) { const L = lamps(); if (i == null) i = Math.floor(Math.random() * L.length); S.lamps = {}; S.lamps[i] = 'flicker'; return i; },
    droneJob(n, kind) { const a = AGENTS.list.filter(x => x.isDrone)[n || 0]; if (!a) return null; cancel(a); a.plan = 'roam'; a.helpFor = null; const f = kind === 'lamp' ? lampJob(a) : cargoJob(a); if (f) { start(a, f.name, f.steps); drive(a); } return f && f.name; },
    shuttle(phase, uSec) { setPhase(phase, Date.now() - (uSec || 0) * 1000); return S.shuttle; },
    teleport(a, t) { a.x = t.x + 0.5; a.y = t.y + 0.5; a.path = null; a.target = null; },
    reset() { S = fresh(); if (built) seedMugs(); setPadBlocked(true); save(); return S; },
  };

  return { tick, roam, desk, help, pose, cancel, drawables, drawOverlay, _debug, HELPER_SPEED, get REDUCED() { return REDUCED; } };
})();
