/* Crew station: OBJECTS. The floor-standing objects of every room as their own sprites, drawn in the figures' depth
   sort, plus three "hero" centerpieces (the animated reactor core and Watch globe, the static observatory telescope).
   Loaded after backdrop.js; BACKDROP.preload() calls OBJECTS.preload() and OBJECTS.place(), its WORLD.finalize hook
   blocks OBJECTS.footprints(), and BACKDROP.coverDrawables() appends OBJECTS.drawables(), so main.js needs no change.

   Data:
     assets/objects/<room>.json  {room, shell, sheet, objects:[{name, cell:[x,y,w,h] in the sheet,
                                  origin:[px,py] = the crop's top-left in the ROOM CANVAS, footprint:[tx,ty,tw,th] in
                                  room-local tiles ((0,0) = the rect's north tile), kind: desk|seatless|lowprofile}]}
     assets/objects/<room>.png   the sheet; assets/rooms/<room>.png is the matching shell (floor + walls + wall-mounted)
     assets/heroes/<name>.json   {frames:{<name>-NN:{x,y,w,h,anchor}}, animation:{fps}}; assets/heroes/<name>.png
   An object's world position is the room tile's translation (BACKDROP.tiles[room].A.e/f) plus its origin.

   Depth: every sprite is cut into 32 px screen-column strips (one tile diagonal each). A strip takes the depth of the
   front-most footprint tile whose diamond covers it, so a figure walking beside a long table or past a hero passes in
   front of / behind the right part of it. lowprofile objects (floor plates) take the REAR-most tile's depth - 0.4 and
   are not blocked, so a figure standing on them is drawn over them. */
'use strict';

