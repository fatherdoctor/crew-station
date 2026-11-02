/* Crew station: BACKDROP. Draws the station from painted pieces registered to the grid: room tiles
   (assets/rooms/<roomKey>.png), hall pieces and hull skirts (assets/corridors/), over a procedural star field and a
   planet (assets/backdrop/planet.png).
   ?bdgrid=1 overlays the tile grid: blocked tiles red, doors yellow, seats green, desk tiles blue.

   Each piece's floor diamond sits at a known spot on its canvas (a wireframe guide), so a piece whose measured floor
   edges are within FIT_TOL of the guide (slope 0.5, no skew) is drawn by a pure translation (1 piece px = 1 world px,
   square pixels). A piece out of tolerance is drawn the same way (never sheared) and FLAGGED in the log and BACKDROP.fits.
   Rooms keep their CONFIG rects (walls stand on the rect edges) and CONFIG.DOORS, except where a painted door gap is
   narrower or shifted (ROOM_TABLE table below).

   Each room is a SHELL (floor, walls, wall-mounted things) plus its floor-standing objects as sprites, drawn by OBJECTS
   (js/objects.js) in the figures' depth sort with the wall strips; OBJECTS' footprints block walking. */
'use strict';

const BACKDROP = (() => {
  const TILE_URL = 'assets/rooms/', CORR_URL = 'assets/corridors/';
  const PLANET_URL = 'assets/backdrop/planet.png', PLANET_SCALE = 1.25;
  const WALL_H = 96;              // guide wall height, world px
  const FIT_TOL = { slope: 0.03, skew: 0.04, corner: 30 };   // slopes 0.47..0.53, |slopeL + slopeR| <= 0.04, worst corner miss (px; bevels/rails reach ~10-24 px past the guide floor)
  const MARGIN_TILES = 20;        // bounds() margin on every side, in tile heights

  /* ================= room table (TILE-LOCAL coordinates: (0, 0) is the room rect's north tile) =================
     Measured from the PNGs with the guide grid laid over them.
     seats: only where the painted desk is not one row north of the CONFIG seat (face optional);
     desks: only where the desk is not seat - 1 y; spots: replace CONFIG spots by name; fx: FX anchors by name
     (non-enumerable);
     doors: {side, at, width} in CONFIG terms, replacing the CONFIG doors of that side (painted gap narrower/shifted). */
  const ROOM_TABLE = {
    bridge: {      // console desk on the north wall, holotable mid-room (3x3), a crate west
      spots: { stand: [{ x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 }] },   // CONFIG stand (6,4)/(7,5) are on the holotable
      fx: { holotable: { x: 5, y: 4, w: 3, h: 3 } },
    },
    workshop: {    // two desks on the yellow tiles (front legs reach ~0.3 into the seat row), drill bench, shelves, lathe, press
      fx: { fabricator: { x: 8, y: 0 } },   // FX sparks at the press
    },
    observatory: { // telescope in the north corner, the desk one row south of the guide's
      seats: { onyx: { x: 5, y: 3 } },
    },
    library: {     // both desks painted one row south of the guide's
      seats: { zircon: { x: 3, y: 3 }, mica: { x: 6, y: 3 } },
      doors: [{ side: 'N', at: 4, width: 1 }],   // painted gap ~1.3 tiles: x 5's crossing hits the jamb
    },
    planning: {    // console desk on the yellow tile, war table 3x3, small holotable west, cabinet in the east corner
      doors: [{ side: 'W', at: 4, width: 1 }, { side: 'E', at: 3, width: 1 }],   // W: y 3 crosses the post; E: y 4 crosses the rail post
    },
    records: {     // the olivine's desk one row south of the guide's, shelving round the north corner
      seats: { olivine: { x: 4, y: 3 } },
    },
    lounge: {      // planters on the west wall, a coffee table, the couch (facing south), a big planter, the bar
      seats: { obsidian: { x: 4, y: 6 } },        // on the couch cushions, in front (south) of the table
      desks: { obsidian: { x: 4, y: 6 } },        // no desk: the couch itself
      spots: { leisure: [{ x: 2, y: 4 }, { x: 7, y: 2 }, { x: 7, y: 6 }] },
      doors: [{ side: 'N', at: 4, width: 1 }],
    },
    watch: {       // screen desk against the north wall (one row north of the guide's), lockers and coffee in the corner
      seats: { pyrite: { x: 4, y: 1 } },
      doors: [{ side: 'W', at: 4, width: 1 }],
    },
    bench: {       // one long workbench along the north wall; the seat between the laptop and the vise
      seats: { topaz: { x: 3, y: 1 } },
      doors: [{ side: 'W', at: 4, width: 1 }],
    },
    charging: {    // ten coils in two rows of five, the transformer on the west wall
      // pads: FX draws its ring at pad + 0.5 and AGENTS docks a figure at exactly pad + 0.5 (it paths to the nearest walkable
      // tile, then glides onto the spot); pad = coil - 0.5 puts ring and figure on the painted coil centre
      spots: { pads: [[1.34, 1.66], [2.89, 1.67], [4.51, 1.68], [6.13, 1.71], [7.78, 1.72],
                      [1.84, 6.01], [3.51, 6.05], [5.16, 6.12], [6.84, 6.16], [8.51, 6.24]]
        .map(([x, y]) => ({ x: +Math.max(0.02, x - 0.5).toFixed(2), y: +Math.max(0.02, y - 0.5).toFixed(2) })) },   // clamped inside the room: coil 0 sits on the west edge
      doors: [{ side: 'N', at: 5, width: 1 }],   // painted gap one tile east of CONFIG's
    },
    reactor: {     // the core in its pit (3x3), the console north of it; Quartz works the console from its east side
      seats: { quartz: { x: 5, y: 1, face: 'west' } },
      desks: { quartz: { x: 4, y: 1 } },
      spots: { core: { x: 4, y: 3 } },
      doors: [{ side: 'W', at: 4, width: 1 }, { side: 'N', at: 4, width: 1 }],
    },
    pad: {         // the shuttle on its ring, ramp to the east, crane and cable reel in the east corner
      fx: { shuttle: { x: 4, y: 3 } },   // the ring centre (4.8, 4.0); an FX anchor, not a standing spot
    },
    dock: {},
  };
  /* ================= object-layer overrides (objects layer, OBJECTS): merged over ROOM_TABLE for a room drawn as shell + objects =========
     The shells carry no floor-standing furniture; OBJECTS supplies the sprites and footprints. These entries move what the heroes (OBJECTS.HEROES) and the footprints displace;
     same TILE-LOCAL coordinates and categories as ROOM_TABLE (a category given here replaces ROOM_TABLE's entries by name). */
  const OBJECT_TABLE = {
    // bridge: Cobalt works the console desk from its east end, facing west. The Bridge floor is open (the holotable is
    // skipped, OBJECTS.SKIP; the globe stands in the Watch); there is no holotable FX anchor here (anchorsFromObjects).
    bridge: { seats: { cobalt: { x: 6, y: 1, face: 'west' } }, desks: { cobalt: { x: 5, y: 1 } } },
    // observatory: the static telescope hero stands centred (4,3 3x3); the desk sprite stands at (7,1) 2x2 (OBJECTS.FIXES)
    // and Onyx sits south of it at (7,3) facing north, clear of the telescope's sprite and of the E door (y 3..4) and S door
    observatory: { seats: { onyx: { x: 7, y: 3, face: 'north' } }, desks: { onyx: { x: 7, y: 2 } },
                   spots: { leisure: [{ x: 2, y: 5 }, { x: 7, y: 5 }, { x: 9, y: 2 }] } },   // CONFIG leisure (8,2) is under the moved desk
    reactor: {     // the core (4x4 at 4,3) hides the north of the room: the console sprite moves to (2,5) (OBJECTS.FIXES)
      seats: { quartz: { x: 2, y: 6, face: 'north' } },   // and Quartz works it from the south, in view
      desks: { quartz: { x: 2, y: 5 } },
    },
    library: { spots: { leisure: [{ x: 2, y: 5 }, { x: 4, y: 6 }, { x: 8, y: 5 }] } },   // the sofa is 2x2: (1,5) is on it
  };
  const objectsOn = key => OBJECTS.has(key) && !!tiles[key];
  /* The override table for a room: ROOM_TABLE, with OBJECT_TABLE merged over it by category when the room is drawn as shell + objects. */
  function ovOf(key) {
    const a = ROOM_TABLE[key]; if (!objectsOn(key)) return a; if (!OBJECT_TABLE[key]) return anchorsFromObjects(key, a);
    const b = OBJECT_TABLE[key], out = Object.assign({}, a);
    for (const cat of ['seats', 'desks', 'spots']) if (b[cat]) out[cat] = Object.assign({}, (a || {})[cat], b[cat]);
    if (b.fx) { const fx = Object.assign({}, (a || {}).fx); for (const k in b.fx) fx[k] = b.fx[k]; out.fx = fx; }
    if (b.doors) out.doors = b.doors;
    return anchorsFromObjects(key, out);
  }
  /* FX anchors read from where the objects really are, so a light moves with its hero or object: the holotable glow =
     the globe hero's footprint in whatever room it stands, the reactor core glow = the core hero's footprint centre (FX adds
     0.5), the workshop fabricator sparks = the hydraulic press. Room-local, like the tables. */
  function anchorsFromObjects(key, ov) {
    if (!objectsOn(key)) return ov;
    const o = rects[key], out = Object.assign({}, ov), loc = p => ({ x: p.x - o.x, y: p.y - o.y, w: p.w, h: p.h });
    const hero = OBJECTS.heroAt(key);
    if (hero && hero.name === 'globe') out.fx = Object.assign({}, out.fx, { holotable: loc(hero.fp) });
    else if (out.fx && out.fx.holotable) { out.fx = Object.assign({}, out.fx); delete out.fx.holotable; }
    if (key === 'reactor' && hero) out.spots = Object.assign({}, out.spots, { core: { x: hero.centre.x - o.x - 0.5, y: hero.centre.y - o.y - 0.5 } });
    const press = key === 'workshop' && OBJECTS.footprints().find(p => p.room === key && p.name === 'hydraulic press');
    if (press) out.fx = Object.assign({}, out.fx, { fabricator: { x: press.x - o.x + (press.w - 1) / 2, y: press.y - o.y } });
    return out;
  }
  /* ====================================================================================================== */

  let stars = null, planet = null, planetImg = false, ok = false, applied = false;
  let covers = [];
  const tiles = {};          // roomKey -> { img, rect, A (world <- piece px, canvas order a..f), inv, fit, alpha }
  const rects = {};          // roomKey -> CONFIG rect
  const fitLog = [];         // per-piece fit rows (BACKDROP.fits)
  const seatLog = [];        // per-room seat/desk/blocked rows (BACKDROP.seats)
  const debugGrid = typeof location !== 'undefined' && /[?&]bdgrid=1/.test(location.search);

  function pixelScale() { return 1; }
  function tilesMode() { return Object.keys(tiles).length > 0; }
  function snap(wx, wy) { return { x: Math.round(wx), y: Math.round(wy) }; }

  /* ---- fitting: guide anchor, measured edges, pure translation when within tolerance ---- */
  /* North corner (piece px) of a w x h footprint on a cw x ch guide canvas. */
  function guideNorth(w, h, cw, ch) { return { x: (cw - (w + h) * 32) / 2 + h * 32, y: (ch - (w + h) * 16) / 2 + 20 }; }
  function fitLine(pts) {
    let keep = pts.slice(), m = 0, c = 0;
    for (let it = 0; it < 6 && keep.length >= 4; it++) {
      const n = keep.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y] of keep) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      m = (n * sxy - sx * sy) / (n * sxx - sx * sx); c = (sy - m * sx) / n;
      const res = keep.map(([x, y]) => Math.abs(y - (m * x + c))); const med = res.slice().sort((a, b) => a - b)[Math.floor(n / 2)];
      const lim = Math.max(1.5, med * 2); const next = keep.filter((p, i) => res[i] <= lim);
      if (next.length === keep.length) break; keep = next;
    }
    return { m, c };
  }
  /* RGBA of an image: the boot-time copy harden() kept (pxCache, cleared when preload ends), else a fresh read. */
  function pixels(im) { return pxCache.get(im) || readRGBA(im).data; }
  function readRGBA(im) {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height); c.width = c.height = 0; return id;   // the scratch canvas is released at once
  }
  /* Opaque mask, 1 bit per pixel (alpha >= 128): what the fitting / floor tests keep after boot instead of the RGBA
     (a 1600x1100 shell: 220 KB instead of 7 MB). */
  function bitsOf(d, W, H) {
    const bits = new Uint8Array((W * H + 7) >> 3);
    for (let i = 0, n = W * H; i < n; i++) if (d[i * 4 + 3] >= 128) bits[i >> 3] |= 1 << (i & 7);
    return { w: W, h: H, bits };
  }
  const opaqueAt = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && ((m.bits[(y * m.w + x) >> 3] >> ((y * m.w + x) & 7)) & 1) === 1;
  function alphaOf(im) { try { const d = pixels(im); return bitsOf(d, im.width, im.height); } catch (_) { return null; } }
  /* Outer floor corners (piece px) from the alpha mask: lines fitted to the lowest opaque pixel per column on the
     south-west and south-east sides; W / E at the leftmost / rightmost opaque columns, S where the lines cross. */
  function detectCorners(im, data) {
    const W = im.width, H = im.height;
    const low = new Int32Array(W).fill(-1); let xL = W, xR = -1;
    for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) if (data[(y * W + x) * 4 + 3] > 128) { low[x] = y; xL = Math.min(xL, x); xR = Math.max(xR, x); break; }
    if (xR < 0) return null;
    let xm = xL; for (let x = xL; x <= xR; x++) if (low[x] > low[xm]) xm = x;
    let xs0 = xm, xs1 = xm; while (xs0 > xL && low[xs0 - 1] >= low[xm] - 8) xs0--; while (xs1 < xR && low[xs1 + 1] >= low[xm] - 8) xs1++;
    const span = xR - xL, L = [], R = [];
    for (let x = Math.round(xL + 0.06 * span); x < xs0 - 0.04 * span; x++) if (low[x] >= 0) L.push([x, low[x]]);
    for (let x = Math.round(xs1 + 0.04 * span); x < xR - 0.06 * span; x++) if (low[x] >= 0) R.push([x, low[x]]);
    if (L.length < 10 || R.length < 10) return null;
    const l = fitLine(L), r = fitLine(R), sx = (r.c - l.c) / (l.m - r.m);
    return { l, r, W: { x: xL, y: l.m * xL + l.c }, S: { x: sx, y: l.m * sx + l.c }, E: { x: xR, y: r.m * xR + r.c } };
  }
  /* Fit a piece of w x h tiles whose north corner lands on world point N0. Returns {A, inv, fit}. */
  function fitFootprint(label, im, data, w, h, N0) {
    const gN = guideNorth(w, h, im.width, im.height);
    const P = (gx, gy) => ({ x: gN.x + (gx - gy) * 32, y: gN.y + (gx + gy) * 16 });
    const G = { W: P(0, h), S: P(w, h), E: P(w, 0) };
    const k = data ? detectCorners(im, data) : null;
    let mode = 'guide', info = 'pixels unreadable: guide placement';
    let A = { a: 1, b: 0, c: 0, d: 1, e: N0.sx - gN.x, f: N0.sy - gN.y };
    if (k) {
      const resid = Math.max(...['W', 'S', 'E'].map(q => Math.hypot(k[q].x - G[q].x, k[q].y - G[q].y)));
      const sl = k.l.m, sr = k.r.m, skew = sl + sr;
      const inTol = Math.abs(sl - 0.5) <= FIT_TOL.slope && Math.abs(sr + 0.5) <= FIT_TOL.slope && Math.abs(skew) <= FIT_TOL.skew && resid <= FIT_TOL.corner;
      info = 'slope L ' + sl.toFixed(3) + ' R ' + sr.toFixed(3) + ' skew ' + skew.toFixed(3) + ' corner miss ' + resid.toFixed(1) + ' px';
      fitLog.push({ piece: label, slopeL: +sl.toFixed(3), slopeR: +sr.toFixed(3), skew: +skew.toFixed(3), cornerMiss: +resid.toFixed(1), mode: inTol ? 'guide' : 'guide FLAGGED' });
      // out of tolerance: still drawn by translation on the guide (never sheared, so its grid stays parallel to the
      // station's) and FLAGGED for a repaint; the least-squares x/y scale of its detected corners is logged for reference
      if (!inTol) {
        mode = 'guide FLAGGED';
        const ls = (p, t) => { const n = p.length, mp = p.reduce((q, v) => q + v, 0) / n, mt = t.reduce((q, v) => q + v, 0) / n;
          let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (p[i] - mp) * (t[i] - mt); den += (p[i] - mp) ** 2; } return num / den; };
        const kx = ls(['W', 'S', 'E'].map(q => k[q].x), ['W', 'S', 'E'].map(q => G[q].x)), ky = ls(['W', 'S', 'E'].map(q => k[q].y), ['W', 'S', 'E'].map(q => G[q].y));
        info += ' | corner scale fit ' + kx.toFixed(3) + ' x ' + ky.toFixed(3);
        fitLog[fitLog.length - 1].scaleFit = [+kx.toFixed(3), +ky.toFixed(3)];
      }
    }
    console.log('backdrop: fit ' + label + ' ' + im.width + 'x' + im.height + ' ' + info + ' -> ' + mode + ' (translate ' + A.e + ',' + A.f + ')');
    const idet = A.a * A.d - A.b * A.c;
    const inv = { a: A.d / idet, b: -A.b / idet, c: -A.c / idet, d: A.a / idet };
    inv.e = -(inv.a * A.e + inv.c * A.f); inv.f = -(inv.b * A.e + inv.d * A.f);
    return { A, inv, mode };
  }
  function fitTile(key, im) {
    const o = rects[key]; let data = null;
    try { data = pixels(im); } catch (e) { console.warn('backdrop: cannot read the ' + key + ' tile pixels (file://?), using the guide placement'); }
    const N0 = ISO.toScreen(o.x, o.y);
    const f = fitFootprint('room ' + key, im, data, o.w, o.h, N0);
    return { key, img: im, rect: o, A: f.A, inv: f.inv, mode: f.mode, alpha: data ? bitsOf(data, im.width, im.height) : null };
  }
  function loadImage(src, essential) {   // LOADQ: capped, timed out, retried; an essential miss rejects (shown in the HUD)
    return LOADQ.image(src, { essential: !!essential }).then(im => im && harden(im));
  }
  /* Some PNG sheets carry alpha 128..254 on nearly every painted pixel, so a desk drawn over the floor lets the floor
     through and its crop rect reads as a pale patch. Harden alpha at load: >= 128 becomes 255, < 128 becomes 0.
     The result is an IMAGE, never a long-lived canvas. A mobile browser may drop a canvas's backing store while the tab
     is in the background (it then draws as transparent), but an Image can always be decoded again. A file whose alpha is
     already binary (every room shell) is returned as it came, with no copy at all; one with partial alpha (object sheets,
     hall and hull pieces, heroes, planet) is hardened once in a scratch canvas, encoded (toBlob, lossless PNG) and
     decoded back into an Image, and the canvas is released. Where toBlob is unavailable the hardened canvas is kept, its
     source Image retained, and rebuild() re-hardens it (fragile list). Resolves the image to draw. */
  const pxCache = new Map();   // drawn image -> its hardened RGBA, for the boot-time fitting only (cleared when preload ends)
  const fragile = [];          // [{canvas, src}] hardened canvases that could not become Images (rebuild() redraws them from src)
  function hardenData(d) {
    let partial = false;
    for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a !== 0 && a !== 255) { partial = true; d[i] = a >= 128 ? 255 : 0; } }
    return partial;
  }
  function canvasToImage(c) {
    return new Promise((res, rej) => {
      if (!c.toBlob || typeof URL === 'undefined' || !URL.createObjectURL) { rej(new Error('no toBlob')); return; }
      c.toBlob(b => {
        if (!b) { rej(new Error('toBlob failed')); return; }
        const url = URL.createObjectURL(b), im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); res(im); };
        im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('re-decode failed')); };
        im.src = url;
      }, 'image/png');
    });
  }
  function harden(im) {
    if (!im) return Promise.resolve(im);
    let id; try { id = readRGBA(im); } catch (e) { return Promise.resolve(im); }   // file://: pixels unreadable, drawn as is
    if (!hardenData(id.data)) { pxCache.set(im, id.data); return Promise.resolve(im); }   // binary alpha already: the Image itself
    const c = document.createElement('canvas'); c.width = id.width; c.height = id.height; c.getContext('2d').putImageData(id, 0, 0);
    return canvasToImage(c).then(out => { c.width = c.height = 0; pxCache.set(out, id.data); return out; },
      e => { console.warn('backdrop: alpha kept in a canvas (' + e.message + '); rebuild() re-hardens it'); fragile.push({ canvas: c, src: im }); pxCache.set(c, id.data);
        let i = 3; while (i < id.data.length && id.data[i] !== 255) i += 4;
        if (i < id.data.length) { const p = (i - 3) / 4; setProbe('hardened ' + fragile.length, c, [[p % id.width, Math.floor(p / id.width)]]); }
        return c; });
  }
  function reharden(f) {
    const id = readRGBA(f.src); hardenData(id.data);
    f.canvas.width = id.width; f.canvas.height = id.height; f.canvas.getContext('2d').putImageData(id, 0, 0);
  }

  /* ---- overrides: seats, spots, FX anchors, doors (CONFIG rects stay as they are) ---- */
  const absPt = (p, o) => ({ x: o.x + p.x, y: o.y + p.y });
  function absDeep(v, o) {
    if (Array.isArray(v)) return v.map(q => absDeep(q, o));
    if (v && typeof v.x === 'number' && typeof v.y === 'number') return Object.assign({}, v, absPt(v, o));
    if (v && typeof v === 'object') { const out = {}; for (const k in v) out[k] = absDeep(v[k], o); return out; }
    return v;
  }
  function applyOverrides() {
    if (applied) return; applied = true;
    const lists = [CONFIG.ROOMS]; if (typeof WORLD !== 'undefined' && WORLD.rooms) lists.push(WORLD.rooms);
    for (const list of lists) for (const r of list) {
      const o = rects[r.key], ov = ovOf(r.key); if (!o || !ov || !tiles[r.key]) continue;
      for (const k in (r.seats || {})) if (ov.seats && ov.seats[k]) Object.assign(r.seats[k], absDeep(ov.seats[k], o));
      if (ov.spots) { Object.assign(r.spots || (r.spots = {}), absDeep(ov.spots, o)); }
      for (const k in (ov.fx || {})) Object.defineProperty(r.spots || (r.spots = {}), k, { value: absDeep(ov.fx[k], o), enumerable: false, configurable: true });
    }
    // doors: CONFIG.DOORS, except a side listed in ROOM_TABLE takes that room's painted doors instead
    let doors = CONFIG.DOORS.slice();
    for (const key in ROOM_TABLE) {
      const ov = ovOf(key); if (!tiles[key] || !ov.doors) continue;
      const sides = new Set(ov.doors.map(d => d.side));
      doors = doors.filter(d => !(d.room === key && sides.has(d.side))).concat(ov.doors.map(d => Object.assign({ room: key, width: 2 }, d)));
    }
    CONFIG.DOORS.splice(0, CONFIG.DOORS.length, ...doors);
    // Floors: seats / spots off floor polygons move to the nearest free inside tile (desk seats move with their
    // shifted desk); then the FX desk-glow seats are re-read
    if (typeof FLOORS !== 'undefined' && (FLOORS.enabled || FLOORS.placementsOn)) {   // Floors / placements
      try { FLOORS.fitSpots({ free: (x, y) => !footprintAt(x, y), deskTileOf, rooms: Object.keys(tiles) }); propCache = null; } catch (e) { console.warn('backdrop: floors spot fit failed', e); }
    }
  }

  /* ---- blocked tiles: the object footprints (OBJECTS). block: false (lowprofile) is walkable; open: 'x,y' tiles inside a
     footprint that stay walkable. ---- */
  let propCache = null;
  function propList() {
    if (propCache) return propCache;
    const out = [];
    for (const key in tiles) {
      for (const p of OBJECTS.footprints()) if (p.room === key) out.push(p);
    }
    return (propCache = out);
  }
  const blocksTile = (p, x, y) => p.keep ? p.keep.includes(x + ',' + y) : p.block !== false && !(p.open && p.open.includes(x + ',' + y));   // keep-out tiles (placements) replace the footprint
  function footprintAt(x, y) { return propList().find(p => p.keep ? p.keep.includes(x + ',' + y) : (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h && blocksTile(p, x, y))) || null; }
  /* Is the tile's diamond painted floor in the room PNG (opaque at its centre and four inner points)? */
  function paintedFloor(key, x, y) {
    const t = tiles[key]; if (!t || !t.alpha) return true;
    for (const [u, v] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const s = ISO.toScreen(x + u, y + v), px = Math.round(t.inv.a * s.sx + t.inv.c * s.sy + t.inv.e), py = Math.round(t.inv.b * s.sx + t.inv.d * s.sy + t.inv.f);
      if (!opaqueAt(t.alpha, px, py)) return false;
    }
    return true;
  }
  function applyBlocks() {
    for (let y = 0; y < WORLD.H; y++) for (let x = 0; x < WORLD.W; x++) WORLD.unblock(x, y);
    let n = 0;
    for (const p of propList()) {
      if (p.keep) { for (const k of p.keep) { const [x, y] = k.split(',').map(Number); WORLD.block(x, y); n++; } continue; }   // keep-out tiles only
      for (let x = p.x; x < p.x + p.w; x++) for (let y = p.y; y < p.y + p.h; y++) if (blocksTile(p, x, y)) { WORLD.block(x, y); n++; }
    }
    // check every seat / standing spot: inside its room, painted floor, not under a footprint; reject (move) a bad seat
    const doorSet = new Set(); for (const d of WORLD.doorTiles()) { doorSet.add(d.x + ',' + d.y); doorSet.add(d.ox + ',' + d.oy); }
    seatLog.length = 0;
    for (const r of CONFIG.ROOMS) {
      if (r.kind === 'corridor' || !tiles[r.key]) continue;
      const inRoom = t => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
      const free = t => inRoom(t) && !footprintAt(t.x, t.y) && paintedFloor(r.key, t.x, t.y);
      const row = { room: r.key, seats: [], spots: [], blocked: propList().filter(p => p.room === r.key).map(p => p.name + ' ' + (p.x - r.x) + ',' + (p.y - r.y) + (p.w * p.h > 1 ? ' ' + p.w + 'x' + p.h : '')), rejects: [] };
      for (const k in (r.seats || {})) {
        const s = r.seats[k];
        if (!free(s)) {   // reject: nearest free tile south of it
          const was = s.x + ',' + s.y; let ny = s.y; while (ny < r.y + r.h - 1 && !free({ x: s.x, y: ny })) ny++;
          s.y = ny; row.rejects.push(k + ' seat ' + was + ' not free floor -> ' + s.x + ',' + s.y);
        }
        const d = deskTileOf(k), fp = d && footprintAt(d.x, d.y), couch = d && d.x === s.x && d.y === s.y;
        row.seats.push(k + ' seat ' + (s.x - r.x) + ',' + (s.y - r.y) + ' desk ' + (d.x - r.x) + ',' + (d.y - r.y) + ' ' + (couch ? '(couch)' : fp && fp.desk ? '(' + fp.name + ' ok)' : 'NO DESK'));
        if (!couch && !(fp && fp.desk)) row.rejects.push(k + ' desk tile holds no desk');
      }
      const sp = r.spots || {};
      for (const name of Object.keys(sp)) {
        if (name === 'core' || name === 'shuttle') continue;
        const list = Array.isArray(sp[name]) ? sp[name] : [sp[name]];
        list.forEach((t, i) => { const q = { x: Math.floor(t.x), y: Math.floor(t.y) }; const okq = free(q);
          row.spots.push(name + (list.length > 1 ? i : '') + ' ' + (q.x - r.x) + ',' + (q.y - r.y) + (okq ? '' : ' BLOCKED'));
          if (!okq) row.rejects.push(name + i + ' at ' + q.x + ',' + q.y + ' is not free floor'); });
      }
      for (const k in r.seats || {}) if (doorSet.has(r.seats[k].x + ',' + r.seats[k].y)) row.rejects.push(k + ' seat on a door tile');
      seatLog.push(row);
    }
    console.log('backdrop: blocked ' + n + ' tiles under object footprints');
    for (const row of seatLog) console.log('backdrop: room ' + row.room + ' | ' + (row.seats.join('; ') || 'no seats') + ' | spots ' + (row.spots.join(' ') || '-') + ' | blocked ' + row.blocked.join(', ')
      + (row.rejects.length ? ' | REJECT ' + row.rejects.join('; ') : ''));
    if (typeof OBJECTS !== 'undefined') OBJECTS.verify();   // console.warn for any seat, pad, stand spot or door tile under an object
  }
  /* Our blocks go in after PROPS.init() and before WORLD.finalize() builds the nav grid; after it, every seat and
     spot must be reachable from the room's first door. */
  function hookWorld() {
    if (typeof WORLD === 'undefined' || WORLD.__backdropHooked) return;
    const fin = WORLD.finalize;
    WORLD.finalize = function () {
      if (active()) { try { applyBlocks(); } catch (e) { console.warn('backdrop: blocks failed', e); } }
      if (active() && typeof FLOORS !== 'undefined') { try { FLOORS.applyBlocks(); FLOORS.checkDesks(deskTileOf); } catch (e) { console.warn('backdrop: floor blocks failed', e); } }   // Floors: room tiles off the painted floor, after the unblock-all sweep
      const out = fin.apply(this, arguments);
      if (active()) { try { checkReach(); } catch (e) { console.warn('backdrop: reach check failed', e); } }
      if (active() && typeof FLOORS !== 'undefined') { try { FLOORS.auditBases(); } catch (e) { console.warn('backdrop: base audit failed', e); } }   // after the nav grid exists
      return out;
    };
    WORLD.__backdropHooked = true;
  }
  function checkReach() {
    const bad = [];
    for (const r of CONFIG.ROOMS) {
      if (r.kind === 'corridor' || !tiles[r.key]) continue;
      const door = WORLD.doorsOf(r.key)[0]; if (!door) continue;
      const from = { x: door.ox + 0.5, y: door.oy + 0.5 };
      const targets = [];
      for (const k in (r.seats || {})) targets.push([k, r.seats[k]]);
      for (const name of ['pads', 'stand', 'inbox', 'meet', 'leisure', 'bunks']) { const v = r.spots && r.spots[name]; if (!v) continue; (Array.isArray(v) ? v : [v]).forEach((t, i) => targets.push([name + i, name === 'pads' ? { x: t.x + 0.5, y: t.y + 0.5 } : t])); }
      for (const [n, t] of targets) if (!WORLD.path(from, { x: Math.floor(t.x) + 0.5, y: Math.floor(t.y) + 0.5 })) bad.push(r.key + ':' + n);
    }
    console.log('backdrop: reach check ' + (bad.length ? 'UNREACHABLE ' + bad.join(' ') : 'every seat and spot reachable from its room\'s door'));
  }

  /* ---- corridor pieces: straight halls, crossings and sealed ends, laid along the corridor rects into one layer ---- */
  const CORR_PIECES = { x: { file: 'corridor-x.png', w: 6, h: 3 }, y: { file: 'corridor-y.png', w: 3, h: 6 }, cross: { file: 'corridor-cross.png', w: 3, h: 3 },
    'end-n': { file: 'corridor-end-n.png', w: 3, h: 3 }, 'end-s': { file: 'corridor-end-s.png', w: 3, h: 3 },
    'end-e': { file: 'corridor-end-e.png', w: 3, h: 3 }, 'end-w': { file: 'corridor-end-w.png', w: 3, h: 3 } };
  const CORR_END_UP = 200;      // an end piece keeps this much (world px) above its north / west edges (the bulkhead wall)
  const CORR_STEP = 5;          // a 6-tile piece every 5 tiles: consecutive pieces overlap by one tile, blended by a 1-tile ramp
  const CORR_RAIL_H = 44;       // the layer keeps this much (world px) above the north / west edges for the rails and posts
  const CORR_UNDER = 0.5;       // a run's floor reaches this far (tiles) under a crossing (drawn on top)
  const CORR_JOIN = 0.6;        // a hall that runs into a room tile reaches this far (tiles) over its edge
  const corr = { pieces: {}, layer: null, plan: null };
  function fitPiece(name, im) {
    const P = CORR_PIECES[name]; let data = null;
    try { data = pixels(im); } catch (e) { console.warn('backdrop: cannot read corridor ' + name + ' pixels'); }
    const f = fitFootprint('hall ' + name, im, data, P.w, P.h, { sx: 0, sy: 0 });
    return { name, img: im, A: f.A, w: P.w, h: P.h };
  }
  function corridorPlan() {
    const rs = CONFIG.ROOMS.filter(r => r.kind === 'corridor').map(r => Object.assign({ key: r.key }, rects[r.key] || r));
    const vert = rs.filter(r => r.h > r.w), horiz = rs.filter(r => r.w >= r.h);
    const crosses = [];
    for (const v of vert) for (const h of horiz)
      if (v.x >= h.x && v.x + v.w <= h.x + h.w && h.y >= v.y && h.y + h.h <= v.y + v.h) crosses.push({ x: v.x, y: h.y, w: v.w, h: h.h });
    const runs = [];
    for (const r of rs) {
      const dir = r.h > r.w ? 'y' : 'x', lo = dir === 'x' ? r.x : r.y, hi = lo + (dir === 'x' ? r.w : r.h);
      const cuts = crosses.filter(c => dir === 'x' ? (c.y === r.y) : (c.x === r.x)).map(c => dir === 'x' ? [c.x, c.x + c.w] : [c.y, c.y + c.h]).sort((p, q) => p[0] - q[0]);
      let s = lo;
      for (const [c0, c1] of cuts.concat([[hi, hi]])) {
        if (c0 > s) {
          const run = dir === 'x' ? { key: r.key, dir, x: s, y: r.y, w: c0 - s, h: r.h } : { key: r.key, dir, x: r.x, y: s, w: r.w, h: c0 - s };
          run.endLo = s === lo && !beyond(r, dir, lo - 1);
          run.endHi = c0 === hi && !beyond(r, dir, hi);
          run.joinLo = s === lo && !run.endLo; run.joinHi = c0 === hi && !run.endHi;
          runs.push(run);
        }
        s = Math.max(s, c1);
      }
    }
    return { rects: rs, crosses, runs };
  }
  function floorAt(x, y) { return Object.values(rects).some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h); }
  function beyond(r, dir, v) {
    if (dir === 'x') { for (let y = r.y; y < r.y + r.h; y++) if (floorAt(v, y)) return true; return false; }
    for (let x = r.x; x < r.x + r.w; x++) if (floorAt(x, v)) return true; return false;
  }
  function rectRegion(g, r, up) {
    const N = ISO.toScreen(r.x, r.y), E = ISO.toScreen(r.x + r.w, r.y), S = ISO.toScreen(r.x + r.w, r.y + r.h), W = ISO.toScreen(r.x, r.y + r.h);
    g.moveTo(W.sx, W.sy); g.lineTo(S.sx, S.sy); g.lineTo(E.sx, E.sy); g.lineTo(E.sx, E.sy - up); g.lineTo(N.sx, N.sy - up); g.lineTo(W.sx, W.sy - up); g.closePath();
  }
  /* Layer-pixel rect (padded, clamped) of world points / of rectRegion()s with their wall band 'up'. */
  function boxOf(pts, x0, y0, cw, ch) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    a = Math.max(0, Math.floor(a - x0) - 2); b = Math.max(0, Math.floor(b - y0) - 2); c = Math.min(cw, Math.ceil(c - x0) + 2); d = Math.min(ch, Math.ceil(d - y0) + 2);
    return c > a && d > b ? { x: a, y: b, w: c - a, h: d - b } : null;
  }
  function clipBox(regions, up, x0, y0, cw, ch) {
    const pts = [];
    for (const r of regions) for (const [gx, gy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) { const p = ISO.toScreen(gx, gy); pts.push([p.sx, p.sy], [p.sx, p.sy - up]); }
    return boxOf(pts, x0, y0, cw, ch);
  }
  function buildCorridorLayer() {
    const plan = corr.plan = corridorPlan();
    if (!plan.rects.length || !(corr.pieces.x || corr.pieces.y)) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of plan.rects) for (const [gx, gy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
      const p = ISO.toScreen(gx, gy); x0 = Math.min(x0, p.sx); x1 = Math.max(x1, p.sx); y0 = Math.min(y0, p.sy - Math.max(CORR_RAIL_H, CORR_END_UP)); y1 = Math.max(y1, p.sy);
    }
    x0 = Math.floor(x0) - 40; y0 = Math.floor(y0) - 4; x1 = Math.ceil(x1) + 40; y1 = Math.ceil(y1) + 24;
    const cw = x1 - x0, ch = y1 - y0;
    const layer = document.createElement('canvas'); layer.width = cw; layer.height = ch; const lg = layer.getContext('2d');
    const sc = document.createElement('canvas'); sc.width = cw; sc.height = ch; const g = sc.getContext('2d');
    const toLayer = c => c.setTransform(1, 0, 0, 1, -x0, -y0);
    let n = 0;
    const put = (piece, gx, gy, region, dir, ramp, rampDown, up) => {
      // the piece can only land inside its clip region: clear and copy just that rect of the scratch canvas (the whole
      // layer per piece made a rebuild cost ~250 ms; same pixels)
      const bx = clipBox([region, region.under].filter(Boolean), up || CORR_RAIL_H, x0, y0, cw, ch); if (!bx) return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(bx.x, bx.y, bx.w, bx.h);
      toLayer(g); g.save(); g.beginPath(); rectRegion(g, region, up || CORR_RAIL_H); if (region.under) rectRegion(g, region.under, 0); g.clip();
      const A = piece.A, ox = (gx - gy) * CONFIG.TILE_W / 2, oy = (gx + gy) * CONFIG.TILE_H / 2;
      g.imageSmoothingEnabled = false; g.transform(A.a, A.b, A.c, A.d, A.e + ox, A.f + oy); g.drawImage(piece.img, 0, 0); g.restore();
      if (ramp != null) {
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(bx.x, bx.y, bx.w, bx.h); g.clip(); toLayer(g);   // the fade touches the rect only
        g.globalCompositeOperation = 'destination-in'; g.transform(CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, -CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, 0, 0);
        const grad = dir === 'x' ? g.createLinearGradient(ramp, 0, ramp + 1, 0) : g.createLinearGradient(0, ramp, 0, ramp + 1);
        grad.addColorStop(0, rampDown ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0)'); grad.addColorStop(1, rampDown ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
        g.fillStyle = grad; g.fillRect(-200, -200, 400, 400); g.restore();
      }
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(sc, bx.x, bx.y, bx.w, bx.h, bx.x, bx.y, bx.w, bx.h); n++;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(bx.x, bx.y, bx.w, bx.h);   // the scratch stays empty outside the next rect
    };
    const joins = [];
    for (const pass of ['y', 'x']) for (const run of plan.runs.filter(r => r.dir === pass)) {
      const piece = corr.pieces[pass]; if (!piece) continue;
      const lo = pass === 'x' ? run.x : run.y, hi = lo + (pass === 'x' ? run.w : run.h), L = pass === 'x' ? piece.w : piece.h;
      const atX = v => plan.crosses.some(c => pass === 'x' ? (c.y === run.y && (c.x === v || c.x + c.w === v)) : (c.x === run.x && (c.y === v || c.y + c.h === v)));
      const jLo = run.joinLo && !atX(lo) ? CORR_JOIN : 0, jHi = run.joinHi && !atX(hi) ? CORR_JOIN : 0;
      const u0 = atX(lo) ? CORR_UNDER : jLo, u1 = atX(hi) ? CORR_UNDER : jHi;
      const eLo = run.endLo ? corr.pieces[pass === 'x' ? 'end-w' : 'end-n'] : null, eHi = run.endHi ? corr.pieces[pass === 'x' ? 'end-e' : 'end-s'] : null;
      const a = eLo ? lo + eLo[pass === 'x' ? 'w' : 'h'] - 1 : lo - u0, b = eHi ? hi - eHi[pass === 'x' ? 'w' : 'h'] + 1 : hi + u1;
      const sub = (p0, p1) => pass === 'x' ? { x: p0, y: run.y, w: p1 - p0, h: run.h } : { x: run.x, y: p0, w: run.w, h: p1 - p0 };
      const region = Object.assign(sub(Math.max(lo - jLo, a), Math.min(hi + jHi, b)), { under: sub(a, b) });
      if (jLo) joins.push(sub(lo - jLo, lo)); if (jHi) joins.push(sub(hi, hi + jHi));
      for (let s = a; ; s += CORR_STEP) {
        put(piece, pass === 'x' ? s : run.x, pass === 'x' ? run.y : s, region, pass, s > a ? s : null);
        if (s + L >= b) break;
      }
      const end = (pcv, p0, ramp, down) => { const r = sub(p0, p0 + (pass === 'x' ? pcv.w : pcv.h)); put(pcv, r.x, r.y, r, pass, ramp, down, CORR_END_UP); };
      if (eLo) end(eLo, lo, a, true);
      if (eHi) end(eHi, b - 1, b - 1, false);
    }
    if (corr.pieces.cross) for (const c of plan.crosses) put(corr.pieces.cross, c.x, c.y, c, null, null);
    // the room tiles stay on top of the hall art, except where a hall runs into a room tile (corr_h1 -> dock)
    let pre = null; if (joins.length) { pre = document.createElement('canvas'); pre.width = cw; pre.height = ch; pre.getContext('2d').drawImage(layer, 0, 0); }
    lg.save(); lg.globalCompositeOperation = 'destination-out'; toLayer(lg);
    for (const key in tiles) { const A = tiles[key].A; lg.save(); lg.transform(A.a, A.b, A.c, A.d, A.e, A.f); lg.drawImage(tiles[key].img, 0, 0); lg.restore(); }
    lg.restore();
    for (const j of joins) { lg.save(); toLayer(lg); lg.beginPath(); rectRegion(lg, j, CORR_RAIL_H); lg.clip(); lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(pre, 0, 0); lg.restore(); }
    sc.width = sc.height = 0; if (pre) pre.width = pre.height = 0;   // scratch canvases: released now, not at the next GC
    retire(corr.layer); corr.layer = { canvas: layer, x: x0, y: y0, w: cw, h: ch };
    setProbe('hall layer', layer, plan.runs.flatMap(r => { const out = []; for (let i = 0; i < r.w; i++) for (let j = 0; j < r.h; j++) { const p = ISO.toScreen(r.x + i + 0.5, r.y + j + 0.5); out.push([p.sx - x0, p.sy - y0]); } return out; }));
    console.log('backdrop: corridor layer ' + cw + 'x' + ch + ', ' + n + ' pieces (' + plan.runs.length + ' runs, ' + plan.crosses.length + ' crossings)');
  }

  /* ---- hull: the exterior face hanging below the station's outer floor outline. Skirts (48 px faces at exact
     0.5 slope) are placed by translation; the corner pieces (older art, flatter and shorter) are stretched to a 48 px
     face whose top edge runs at 0.5. Drawn BEFORE the floors, with the floor parallelograms cut out. ---- */
  const HULL_PIECES = { se: 'hull-skirt-se.png', sw: 'hull-skirt-sw.png', s: 'hull-corner-s.png', e: 'hull-corner-e.png', w: 'hull-corner-w.png', n: 'hull-corner-n.png' };
  // the skirt pieces are 193 px wide and their last column repeats their first (measured: a 192 px
  // shift matches pixel for pixel), so they tile butt to butt every 6 tiles with no blend
  const HULL_LEN = 6, HULL_STEP = 6, HULL_FACE = 48;
  const HULL_DROP = 90, HULL_UP = 140;
  const HULL_PLATE = '#121215';
  const hull = { pieces: {}, layer: null, outline: null };
  const HULL_ESSENTIAL = ['se', 'sw'];   // the skirts; the corner caps are optional
  function alphaProfile(im) {
    const W = im.width, H = im.height, data = pixels(im);
    const top = new Int32Array(W).fill(-1), low = new Int32Array(W).fill(-1), cnt = new Int32Array(W); let x0 = W, x1 = -1;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] > 128) { if (top[x] < 0) top[x] = y; low[x] = y; cnt[x]++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    return { W, H, top, low, cnt, x0, x1 };
  }
  const colsOf = (prof, f0, f1, key) => { const out = []; const s = prof.x1 - prof.x0;
    for (let x = Math.round(prof.x0 + f0 * s); x <= Math.round(prof.x0 + f1 * s); x++) if (prof[key][x] >= 0) out.push([x, prof[key][x]]); return out; };
  const median = a => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  function measureHull(name, im) {
    const p = alphaProfile(im); if (p.x1 < 0) return null;
    let A, info;
    if (name === 'se' || name === 'sw') {   // skirt: top edge at exactly +-0.5, 48 px face; anchor the run-start end
      const l = fitLine(colsOf(p, 0.05, 0.95, 'top')), xa = name === 'se' ? p.x0 : p.x1, ya = l.m * xa + l.c;
      const face = median(colsOf(p, 0.1, 0.9, 'cnt').map(q => q[1]));
      A = { a: 1, b: 0, c: 0, d: 1, e: -xa, f: -Math.round(ya) };
      info = 'top slope ' + l.m.toFixed(3) + ' face ' + face + ' px, translate (no stretch)';
      fitLog.push({ piece: 'skirt ' + name, slopeL: +l.m.toFixed(3), slopeR: null, skew: 0, cornerMiss: 0, mode: 'guide', face });
    } else if (name === 's') {   // the cap under the south vertex: arms to 0.5, face to 48 px
      const l = fitLine(colsOf(p, 0.04, 0.36, 'top')), r = fitLine(colsOf(p, 0.64, 0.96, 'top'));
      const xs = (r.c - l.c) / (l.m - r.m), ys = l.m * xs + l.c, face = median(colsOf(p, 0.1, 0.9, 'cnt').map(q => q[1]));
      const ky = HULL_FACE / face, kx = Math.min(2.5, Math.max(0.8, 2 * ky * (Math.abs(l.m) + Math.abs(r.m)) / 2));
      A = { a: kx, b: 0, c: 0, d: ky, e: -kx * xs, f: -ky * ys }; info = 'vertex (' + xs.toFixed(1) + ',' + ys.toFixed(1) + ') face ' + face + ' kx ' + kx.toFixed(2) + ' ky ' + ky.toFixed(2);
    } else if (name === 'e' || name === 'w') {   // a wall stub with a post at the corner end: shear the top to +-0.5, stretch the face to 48
      const l = fitLine(colsOf(p, name === 'e' ? 0.2 : 0.45, name === 'e' ? 0.55 : 0.8, 'top')), xv = name === 'e' ? p.x1 + 1 : p.x0;
      const face = median(colsOf(p, name === 'e' ? 0.2 : 0.45, name === 'e' ? 0.55 : 0.8, 'cnt').map(q => q[1]));
      const ky = HULL_FACE / face, st = Math.sign(l.m || 1) * 0.5;
      // x' = x - xv, y' = ky (y - (m x + c)) + st (x - xv): the top line runs at st and passes 0 at the vertex column
      A = { a: 1, b: st - ky * l.m, c: 0, d: ky, e: -xv, f: -ky * l.c - st * xv };
      info = 'vertex col ' + xv + ' slope ' + l.m.toFixed(3) + ' -> ' + st + ', face ' + face + ' ky ' + ky.toFixed(2);
    } else {   // n: a mast; its base's lowest pixel stands on the north vertex
      let xm = p.x0; for (let x = p.x0; x <= p.x1; x++) if (p.low[x] > p.low[xm]) xm = x;
      A = { a: 1, b: 0, c: 0, d: 1, e: -xm, f: -(p.low[xm] + 1) }; info = 'base (' + xm + ',' + (p.low[xm] + 1) + ')';
    }
    console.log('backdrop: hull ' + name + ' ' + im.width + 'x' + im.height + ' ' + info);
    return { name, img: im, A };
  }
  function hullOutline() {
    const rs = Object.values(rects); if (!rs.length) return null;
    const W = Math.max(...rs.map(r => r.x + r.w)) + 1, H = Math.max(...rs.map(r => r.y + r.h)) + 1;
    const fill = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floorAt(x, y);
    const se = [], sw = [], corners = [];
    for (let y = 1; y <= H; y++) { let s = null; for (let x = 0; x <= W; x++) { const e = fill(x, y - 1) && !fill(x, y); if (e && s === null) s = x; if (!e && s !== null) { se.push({ y, x0: s, x1: x }); s = null; } } }
    for (let x = 1; x <= W; x++) { let s = null; for (let y = 0; y <= H; y++) { const e = fill(x - 1, y) && !fill(x, y); if (e && s === null) s = y; if (!e && s !== null) { sw.push({ x, y0: s, y1: y }); s = null; } } }
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
      const nw = fill(x - 1, y - 1), ne = fill(x, y - 1), swt = fill(x - 1, y), sel = fill(x, y);
      if (nw + ne + swt + sel !== 1) continue;
      corners.push({ x, y, kind: nw ? 's' : ne ? 'w' : swt ? 'e' : 'n' });
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of rs) for (const [gx, gy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) {
      const q = ISO.toScreen(gx, gy); x0 = Math.min(x0, q.sx); x1 = Math.max(x1, q.sx); y0 = Math.min(y0, q.sy); y1 = Math.max(y1, q.sy);
    }
    return { se, sw, corners, bbox: { x0, y0, x1, y1 } };
  }
  function buildHull() {
    const o = hull.outline = hullOutline(); if (!o || !(hull.pieces.se || hull.pieces.sw)) return;
    const x0 = Math.floor(o.bbox.x0) - 80, y0 = Math.floor(o.bbox.y0) - HULL_UP, x1 = Math.ceil(o.bbox.x1) + 80, y1 = Math.ceil(o.bbox.y1) + HULL_DROP;
    const cw = x1 - x0, ch = y1 - y0;
    const layer = document.createElement('canvas'); layer.width = cw; layer.height = ch; const lg = layer.getContext('2d');
    const sc = document.createElement('canvas'); sc.width = cw; sc.height = ch; const g = sc.getContext('2d');
    const S = (gx, gy) => ISO.toScreen(gx, gy);
    let n = 0;
    const put = (piece, P, a, b, rampA, rampB) => {
      const bx = boxOf([[a.sx, a.sy - 30], [b.sx, b.sy - 30], [b.sx, b.sy + HULL_DROP], [a.sx, a.sy + HULL_DROP]], x0, y0, cw, ch); if (!bx) return;   // as the halls: only the clip rect
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(bx.x, bx.y, bx.w, bx.h);
      g.setTransform(1, 0, 0, 1, -x0, -y0); g.save();
      g.beginPath(); g.moveTo(a.sx, a.sy - 30); g.lineTo(b.sx, b.sy - 30); g.lineTo(b.sx, b.sy + HULL_DROP); g.lineTo(a.sx, a.sy + HULL_DROP); g.closePath(); g.clip();
      const A = piece.A; g.imageSmoothingEnabled = false; g.transform(A.a, A.b, A.c, A.d, A.e + P.sx, A.f + P.sy); g.drawImage(piece.img, 0, 0); g.restore();
      if (rampA != null) {
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(bx.x, bx.y, bx.w, bx.h); g.clip(); g.setTransform(1, 0, 0, 1, -x0, -y0);
        g.globalCompositeOperation = 'destination-in';
        const grad = g.createLinearGradient(rampA, 0, rampB, 0); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
        g.fillStyle = grad; g.fillRect(x0, y0, cw, ch); g.restore();
      }
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(sc, bx.x, bx.y, bx.w, bx.h, bx.x, bx.y, bx.w, bx.h); n++;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(bx.x, bx.y, bx.w, bx.h);
    };
    if (hull.pieces.se) for (const e of o.se) for (let s = e.x0; ; s += HULL_STEP) {
      put(hull.pieces.se, S(s, e.y), S(e.x0, e.y), S(e.x1, e.y), null, null);   // butt joints, no ramp
      if (s + HULL_LEN >= e.x1) break;
    }
    if (hull.pieces.sw) for (const e of o.sw) for (let s = e.y0; ; s += HULL_STEP) {
      put(hull.pieces.sw, S(e.x, s), S(e.x, e.y1), S(e.x, e.y0), null, null);   // butt joints, no ramp
      if (s + HULL_LEN >= e.y1) break;
    }
    lg.setTransform(1, 0, 0, 1, -x0, -y0); lg.imageSmoothingEnabled = false;
    const corner = c => { const piece = hull.pieces[c.kind]; if (!piece) return; const P = S(c.x, c.y), A = piece.A;
      lg.save(); lg.transform(A.a, A.b, A.c, A.d, A.e + P.sx, A.f + P.sy); lg.drawImage(piece.img, 0, 0); lg.restore(); n++; };
    for (const c of o.corners) if (c.kind !== 's') corner(c);
    lg.globalCompositeOperation = 'source-over'; lg.fillStyle = HULL_PLATE;
    for (const r of Object.values(rects)) { const q = [S(r.x, r.y), S(r.x + r.w, r.y), S(r.x + r.w, r.y + r.h), S(r.x, r.y + r.h)];
      lg.beginPath(); q.forEach((p, i) => i ? lg.lineTo(p.sx, p.sy) : lg.moveTo(p.sx, p.sy)); lg.closePath(); lg.fill(); }
    for (const c of o.corners) if (c.kind === 's') corner(c);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    sc.width = sc.height = 0;
    retire(hull.layer); hull.layer = { canvas: layer, x: x0, y: y0, w: cw, h: ch };
    setProbe('hull layer', layer, Object.values(rects).map(r => { const p = ISO.toScreen(r.x + r.w / 2, r.y + r.h / 2); return [p.sx - x0, p.sy - y0]; }));   // the plate under every room
    console.log('backdrop: hull layer ' + cw + 'x' + ch + ', ' + n + ' pieces (' + o.se.length + ' SE runs, ' + o.sw.length + ' SW runs, ' + o.corners.length + ' corners)');
  }

  /* ---- space: a seeded star field tile and a planet ---- */
  function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function buildStars() {
    const S = 1024, c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d');
    g.fillStyle = CONFIG.PALETTE.space; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { const a = 0.25 + hash(i * 3) * 0.5; g.fillStyle = 'rgba(207,216,255,' + a.toFixed(2) + ')'; g.fillRect(Math.floor(hash(i) * S), Math.floor(hash(i + 7) * S), 1, 1); }
    for (let i = 0; i < 70; i++) { const x = Math.floor(hash(i + 900) * S), y = Math.floor(hash(i + 950) * S), warm = hash(i + 33) > 0.7; g.fillStyle = warm ? '#f5c27a' : '#dfe8ff'; g.fillRect(x, y, 2, 2); g.fillStyle = warm ? 'rgba(245,194,122,0.35)' : 'rgba(223,232,255,0.35)'; g.fillRect(x - 1, y, 4, 2); g.fillRect(x, y - 1, 2, 4); }
    return c;
  }
  function buildPlanet() {
    const R = 440, c = document.createElement('canvas'); c.width = c.height = R * 2 + 8; const g = c.getContext('2d'), cx = R + 4, cy = R + 4;
    const body = g.createRadialGradient(cx - R * 0.45, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#6aa3d8'); body.addColorStop(0.55, '#2a4a7a'); body.addColorStop(0.85, '#121f36'); body.addColorStop(1, '#070b14');
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    return c;
  }

  /* ---- covers: wall strips cut from a room tile's pixels, drawn in the figures' depth sort. ---- */
  const STRIP_UP = 260;   // world px: above the tallest painted wall post / lamp / dish (the bench corner lamp is ~130)
  function addWallStrip(t, tx, ty, side, room) {
    // the wall face above the N edge (tx,ty)->(tx+1,ty) or the W edge (tx,ty)->(tx,ty+1), up to STRIP_UP world px: the
    // whole painted wall, including corner posts, lamps and masts that rise past WALL_H (the strip only carries the
    // tile's own pixels, and above its N / W edges a room tile holds nothing but its walls)
    const a = ISO.toScreen(tx, ty), b = side === 'N' ? ISO.toScreen(tx + 1, ty) : ISO.toScreen(tx, ty + 1), H = STRIP_UP;
    const poly = [[a.sx, a.sy - H], [b.sx, b.sy - H], [b.sx, b.sy + 1], [a.sx, a.sy + 1]];
    const c = cutPoly(t, poly); if (!c) return;
    covers.push({ depth: ISO.depth(tx + 0.5, ty + 0.5, 0) - 0.4, label: room + ' wall ' + side + ' ' + tx + ',' + ty, tile: { x: tx, y: ty }, poly, wall: side, draw: c });
  }
  /* Cut the tile's pixels under a world-space polygon into a draw(ctx) that clips to it (the wall strips). */
  function cutPoly(t, poly) {
    const i = t.inv, A = t.A;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [wx, wy] of poly) { const qx = i.a * wx + i.c * wy + i.e, qy = i.b * wx + i.d * wy + i.f; x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy); }
    x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1); x1 = Math.min(t.img.width, Math.ceil(x1) + 1); y1 = Math.min(t.img.height, Math.ceil(y1) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
    const g = c.getContext('2d'); g.drawImage(t.img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    // bake the polygon into the cut's alpha once (no per-frame clip path)
    g.globalCompositeOperation = 'destination-in'; g.beginPath();
    poly.forEach(([wx, wy], k) => { const qx = i.a * wx + i.c * wy + i.e - x0, qy = i.b * wx + i.d * wy + i.f - y0; k ? g.lineTo(qx, qy) : g.moveTo(qx, qy); });
    g.closePath(); g.fill();
    const draw = ctx => {
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.transform(A.a, A.b, A.c, A.d, A.e, A.f); ctx.drawImage(c, x0, y0); ctx.restore();
    };
    draw.canvas = c; return draw;
  }
  function buildCovers() {
    covers = [];
    /* Tall-wall strips: one cover per wall tile of a room's N and W walls (the face above that tile's edge), with the
       wall tile's own depth. A figure in the hall behind the wall (x < room.x, or y < room.y) has a smaller depth than
       every strip its sprite overlaps, so the wall hides it; a figure inside the room always has a larger depth than
       the strips over it, so it is never hidden. Door tiles get a strip too: the open aperture is alpha 0 in the shell, so
       a strip only carries the door frame (posts, lintel), which must hide what stands behind it like any wall. */
    for (const r of CONFIG.ROOMS) {
      const rr = rects[r.key], t = tiles[r.key]; if (!rr || !t || r.kind === 'corridor' || r.kind === 'pad') continue;
      for (let j = 0; j < rr.h; j++) addWallStrip(t, rr.x, rr.y + j, 'W', r.key);
      for (let i = 0; i < rr.w; i++) addWallStrip(t, rr.x + i, rr.y, 'N', r.key);
    }
    console.log('backdrop: ' + covers.length + ' wall strips');
    const strip = covers.filter(c => c.wall && c.draw.canvas)[Math.floor(covers.length / 2)];   // one strip stands for all of them
    if (strip) { const c = strip.draw.canvas, pts = []; for (let j = 1; j < 16; j++) for (let i = 1; i < 8; i++) pts.push([c.width * i / 8, c.height * (16 - j) / 16]); setProbe('wall strips', c, pts); }
  }
  /* Depth-sorted extras for main.js: the wall strips, plus every object and hero strip (OBJECTS). */
  function coverDrawables() {
    if (!active()) return [];
    return typeof OBJECTS !== 'undefined' ? covers.concat(OBJECTS.drawables()) : covers;
  }
  /* The painted desk a member works at (absolute tile): ROOM_TABLE[room].desks[key] when given, else the tile north of the seat. */
  function deskTileOf(memberKey) {
    const fd = typeof FLOORS !== 'undefined' && FLOORS.deskOf(memberKey); if (fd) return { x: fd.x, y: fd.y };   // Floors: a desk moved onto the floor polygon
    for (const r of CONFIG.ROOMS) {
      const s = r.seats && r.seats[memberKey]; if (!s) continue;
      const ov = ovOf(r.key), o = rects[r.key];
      if (o && ov && ov.desks && ov.desks[memberKey]) return absPt(ov.desks[memberKey], o);
      return { x: s.x, y: s.y - 1 };
    }
    return null;
  }

  /* ---- bounds for the camera: the hull outline plus walls above and the skirt below, plus a margin ---- */
  function bounds() {
    if (!hull.outline) return null;
    const m = MARGIN_TILES * CONFIG.TILE_H, b = hull.outline.bbox;
    const minX = b.x0 - m, maxX = b.x1 + m, minY = b.y0 - 260 - m, maxY = b.y1 + HULL_DROP + m;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
  }

  /* Resolves even if optional pieces are missing; an essential miss rejects. */
  function preload(opts) {
    for (const r of CONFIG.ROOMS) rects[r.key] = { x: r.x, y: r.y, w: r.w, h: r.h };
    const roomKeys = CONFIG.ROOMS.filter(r => r.kind !== 'corridor').map(r => r.key);
    // a room with OBJECTS data draws its shell (assets/rooms/)
    const objJob = Promise.all([typeof OBJECTS !== 'undefined' ? OBJECTS.preload() : null, typeof FLOORS !== 'undefined' ? FLOORS.preload() : null]);   // Floors: polygons load with the objects
    const tileJobs = roomKeys.map(k => objJob.then(() => {
      return loadImage(TILE_URL + k + '.png', true).then(im => ({ k, im }));
    }));
    // every hall piece and both hull skirts are essential (a miss shows in the HUD instead of a station
    // with no halls); the four hull corner caps and the planet (procedural stand-in) stay optional
    const corrJobs = Object.keys(CORR_PIECES).map(k => loadImage(CORR_URL + CORR_PIECES[k].file, true).then(im => ({ k, im })));
    const hullJobs = Object.keys(HULL_PIECES).map(k => loadImage(CORR_URL + HULL_PIECES[k], HULL_ESSENTIAL.includes(k)).then(im => ({ k, im })));
    return Promise.all([Promise.all(tileJobs), Promise.all(corrJobs), Promise.all(hullJobs), loadImage(PLANET_URL)]).then(([loaded, corrLoaded, hullLoaded, planetIm]) => {
      for (const { k, im } of loaded) {
        if (!im) { console.warn('backdrop: room tile ' + k + ' missing'); continue; }
        try { tiles[k] = fitTile(k, im); } catch (e) { console.warn('backdrop: tile ' + k + ' failed', e); }
      }
      if (typeof OBJECTS !== 'undefined') { try { OBJECTS.place(tiles); } catch (e) { console.warn('backdrop: objects placement failed', e); } }
      if (typeof OBJECTS !== 'undefined' && typeof FLOORS !== 'undefined') { try { FLOORS.fitObjects(tiles, { seats: CONFIG.ROOMS.flatMap(r => Object.keys(r.seats || {}).map(k => { const o = rects[r.key], ov = ovOf(r.key); const q = ov && ov.seats && ov.seats[k] && o ? absPt(ov.seats[k], o) : r.seats[k]; return q.x + ',' + q.y; })) }); } catch (e) { console.warn('backdrop: floors object fit failed', e); } }   // Floors: objects onto the painted floor
      if (!tilesMode()) { pxCache.clear(); console.warn('backdrop: no room tiles'); return; }
      ok = true;
      for (const { k, im } of corrLoaded) if (im) { try { corr.pieces[k] = fitPiece(k, im); } catch (e) { console.warn('backdrop: corridor ' + k + ' failed', e); } }
      for (const { k, im } of hullLoaded) if (im) { try { const f = measureHull(k, im); if (f) hull.pieces[k] = f; } catch (e) { console.warn('backdrop: hull ' + k + ' failed', e); } }
      try { applyOverrides(); hookWorld(); stars = buildStars(); setProbe('stars', stars, [[0, 0]]); planet = planetIm || buildPlanet(); planetImg = !!planetIm; buildCovers(); }
      catch (e) { console.warn('backdrop: setup failed', e); }
      try { buildCorridorLayer(); } catch (e) { console.warn('backdrop: corridor layer failed', e); corr.layer = null; }
      try { buildHull(); } catch (e) { console.warn('backdrop: hull layer failed', e); hull.layer = null; }
      pxCache.clear();   // the boot-time RGBA copies: the fits are done, the bit masks stay
      console.log('backdrop: tiles mode (' + Object.keys(tiles).length + ' room tiles, ' + Object.keys(corr.pieces).length + ' hall pieces, ' + Object.keys(hull.pieces).length + ' hull pieces)');
    });
  }
  function active() { return ok; }
  /* PROPS drawables kept over the tiles: the ones that carry live state or text (inbox tray, room name labels). */

  function planetPlace() {
    const b = hull.outline ? hull.outline.bbox : { x0: -1500, x1: 1500, y0: 0 };
    const w = planet.width * (planetImg ? PLANET_SCALE : 1), h = planet.height * (planetImg ? PLANET_SCALE : 1);
    const cx = b.x0 + 0.2 * (b.x1 - b.x0), cy = b.y0 - 260;
    return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
  }

  /* Base layer: stars, the planet, the hull (behind the floors), every room tile, the hall layer. */
  function draw(ctx) {
    if (!active()) return;
    ctx.save();
    if (stars) { const pat = ctx.createPattern(stars, 'repeat'); ctx.fillStyle = pat; ctx.fillRect(-12000, -9000, 28000, 22000); }
    ctx.imageSmoothingEnabled = false;
    if (planet) { const p = planetPlace(); ctx.drawImage(planet, p.x, p.y, p.w, p.h); }
    if (hull.layer) { const L = hull.layer; ctx.drawImage(L.canvas, L.x, L.y, L.w, L.h); }
    // No bounding rects cut anything off. Halls go down first (they lie between and behind the rooms' tall
    // walls), then every room shell back to front by its own alpha only, so a hall end's bulkhead can never overdraw
    // a room's north corner and a front room covers the one behind it.
    if (corr.layer) { const L = corr.layer; ctx.drawImage(L.canvas, L.x, L.y, L.w, L.h); }
    const order = Object.keys(tiles).sort((a, b) => (tiles[a].rect.x + tiles[a].rect.y) - (tiles[b].rect.x + tiles[b].rect.y));
    for (const key of order) {
      const A = tiles[key].A;
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.transform(A.a, A.b, A.c, A.d, A.e, A.f); ctx.drawImage(tiles[key].img, 0, 0); ctx.restore();
    }
    if (debugGrid) drawGrid(ctx);
    ctx.restore();
  }
  /* ?bdgrid=1: tile outlines with coordinates, blocked red, doors yellow, seats green, desk tiles blue, wall runs white. */
  function drawGrid(ctx) {
    ctx.save(); ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
    for (let y = 0; y < CONFIG.GRID.h; y++) for (let x = 0; x < CONFIG.GRID.w; x++) {
      if (!floorAt(x, y)) continue;
      ISO.tilePath(ctx, x, y); ctx.stroke();
      if (typeof WORLD !== 'undefined' && WORLD.isBlocked && WORLD.isBlocked(x, y)) { ctx.fillStyle = 'rgba(255,60,60,0.35)'; ctx.fill(); }
      const c = ISO.tileCenter(x, y); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(x + ',' + y, c.sx, c.sy + 2);
    }
    if (typeof WORLD !== 'undefined' && WORLD.doorTiles) for (const d of WORLD.doorTiles()) for (const [x, y] of [[d.x, d.y], [d.ox, d.oy]]) { ISO.tilePath(ctx, x, y); ctx.fillStyle = 'rgba(255,220,60,0.45)'; ctx.fill(); }
    for (const r of CONFIG.ROOMS) for (const k in (r.seats || {})) {
      const s = r.seats[k], d = deskTileOf(k);
      ISO.tilePath(ctx, s.x, s.y); ctx.fillStyle = 'rgba(60,255,120,0.5)'; ctx.fill();
      if (d && (d.x !== s.x || d.y !== s.y)) { ISO.tilePath(ctx, d.x, d.y); ctx.fillStyle = 'rgba(60,140,255,0.45)'; ctx.fill(); }
    }
    if (typeof WORLD !== 'undefined' && WORLD.wallSegments) {
      ctx.lineWidth = 2;
      for (const sg of WORLD.wallSegments()) { if (sg.kind === 'corridor') continue; const a = ISO.toScreen(sg.x0, sg.y0), b = ISO.toScreen(sg.x1, sg.y1); ctx.strokeStyle = sg.tall ? 'rgba(255,255,255,0.9)' : 'rgba(255,160,255,0.8)'; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
    }
    if (typeof FLOORS !== 'undefined') FLOORS.debugDraw(ctx);   // Floors: polygon outlines (yellow) and the tiles they block
    ctx.restore();
  }
  /* Light: at night a 0.5 darkness over the whole station, except that every lit room (opts.litRooms: someone working
     or active within the hour) is at day brightness; each of its doors gets a soft 1-tile feather so the hall just
     outside is half-lit. A lit room also gets one warm pool on its desk floor (the painted lamps are the other sources).
     The Charging bay is lit by its pads only (FX).
     The darkness is built per room in the base layer's draw order from each room's OWN pixels (its tile plus its
     object sprites): a lit room's pixels are cut out of it, and an unlit room drawn later whose pixels overlap a lit
     one's is reset to full darkness over its own pixels. So a lit room never brightens the floor of an unlit room its
     walls overlap on screen, and light never crosses into another unlit room. */
  const LIT_UP = WALL_H + 12;     // world px above the N / W edges: the wall band a hero's halo may light
  const DARK = 'rgba(4,6,14,0.5)';
  let darkCv = null;
  const masks = {};               // roomKey -> { pieces: [{img, sx, sy, w, h, dx, dy}], rect, dark (lazy canvas) }
  function maskOf(key) {
    if (masks[key]) return masks[key];
    const t = tiles[key], ob = opaqueBox(t);   // the tile cropped to its opaque pixels: smaller draws, tighter overlap tests
    const pieces = [{ img: t.img, sx: ob.x, sy: ob.y, w: ob.w, h: ob.h, dx: Math.round(t.A.e) + ob.x, dy: Math.round(t.A.f) + ob.y }];
    if (objectsOn(key)) for (const it of OBJECTS.items) if (it.room === key) pieces.push({ img: it.img, sx: it.cx, sy: it.cy, w: it.cw, h: it.ch, dx: it.dx, dy: it.dy });
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pieces) { x0 = Math.min(x0, p.dx); y0 = Math.min(y0, p.dy); x1 = Math.max(x1, p.dx + p.w); y1 = Math.max(y1, p.dy + p.h); }
    return (masks[key] = { pieces, bbox: { x0, y0, x1, y1 }, dark: null });
  }
  function opaqueBox(t) {
    const W = t.img.width, H = t.img.height, m = t.alpha; if (!m) return { x: 0, y: 0, w: W, h: H };
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaqueAt(m, x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    return x1 < 0 ? { x: 0, y: 0, w: W, h: H } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function darkOf(m) {   // the room's own pixels in the darkness colour (built once, only for rooms that need a reset)
    if (m.dark) return m.dark;
    const b = m.bbox, c = document.createElement('canvas'); c.width = b.x1 - b.x0; c.height = b.y1 - b.y0; const g = c.getContext('2d');
    for (const p of m.pieces) g.drawImage(p.img, p.sx, p.sy, p.w, p.h, p.dx - b.x0, p.dy - b.y0, p.w, p.h);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = DARK; g.fillRect(0, 0, c.width, c.height);
    return (m.dark = c);
  }
  const cutPieces = (g, m) => { for (const p of m.pieces) g.drawImage(p.img, p.sx, p.sy, p.w, p.h, p.dx, p.dy, p.w, p.h); };
  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  function drawDarkness(ctx, lit) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (!darkCv) darkCv = document.createElement('canvas');
    if (darkCv.width !== W || darkCv.height !== H) { darkCv.width = W; darkCv.height = H; }
    const g = darkCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy';
    g.fillStyle = DARK; g.fillRect(0, 0, W, H);
    g.setTransform(ctx.getTransform()); g.imageSmoothingEnabled = false;
    const litBoxes = [];
    for (const key in tiles) {   // the base layer's draw order (BACKDROP.draw): later rooms are in front on screen
      const m = maskOf(key);
      if (lit.has(key)) { g.globalCompositeOperation = 'destination-out'; cutPieces(g, m); litBoxes.push(m.bbox); }
      else if (litBoxes.some(b => overlaps(b, m.bbox))) {   // re-darken this room's own pixels over a lit room behind it
        g.globalCompositeOperation = 'destination-out'; cutPieces(g, m);
        g.globalCompositeOperation = 'source-over'; g.drawImage(darkOf(m), m.bbox.x0, m.bbox.y0);
      }
    }
    // door feathers of the lit rooms: a soft 1-tile spill into the hall just outside each door
    g.globalCompositeOperation = 'destination-out';
    for (const key of lit) {
      const doors = (typeof WORLD !== 'undefined' && WORLD.doorsOf) ? WORLD.doorsOf(key) : [];
      for (const d of doors) {
        if (d.ox == null) continue;
        // centre of the door edge, in tile coords; a circle there is an iso ellipse on screen
        const ex = (d.x + d.ox) / 2 + 0.5, ey = (d.y + d.oy) / 2 + 0.5;
        g.save(); g.transform(CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, -CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, 0, 0);
        const grd = g.createRadialGradient(ex, ey, 0, ex, ey, 1.1);
        grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.45, 'rgba(0,0,0,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(ex - 1.2, ey - 1.2, 2.4, 2.4); g.restore();
      }
    }
    // objects layer: the reactor's and the (Watch) globe's glow light their room's floor (a soft pool round the hero's
    // footprint centre, clipped to that room's floor), and those glowing heroes never dim (their frame is cut out; the
    // telescope, not a light, darkens with its room)
    if (typeof OBJECTS !== 'undefined') {
      for (const L of OBJECTS.litGlows()) {
        if (lit.has(L.room) || !rects[L.room]) continue;   // an active room is at day brightness already
        g.save(); g.beginPath(); rectRegion(g, rects[L.room], 0); g.clip();
        g.transform(CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, -CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, 0, 0);
        const grd = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.floor);
        grd.addColorStop(0, 'rgba(0,0,0,0.85)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(L.x - L.floor, L.y - L.floor, L.floor * 2, L.floor * 2); g.restore();
      }
      for (const h of OBJECTS.heroSprites()) g.drawImage(h.img, h.sx, h.sy, h.w, h.h, h.dx, h.dy, h.dw, h.dh);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(darkCv, 0, 0); ctx.restore();
  }
  function drawLight(ctx, opts) {
    opts = opts || {};
    const night = !!opts.night, lit = new Set(opts.litRooms || []), t = opts.time || 0;
    if (night) {
      try { drawDarkness(ctx, lit); }
      catch (e) { ctx.fillStyle = 'rgba(4,6,14,0.5)'; ctx.fillRect(-12000, -9000, 28000, 22000); }
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // night: each glowing hero (OBJECTS.litGlows) washes its room in its own colour: a pool on the floor and a halo
    // round the glowing part, breathing slowly. Both stay inside the hero room (floor diamond; the halo also its wall band).
    if (night && typeof OBJECTS !== 'undefined') for (const L of OBJECTS.litGlows()) {
      const a = L.a * (1 + 0.08 * Math.sin(t * 1.3 + L.x)), rr = rects[L.room]; if (!rr) continue;
      ctx.save(); ctx.beginPath(); rectRegion(ctx, rr, 0); ctx.clip(); ctx.transform(CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, -CONFIG.TILE_W / 2, CONFIG.TILE_H / 2, 0, 0);
      const fl = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.floor);
      fl.addColorStop(0, rgba(L.color, a * 0.7)); fl.addColorStop(0.6, rgba(L.color, a * 0.25)); fl.addColorStop(1, rgba(L.color, 0));
      ctx.fillStyle = fl; ctx.fillRect(L.x - L.floor, L.y - L.floor, L.floor * 2, L.floor * 2); ctx.restore();
      ctx.save(); ctx.beginPath(); rectRegion(ctx, rr, LIT_UP); ctx.clip();
      const c = ISO.toScreen(L.x, L.y), hy = c.sy - L.z, hg = ctx.createRadialGradient(c.sx, hy, 4, c.sx, hy, L.r);
      hg.addColorStop(0, rgba(L.color, a * 0.6)); hg.addColorStop(0.5, rgba(L.color, a * 0.2)); hg.addColorStop(1, rgba(L.color, 0));
      ctx.fillStyle = hg; ctx.fillRect(c.sx - L.r, hy - L.r, L.r * 2, L.r * 2); ctx.restore();
    }
    for (const r of CONFIG.ROOMS) {
      // the landing pad gets no lit-room pool: drawn in the light pass it washed over the parked shuttle's hull (the ring
      // glow FX draws under the shuttle lights the pad)
      if (!lit.has(r.key) || r.kind === 'corridor' || r.kind === 'pad') continue;
      const desks = Object.keys(r.seats || {}).map(deskTileOf).filter(Boolean);
      const cx = desks.length ? desks.reduce((s, d) => s + d.x + 0.5, 0) / desks.length : r.x + r.w / 2;
      const cy = desks.length ? desks.reduce((s, d) => s + d.y + 1, 0) / desks.length : r.y + r.h / 2;
      const c = ISO.toScreen(cx, cy), rad = 170, a = 0.13 * (1 + 0.05 * Math.sin(t * 2.1 + r.x));   // day level: the room is not dimmed
      const g = ctx.createRadialGradient(c.sx, c.sy, 2, c.sx, c.sy, rad);
      g.addColorStop(0, rgba(r.accent, a)); g.addColorStop(0.5, rgba(r.accent, a * 0.4)); g.addColorStop(1, rgba(r.accent, 0));
      ctx.save(); ctx.beginPath(); rectRegion(ctx, rects[r.key] || r, 0); ctx.clip();   // the pool stays on this room's floor
      ctx.fillStyle = g; ctx.fillRect(c.sx - rad, c.sy - rad, rad * 2, rad * 2); ctx.restore();
    }
    ctx.restore();
  }
  /* ---- canvas recovery: rebuilding the baked canvases ----
     Every image the painting is drawn from is an Image (harden() above); what is still a canvas is BAKED from those
     Images: the hall layer, the hull layer, the star tile, the wall strips, the darkness re-cuts
     (and any fragile hardened canvas). A mobile browser can drop a canvas's backing store while the tab is in the
     background, after which it draws as transparent: rebuild() makes them all again from the retained Images.
     blankCheck() reads one known-opaque pixel per canvas family (found when it was built) and returns the names that
     read transparent or whose context is lost; main.js calls it on every return to the page and every 5 s, and calls
     rebuild() on return and whenever the check fails. */
  const probes = [];   // [{name, canvas, x, y}]
  let lostSignal = false, pin = null;
  /* Alpha of one pixel of a baked canvas, copied into a 1x1 CPU canvas first (reading the big layer itself, which may be
     GPU-backed, would force a readback and warns in Chrome). A dropped store copies as transparent: 0. */
  function readAlpha(canvas, x, y) {
    if (!pin) { pin = document.createElement('canvas'); pin.width = pin.height = 1; }
    const g = pin.getContext('2d', { willReadFrequently: true });
    g.globalCompositeOperation = 'copy'; g.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
    return g.getImageData(0, 0, 1, 1).data[3];
  }
  function setProbe(name, canvas, pts) {
    for (let i = probes.length - 1; i >= 0; i--) if (probes[i].name === name) probes.splice(i, 1);
    if (!canvas || !canvas.getContext) return;
    if (!canvas._watch) { canvas._watch = true; for (const ev of ['contextlost', 'contextrestored']) canvas.addEventListener(ev, () => { lostSignal = true; }); }
    for (let k = 0; k < pts.length && k < 120; k++) {
      const x = Math.round(pts[k][0]), y = Math.round(pts[k][1]);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      try { if (readAlpha(canvas, x, y) === 255) { probes.push({ name, canvas, x, y }); return; } } catch (_) { return; }
    }
  }
  function retire(L) { if (L && L.canvas) L.canvas.width = L.canvas.height = 0; }   // free a replaced layer's store now
  function blankCheck() {
    const bad = [];
    if (!active()) return bad;
    if (lostSignal) bad.push('context lost signal');
    for (const p of probes) {
      const g = p.canvas.getContext('2d');
      if (!g || (g.isContextLost && g.isContextLost())) { bad.push(p.name + ' (context lost)'); continue; }
      let a = 255; try { a = readAlpha(p.canvas, p.x, p.y); } catch (_) {}
      if (a === 0) bad.push(p.name);
    }
    return bad;
  }
  function rebuild(why) {
    if (!active()) return 0;
    const t0 = performance.now(), part = {}, mark = (k, t) => { part[k] = Math.round(performance.now() - t); return performance.now(); };
    let t = t0;
    for (const f of fragile) { try { reharden(f); } catch (e) { console.warn('backdrop: re-harden failed', e); } }
    try { if (stars) stars.width = stars.height = 0; stars = buildStars(); setProbe('stars', stars, [[0, 0]]); if (!planetImg) planet = buildPlanet(); } catch (e) { console.warn('backdrop: stars rebuild failed', e); }
    t = mark('stars', t);
    try { for (const c of covers) if (c.draw && c.draw.canvas) c.draw.canvas.width = 0; buildCovers(); } catch (e) { console.warn('backdrop: strips rebuild failed', e); }
    t = mark('strips', t);
    for (const k in masks) { if (masks[k].dark) masks[k].dark.width = 0; masks[k].dark = null; }   // the darkness re-cuts lazily
    if (darkCv) { darkCv.width = darkCv.height = 0; darkCv = null; }
    try { buildCorridorLayer(); } catch (e) { console.warn('backdrop: corridor layer rebuild failed', e); }
    t = mark('halls', t);
    try { buildHull(); } catch (e) { console.warn('backdrop: hull layer rebuild failed', e); }
    mark('hull', t);
    lostSignal = false;
    const ms = Math.round(performance.now() - t0);
    console.log('backdrop: rebuilt the baked canvases (' + (why || 'asked') + ') in ' + ms + ' ms (' + Object.keys(part).map(k => k + ' ' + part[k]).join(', ') + ')');
    return ms;
  }
  /* Every canvas the backdrop keeps, with what it is (for the debug hook). */
  function bakedCanvases() {
    const out = [];
    if (corr.layer) out.push(corr.layer.canvas); if (hull.layer) out.push(hull.layer.canvas); if (stars) out.push(stars);
    if (planet && planet.getContext) out.push(planet);
    for (const c of covers) if (c.draw && c.draw.canvas) out.push(c.draw.canvas);
    for (const k in masks) if (masks[k].dark) out.push(masks[k].dark);
    for (const f of fragile) out.push(f.canvas);
    return out;
  }
  const _debug = {
    /* Simulates a dropped backing store: clears every baked canvas (backdrop, FX block sprites) without touching the source Images. The next return / probe must bring the floors back. */
    blankCanvases() {
      const all = bakedCanvases();
      if (typeof FX !== 'undefined' && FX.bakedCanvases) all.push(...FX.bakedCanvases());
      for (const c of all) { const g = c.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.restore(); }
      return all.length;
    },
    probes: () => probes.map(p => ({ name: p.name, x: p.x, y: p.y, w: p.canvas.width, h: p.canvas.height })),
    get fragile() { return fragile.length; },
  };

  function rgba(hex, a) {
    if (typeof hex !== 'string' || hex[0] !== '#') return 'rgba(245,166,35,' + a + ')';
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }
  return { preload, harden, alphaOf, rebuild, blankCheck, bakedCanvases, _debug, active, deskTileOf, tilesMode, draw, drawLight, coverDrawables, bounds, pixelScale, snap,
           ROOM_TABLE, OBJECT_TABLE,
           get covers() { return covers.length; }, get coverList() { return covers; }, get tiles() { return tiles; }, get corridors() { return corr; },
           get fits() { return fitLog.slice(); }, get seats() { return seatLog.slice(); } };
})();