const OBJECTS = (() => {
  const OBJ_URL = 'assets/objects/', HERO_URL = 'assets/heroes/';
  const ROOM_KEYS = ['bridge', 'workshop', 'observatory', 'watch', 'library', 'planning', 'records', 'lounge', 'bench', 'charging', 'reactor', 'pad', 'dock'];
  const HERO_SCALE = 0.7;         // heroes drawn at 70 % of their native size (nearest neighbour, about the base centre)
  const HERO_SPEED = 0.25;        // multiplier on every hero's frame rate (2 fps loops)
  const STRIP = 32;               // px: one tile diagonal (tile corners sit on multiples of 32 in world x)

  /* Page-side footprint corrections, applied only while the JSON still carries the `from` value. */
  const FIXES = {
    workshop: {
      'tool cabinet': { from: [7, 0, 1, 1], to: [3, 0, 1, 1] },    // painted right of the parts shelves, not in the east corner
      'service bench': { from: [7, 2, 1, 1], to: [7, 0, 1, 1] },   // against the north wall by the press, not on Garnet's seat
    },
    lounge: { 'north flower planter': { from: [3, 0, 2, 1], to: [2, 0, 1, 1] },   // west of the north door, not in it
              couch: { open: [[1, 1], [2, 1]], seat: true } },   // the two cushion tiles stay walkable: Obsidian sits there
    // the console is painted as a one-tile unit at (2,1), which the core hero hides (and Quartz with it):
    // its sprite moves 4 tiles south to (2,5), west of the core, where Quartz works it from (2,6) facing north
    library: { sofa: { seat: true } },   // a reader sits on its cushions (INTERACTIONS)
    reactor: { 'control console': { from: [3, 1, 2, 1], to: [2, 5, 1, 1], shift: [0, 4] } },
    // the dock's footprints are on a different scale (x up to 25 along the 30-tile long axis): placed from the crops
    // the desk sprite stands at (7,1) 2x2, clear of the centred telescope hero (4,3 3x3), of the E door (y 3..4) and its
    // inward tile; Onyx sits south of it at (7,3) facing north (BACKDROP OBJECT_TABLE)
    observatory: { 'astronomy desk': { from: [4, 1, 2, 2], to: [7, 1, 2, 2], shift: [3, 0] } },
    dock: {
      'crane cable reel': { from: [23, 0, 1, 1], to: [2, 0, 1, 1] }, 'dock crane': { from: [24, 0, 2, 1], to: [4, 0, 2, 1] },
      'plate stack east': { from: [21, 0, 2, 1], to: [1, 2, 1, 2] }, 'cable reel east': { from: [20, 0, 1, 1], to: [1, 4, 1, 1] },
      'cable reel middle': { from: [12, 0, 1, 1], to: [1, 14, 1, 1] }, 'plate stack middle': { from: [9, 0, 2, 1], to: [1, 15, 1, 2] },
      'cable reel west': { from: [4, 0, 1, 1], to: [1, 24, 1, 1] }, 'plate stack west': { from: [1, 0, 2, 1], to: [1, 25, 1, 2] },
    },
  };

  /* Objects that are deliberately NOT drawn and do not block (room -> name -> reason). */
  const SKIP = {
    bridge: { holotable: 'the globe stands in the Watch; the Bridge floor stays open' },
    pad: { 'boarding ramp': 'the shuttle sprite carries its own ramp' },
  };

  /* Heroes: footprints measured from frame 0 at the native size (reactor: a 386 px plinth diamond = 6x6; globe and
     telescope: round bases 230 / 205 px across = 5.1 / 4.5 tile discs) and re-measured at HERO_SCALE 0.7: the reactor's
     plinth is 270 px = a 4.2-tile diamond -> 4x4; the globe's base a 3.6-tile disc and the telescope's a 3.2-tile disc ->
     3x3 each (the square inside the disc is blocked). base: the floor centre of the base in cell px at the native size
     (the native anchor for the reactor; the globe's and telescope's anchors sit 20 / 9 px below their base centre, on
     the front of the base); the sprite is scaled about it. fp is room-local; replaces = the object it stands in for.
     fps is the native rate (8) before HERO_SPEED. Glow z / r are already at the 0.7 size.
     replaces: null = the hero stands on open floor (no object to stand in for).
     The globe stands centred in the Watch (4,3 3x3; the Bridge floor stays open, see SKIP). The telescope is mode
     'static': it draws ONE frame, frame 4 (of the 16 poses its moving barrel's pixels lie furthest right on screen:
     centroid +52 px, tip +232 px right of the base anchor, so it points grid north-east), centred in the Observatory
     (4,3 3x3). No glow: it is not a light. */
  const HEROES = {
    reactor: { room: 'reactor', replaces: 'reactor core and plinth', fp: [4, 3, 4, 4], base: [224, 480], fps: 8, mode: 'loop',
               glow: { color: '#3cb4ff', z: 105, r: 190, floor: 3.6, a: 0.36 } },
    globe: { room: 'watch', replaces: null, fp: [3, 3, 3, 3], base: [144, 196], fps: 8, mode: 'loop',
             glow: { color: '#3c8cff', z: 85, r: 160, floor: 3.2, a: 0.32 } },
    telescope: { room: 'observatory', replaces: 'telescope', fp: [4, 3, 3, 3], base: [224, 307], mode: 'static', frame: 4 },
  };

  const data = {};       // room -> { json, img }
  const heroData = {};   // name -> { json, img, frames: [{x, y, w, h}] }
  let items = [];        // placed objects
  let heroes = [];       // placed heroes
  let drawList = [];     // cached drawables (static strips + hero strips)
  let fpList = [];       // footprints, absolute
  let lastAuto = 0, lastManual = -1e9;

  // LOADQ (js/loadq.js): the 13 rooms' JSON + sheet are essential (a miss shows in the HUD), the hero sheets are not
  // BACKDROP.harden: alpha hardened into an Image (never a long-lived canvas: canvas recovery)
  function loadImage(src, essential) { return LOADQ.image(src, { essential }).then(im => im && (BACKDROP.harden ? BACKDROP.harden(im) : im)); }
  function loadJson(src, essential) { return LOADQ.json(src, { essential }); }

  /* Loads every room's JSON + sheet and the hero sheets. A missing room file rejects (essential). */
  function preload() {
    const roomJobs = ROOM_KEYS.map(k => Promise.all([loadJson(OBJ_URL + k + '.json', true), loadImage(OBJ_URL + k + '.png', true)]).then(([json, img]) => {
      if (json && img && Array.isArray(json.objects)) data[k] = { json, img, px: readPixels(img) };
      else console.warn('objects: no object data for ' + k + '');
    }));
    const heroJobs = Object.keys(HEROES).map(n => Promise.all([loadJson(HERO_URL + n + '.json'), loadImage(HERO_URL + n + '.png')]).then(([json, img]) => {
      if (!json || !img || !json.frames) { console.warn('objects: hero ' + n + ' missing'); return; }
      const frames = Object.keys(json.frames).sort().map(k => json.frames[k]);
      heroData[n] = { json, img, frames };
    }));
    return Promise.all(roomJobs.concat(heroJobs));
  }
  // the sheet's opaque mask, 1 bit per pixel (BACKDROP.alphaOf; null on file://: no measuring, the JSON footprints stand)
  function readPixels(img) { return BACKDROP.alphaOf ? BACKDROP.alphaOf(img) : null; }
  const opaque = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && ((m.bits[(y * m.w + x) >> 3] >> ((y * m.w + x) & 7)) & 1) === 1;
  function has(room) { return !!data[room]; }
  function heroFor(room) { for (const n in HEROES) if (HEROES[n].room === room && heroData[n] && has(room)) return n; return null; }

  /* ---- depth strips ---- */
  /* Tiles: absolute footprint tiles. Returns [{x0, x1, depth}] covering world x [wx0, wx1), merged where equal. */
  function strips(tiles, wx0, wx1, low) {
    const out = [];
    const ds = tiles.map(t => t.x - t.y), dmin = Math.min(...ds), dmax = Math.max(...ds);
    for (let k = Math.floor(wx0 / STRIP); k * STRIP < wx1; k++) {
      // tile diagonal d covers world x [(d-1)*32, (d+1)*32): strip k is covered by d = k and d = k + 1
      let near = tiles.filter(t => { const d = t.x - t.y; return d === k || d === k + 1; });
      if (!near.length) { const d = k + 1 < dmin ? dmin : dmax; near = tiles.filter(t => t.x - t.y === d); }
      const dep = near.map(t => t.x + t.y + 1);   // ISO.depth of the tile centre
      // seat (couch / sofa, FIXES seat: true): between its back and front rows, so a figure sitting on the cushions draws
      // over the seat and in front of the backrest, and one standing behind it is hidden
      const depth = low === 'seat' ? Math.min(...dep) + 0.5 : low ? Math.min(...dep) - 0.4 : Math.max(...dep);
      const x0 = Math.max(wx0, k * STRIP), x1 = Math.min(wx1, (k + 1) * STRIP);
      const prev = out[out.length - 1];
      if (prev && prev.depth === depth && prev.x1 === x0) prev.x1 = x1; else out.push({ x0, x1, depth });
    }
    return out;
  }
  /* Measured base of an object: from the lowest opaque pixel of every column of its crop (at its drawn position), the
     front corner (x + w, y + h) and the back edges (x, y) of the base diamond, in tiles (legs and overhangs make this
     approximate to ~0.5 tile). On an axis where the front corner AND the back edge both miss the footprint (front by
     >= 1 tile, back by >= 0.5), the footprint is wrong, not the sprite: it moves (same size) onto the measured back
     edge, clamped to the room. Depth strips and blocking use the result. Every object whose measured front corner is
     >= 1 tile off is logged. */
  const med = a => { const q = a.slice().sort((p, r) => p - r); return q.length ? q[Math.floor(q.length / 2)] : NaN; };
  function measureCheck(room, o, R, fp, dx, dy, px) {
    if (!px) return;
    const [cx, cy, cw, ch] = o.cell, low = [];
    for (let x = 0; x < cw; x++) for (let y = ch - 1; y >= 0; y--) if (opaque(px, cx + x, cy + y)) { low.push([dx + x + 0.5, dy + y + 1]); break; }
    if (low.length < 3) return;
    const T = ([sx, sy]) => ({ x: (sx / 32 + sy / 16) / 2, y: (sy / 16 - sx / 32) / 2 });   // world px -> tile coords (z = 0)
    let im = 0; low.forEach((p, i) => { if (p[1] > low[im][1]) im = i; });
    const L = low.slice(0, im + 1).map(T), Rr = low.slice(im).map(T);
    const fy1 = med(L.slice(Math.floor(L.length * 0.3)).map(p => p.y)), fx1 = med(Rr.slice(0, Math.ceil(Rr.length * 0.7)).map(p => p.x));
    const W0 = T(low[0]), E0 = T(low[low.length - 1]), bx = W0.x + (fy1 - W0.y), by = E0.y + (fx1 - E0.x);
    const m = { fx: fx1 - R.x, fy: fy1 - R.y, bx: bx - R.x, by: by - R.y }, jf = { x: fp.x + fp.w - R.x, y: fp.y + fp.h - R.y };
    const off = Math.max(Math.abs(m.fx - jf.x), Math.abs(m.fy - jf.y));
    measured.push({ room, name: o.name, footprint: [fp.x - R.x, fp.y - R.y, fp.w, fp.h], front: [+m.fx.toFixed(2), +m.fy.toFixed(2)], back: [+m.bx.toFixed(2), +m.by.toFixed(2)], off: +off.toFixed(2) });
    if (off < 1) return;
    const was = [fp.x - R.x, fp.y - R.y, fp.w, fp.h].join(',');
    let note = '';   // per axis: move only when the front AND the back edge both miss on that axis
    const mvx = Math.abs(m.fx - jf.x) >= 1 && Math.abs(m.bx - (fp.x - R.x)) >= 0.5, mvy = Math.abs(m.fy - jf.y) >= 1 && Math.abs(m.by - (fp.y - R.y)) >= 0.5;
    if (mvx) fp.x = R.x + Math.max(0, Math.min(R.w - fp.w, Math.round(m.bx)));
    if (mvy) fp.y = R.y + Math.max(0, Math.min(R.h - fp.h, Math.round(m.by)));
    if (mvx || mvy) note = ' -> footprint moved to ' + (fp.x - R.x) + ',' + (fp.y - R.y);
    console.warn('objects: ' + room + ' ' + o.name + ' footprint ' + was + ' vs measured base front ' + m.fx.toFixed(2) + ',' + m.fy.toFixed(2) + ' back ' + m.bx.toFixed(2) + ',' + m.by.toFixed(2) + note);
  }
  const measured = [], skipped = [];
  function tilesOf(fp) { const t = []; for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) t.push({ x, y }); return t; }
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  /* Places every object and hero once the room tiles are fitted. tiles: BACKDROP's {room: {A, rect}}. */
  function place(tiles) {
    items = []; heroes = []; fpList = []; drawList = []; measured.length = 0; skipped.length = 0;
    for (const room in data) {
      const t = tiles[room]; if (!t) continue;
      const A = t.A, R = t.rect, { json, img } = data[room];
      const hero = heroFor(room), skip = hero ? HEROES[hero].replaces : null;
      for (const o of json.objects) {
        if (o.name === skip) continue;
        if (SKIP[room] && SKIP[room][o.name]) { skipped.push(room + ' ' + o.name); continue; }   // not drawn, not blocking
        let f = o.footprint.slice(); const fix = FIXES[room] && FIXES[room][o.name];
        if (fix && fix.from && same(f, fix.from)) f = fix.to.slice();
        else if (fix && fix.from) console.log('objects: ' + room + ' ' + o.name + ' footprint ' + f + ' differs from the known bad value; using the JSON');
        const fp = { x: R.x + f[0], y: R.y + f[1], w: f[2], h: f[3] };
        let sh = (fix && fix.shift && same(o.footprint, fix.from)) ? fix.shift : [0, 0];   // a sprite moved off its painted spot
        const fsh = floorShift(room, '#' + json.objects.indexOf(o));   // Floors: whole-tile shift onto the painted floor (FLOORS.fitObjects), sprite and footprint together
        if (fsh) { fp.x += fsh[0]; fp.y += fsh[1]; sh = [sh[0] + fsh[0], sh[1] + fsh[1]]; }
        const [cx, cy, cw, ch] = o.cell, dx = Math.round(A.e + o.origin[0] + (sh[0] - sh[1]) * 32), dy = Math.round(A.f + o.origin[1] + (sh[0] + sh[1]) * 16);
        const low = o.kind === 'lowprofile';
        measureCheck(room, o, R, fp, dx, dy, data[room].px);
        const it = { room, name: o.name, kind: o.kind, fp, img, cx, cy, cw, ch, dx, dy, low };
        it.strips = strips(tilesOf(fp), dx, dx + cw, (fix && fix.seat) ? 'seat' : low);
        for (const s of it.strips) drawList.push({ depth: s.depth, kind: 'object', room, name: o.name, draw: ctx => ctx.drawImage(img, cx + s.x0 - dx, cy, s.x1 - s.x0, ch, s.x0, dy, s.x1 - s.x0, ch) });
        items.push(it);
        fpList.push({ room, name: o.name, idx: json.objects.indexOf(o) /* Floors: shift key */, kind: o.kind, x: fp.x, y: fp.y, w: fp.w, h: fp.h, desk: o.kind === 'desk', block: !low,
                      open: ((fix && fix.open) || []).map(([u, v]) => (fp.x + u) + ',' + (fp.y + v)),
                      keep: keepOf(room, '#' + json.objects.indexOf(o), fp, R) });
      }
      if (hero) placeHero(hero, R);
    }
    if (skipped.length) console.log('objects: skipped (OBJECTS.SKIP) ' + skipped.join(', '));
    console.log('objects: placed ' + items.length + ' objects in ' + Object.keys(data).length + ' rooms, ' + drawList.length + ' strips; heroes ' + heroes.map(h => h.name + ' ' + h.fp.w + 'x' + h.fp.h + ' at ' + (h.fp.x - h.rect.x) + ',' + (h.fp.y - h.rect.y)).join(', '));
  }
  function placeHero(name, R) {
    const H = HEROES[name], hd = heroData[name], f0 = hd.frames[0];
    const fp = { x: R.x + H.fp[0], y: R.y + H.fp[1], w: H.fp[2], h: H.fp[3] };
    const fsh = floorShift(H.room, name); if (fsh) { fp.x += fsh[0]; fp.y += fsh[1]; }   // Floors: the sprite follows its footprint
    const c = ISO.toScreen(fp.x + fp.w / 2, fp.y + fp.h / 2);
    const S = HERO_SCALE, dx = Math.round(c.sx - H.base[0] * S), dy = Math.round(c.sy - H.base[1] * S), dw = Math.round(f0.w * S), dh = Math.round(f0.h * S);
    const h = { name, def: H, room: H.room, rect: R, fp, img: hd.img, frames: hd.frames, dx, dy, w: dw, ht: dh, scale: S,
                frame: H.mode === 'static' ? Math.max(0, Math.min(hd.frames.length - 1, H.frame || 0)) : 0, t: 0, centre: { x: fp.x + fp.w / 2, y: fp.y + fp.h / 2 } };
    h.strips = strips(tilesOf(fp), dx, dx + dw, false);
    for (const s of h.strips) drawList.push({ depth: s.depth, kind: 'hero', room: H.room, name, draw: ctx => {   // scaled strip, nearest neighbour
      const fr = h.frames[h.frame]; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(h.img, fr.x + (s.x0 - dx) / S, fr.y, (s.x1 - s.x0) / S, fr.h, s.x0, dy, s.x1 - s.x0, dh);
    } });
    heroes.push(h);
    fpList.push({ room: H.room, name, kind: 'hero', x: fp.x, y: fp.y, w: fp.w, h: fp.h, desk: false, block: true, hero: true, keep: keepOf(H.room, name, fp, R) });
  }
  /* Floors: FLOOR_SHIFT[room]['#' + object index | hero name] = [dx, dy] whole tiles, set by FLOORS.fitObjects before it re-runs place(). */
  const FLOOR_SHIFT = {};
  /* Keep-out (placements file, FLOORS): KEEP[room]['#' + object index | hero name] = [[i, j], ...] tiles relative to the
     footprint origin that the crew must not walk on, INSTEAD of the footprint (offsets outside it allowed, clamped to the
     room). Absent = the footprint (and its open tiles) as before. Depth strips always use the footprint. */
  const KEEP = {};
  function keepOf(room, key, fp, R) {
    const k = KEEP[room] && KEEP[room][key]; if (!k) return null;
    const out = [];
    for (const [i, j] of k) { const x = fp.x + i, y = fp.y + j; if (x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h && !out.includes(x + ',' + y)) out.push(x + ',' + y); }
    return out;
  }
  function floorShift(room, name) { const r = FLOOR_SHIFT[room]; return r && r[name] ? r[name] : null; }

  /* ---- animation: reactor and globe loop at fps * HERO_SPEED; a 'static' hero (the telescope) keeps its one frame ---- */
  function tick(dt, manual) {
    if (manual !== false) lastManual = performance.now();
    for (const h of heroes) {
      if (h.def.mode === 'static') continue;
      const n = h.frames.length; h.t += dt;
      const step = 1 / ((h.def.fps || 8) * HERO_SPEED);
      while (h.t >= step) { h.t -= step; h.frame = (h.frame + 1) % n; }
    }
  }
  function autoTick() {
    const now = performance.now();
    if (now - lastManual < 200) { lastAuto = now; return; }   // someone drives tick(dt) explicitly
    const dt = lastAuto ? Math.min(0.25, (now - lastAuto) / 1000) : 0; lastAuto = now;
    if (dt > 0) tick(dt, false);
  }

  /* [{depth, draw(ctx), kind, room, name}] for the painter's sort (static array, frames advance in place). */
  function drawables() { if (!heroes.length && !items.length) return []; autoTick(); return drawList; }
  function footprints() { return fpList.slice(); }
  /* The footprint over tile (x, y); all = true includes lowprofile objects and open (sittable) tiles. */
  function footprintAt(x, y, all) {
    if (!all) return fpList.find(p => p.keep ? p.keep.includes(x + ',' + y) : (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h && p.block && !(p.open && p.open.includes(x + ',' + y)))) || null;   // keep-out tiles replace the footprint for walking
    return fpList.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) || null;
  }
  function isBlocked(x, y) { return !!footprintAt(x, y, false); }
  function heroAt(room) { return heroes.find(h => h.room === room) || null; }
  /* Night light sources: the reactor's and the (Watch) globe's glow (tile-space centre, z px above the floor). */
  function litGlows() {
    return heroes.filter(h => h.def.glow).map(h => Object.assign({ room: h.room, name: h.name, x: h.centre.x, y: h.centre.y }, h.def.glow));
  }
  /* The current frame of every GLOWING hero (reactor, globe) as {img, sx, sy, w, h, dx, dy}, for cutting them out of the
     night darkness. The telescope is not a light: it darkens with the Observatory. */
  function heroSprites() { return heroes.filter(h => h.def.glow).map(h => { const f = h.frames[h.frame]; return { img: h.img, sx: f.x, sy: f.y, w: f.w, h: f.h, dx: h.dx, dy: h.dy, dw: h.w, dh: h.ht }; }); }

  /* Warns about every seat, pad, standing spot and door tile that sits under a blocking object. */
  function verify() {
    if (!fpList.length) return [];
    const bad = [];
    const at = (x, y) => footprintAt(Math.floor(x), Math.floor(y), false);
    for (const r of CONFIG.ROOMS) {
      for (const k in (r.seats || {})) { const p = at(r.seats[k].x, r.seats[k].y); if (p) bad.push(r.key + ' seat ' + k + ' (' + r.seats[k].x + ',' + r.seats[k].y + ') under ' + p.name); }
      const sp = r.spots || {};
      for (const name of ['pads', 'stand', 'inbox', 'meet', 'leisure', 'bunks']) {
        const v = sp[name]; if (!v) continue;
        (Array.isArray(v) ? v : [v]).forEach((t, i) => { const q = name === 'pads' ? { x: t.x + 0.5, y: t.y + 0.5 } : t; const p = at(q.x, q.y);
          if (p) bad.push(r.key + ' ' + name + i + ' (' + q.x + ',' + q.y + ') under ' + p.name); });
      }
    }
    if (typeof WORLD !== 'undefined' && WORLD.doorTiles) for (const d of WORLD.doorTiles()) for (const [x, y] of [[d.x, d.y], [d.ox, d.oy]]) { const p = at(x, y); if (p) bad.push(d.room + ' door ' + d.side + ' tile (' + x + ',' + y + ') under ' + p.name); }
    for (const b of bad) console.warn('objects: ' + b);
    if (!bad.length) console.log('objects: no seat, pad, standing spot or door tile under an object');
    return bad;
  }

  return { preload, place, has, tick, drawables, footprints, footprintAt, isBlocked, heroAt, litGlows, heroSprites, verify,
           HEROES, FIXES, SKIP, FLOOR_SHIFT /* Floors */, KEEP /* keep-out */, get skipped() { return skipped.slice(); }, get measured() { return measured.slice(); }, HERO_SCALE, HERO_SPEED, get items() { return items; }, get heroes() { return heroes; } };
})();
