/* Crew station: FLOORS. The walkable floor of every room, hand-drawn as a polygon over the painted shells
   (assets/floors.json). The shells keep their painted walls, so wall bases and rails do not sit on the guide rect
   edges; the polygon is the floor inside the painted wall bases and rails, straight across the door gaps.
   ?floors=0 turns it off (the CONFIG rects).

   Data: {<roomKey>: {points: [{px: [x, y] in the room's shell canvas, tile: [tx, ty] room-local fractional tiles
   ((0, 0) = the rect's north tile)}]}}. The shells sit on the guide by a pure translation, so absolute tile
   coords are (room.x + tx, room.y + ty). Halls have no polygon and are never touched.

   What it does (all hooks in backdrop.js / objects.js are marked "// Floors:"):
   - fitObjects(tiles) (after OBJECTS.place): every object / hero footprint whose tile centres leave the polygon is
     shifted by whole tiles (sprite and footprint together, OBJECTS.FLOOR_SHIFT) by the smallest move inward, along the
     axis away from the wall it crosses first, onto tiles inside the polygon, off the doors and off other footprints;
     then OBJECTS.place runs again.
   - fitSpots(opts) (end of BACKDROP's applyOverrides): seats, stand / inbox / meet / leisure / bunks spots outside the
     polygon or under a footprint move to the nearest free inside tile (same row / column preferred). A seat whose desk
     object was shifted moves with it (deskOf(member) then answers BACKDROP.deskTileOf). Charging pads (measured ring
     centres) and FX anchors are left alone.
   - applyBlocks() (in BACKDROP's WORLD.finalize hook, after its unblock-all + footprint sweep): every room tile whose
     centre is outside the polygon is WORLD.block'ed, except door tiles and the tile inward of each door.
   Everything that picks a tile (AGENTS' roam / wander, INTERACTIONS' stand tiles) goes through WORLD.walkable, so a
   blocked tile is never chosen. */
'use strict';

const FLOORS = (() => {
  const URL = 'assets/floors.json';
  const wanted = !(typeof location !== 'undefined' && /[?&]floors=0/.test(location.search));
  const polys = {};          // roomKey -> [[x, y], ...] absolute tile coords
  const boxes = {};          // roomKey -> {x, y, w, h} fractional bounds
  const blockedBy = {};      // roomKey -> ['x,y', ...] tiles blocked as off the floor
  const deskAbs = {};        // memberKey -> {x, y} absolute desk tile after a move
  const moves = [], shifts = [];
  let loaded = false;

  const roomObj = room => typeof room === 'string' ? CONFIG.ROOMS.find(r => r.key === room) : room;
  const keyOf = room => typeof room === 'string' ? room : room && room.key;
  const has = room => wanted && !!polys[keyOf(room)];
  /* Placements (assets/placements.json): the highest-priority layout. {<room>: {objects: [{name, fp: [x, y, w, h]}] in the
     order the page places that room's objects (OBJECTS.items order, names may repeat), heroes: [{name, fp}], seats:
     {<member>: {tile: [x, y] (fractional allowed), face}}}}, room-local. Listed objects / heroes go exactly there (sprite
     with the footprint) and are never fitted automatically (the floor checks only log); listed seats override CONFIG,
     ROOM_TABLE / OBJECT_TABLE and the floor fitting. ?placements=0 ignores the file. Works with ?floors=0 too. */
  const PL_URL = 'assets/placements.json';
  const plWanted = !(typeof location !== 'undefined' && /[?&]placements=0/.test(location.search));
  let placements = {};

  function preload() {
    const pl = !plWanted ? Promise.resolve() : LOADQ.json(PL_URL, { fetch: { cache: 'no-store' } }).then(j => {
      placements = {};
      for (const k in (j || {})) if (j[k] && typeof j[k] === 'object' && CONFIG.ROOMS.some(r => r.key === k)) placements[k] = j[k];
      const n = Object.keys(placements);
      if (n.length) console.log('placements: ' + n.length + ' room(s) placed by hand (' + n.join(', ') + ')');
    });
    if (!wanted) return pl;
    return Promise.all([pl, LOADQ.json(URL, { fetch: { cache: 'no-store' } }).then(j => {
      if (!j) { console.warn('floors: ' + URL + ' missing; rooms keep their CONFIG rects'); return; }
      for (const r of CONFIG.ROOMS) {
        if (r.kind === 'corridor' || !j[r.key] || !Array.isArray(j[r.key].points) || j[r.key].points.length < 3) continue;
        const p = j[r.key].points.map(q => [r.x + q.tile[0], r.y + q.tile[1]]);
        polys[r.key] = p;
        const xs = p.map(q => q[0]), ys = p.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
        boxes[r.key] = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
      }
      loaded = true;
      console.log('floors: polygons for ' + Object.keys(polys).length + ' rooms (' + Object.keys(polys).join(', ') + ')');
    })]);
  }

  /* Even-odd point in polygon at the exact point (x, y). */
  function insidePoint(room, x, y) {
    const P = polys[keyOf(room)]; if (!wanted || !P) return true;
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  /* Is the tile containing (x, y) on the painted floor (its centre inside the polygon)? No polygon / disabled: true. */
  function inside(room, x, y) { return insidePoint(room, Math.floor(x) + 0.5, Math.floor(y) + 0.5); }
  /* Axis-aligned fractional bounds of the polygon (absolute tiles): {x, y, w, h} and {x0, y0, x1, y1}. */
  function insetRect(room) { const b = boxes[keyOf(room)]; return b ? { x: b.x, y: b.y, w: b.w, h: b.h, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : null; }
  function poly(room) { const P = polys[keyOf(room)]; return P ? P.map(q => q.slice()) : null; }

  /* Door tiles of a room (edge tiles of CONFIG.DOORS, after BACKDROP's ROOM_TABLE door overrides) and the tile inward of each. */
  function doorInfo(roomKey) {
    const r = roomObj(roomKey), edge = new Set(), inward = new Set(); if (!r) return { edge, inward };
    for (const d of CONFIG.DOORS) {
      if (d.room !== r.key) continue;
      for (let i = 0; i < (d.width || 1); i++) {
        let x, y, nx = 0, ny = 0;
        if (d.side === 'N') { x = r.x + d.at + i; y = r.y; ny = 1; }
        else if (d.side === 'S') { x = r.x + d.at + i; y = r.y + r.h - 1; ny = -1; }
        else if (d.side === 'W') { x = r.x; y = r.y + d.at + i; nx = 1; }
        else { x = r.x + r.w - 1; y = r.y + d.at + i; nx = -1; }
        edge.add(x + ',' + y); inward.add((x + nx) + ',' + (y + ny));
      }
    }
    return { edge, inward };
  }
  /* The doors a room will have once BACKDROP's applyOverrides has run (fitObjects runs before it): a side listed in
     BACKDROP.ROOM_TABLE[room].doors takes those doors instead of CONFIG's (the same rule as applyOverrides; idempotent after it). */
  function doorAll(roomKey) {
    const doorTable = typeof BACKDROP !== 'undefined' && BACKDROP.ROOM_TABLE && BACKDROP.ROOM_TABLE[roomKey] && BACKDROP.ROOM_TABLE[roomKey].doors;
    if (!doorTable) return doorInfo(roomKey);
    const sides = new Set(doorTable.map(d => d.side)), save = CONFIG.DOORS.slice();
    CONFIG.DOORS.splice(0, CONFIG.DOORS.length, ...save.filter(d => !(d.room === roomKey && sides.has(d.side))).concat(doorTable.map(d => Object.assign({ room: roomKey, width: 2 }, d))));
    try { return doorInfo(roomKey); } finally { CONFIG.DOORS.splice(0, CONFIG.DOORS.length, ...save); }
  }
  const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const tilesOf = f => { const t = []; for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) t.push([x, y]); return t; };
  const loc = (r, x, y) => (x - r.x) + ',' + (y - r.y);
  /* Inward normal (tile space) of the polygon edge nearest to (x, y). */
  function edgeNormal(key, x, y) {
    const P = polys[key]; let best = null, bd = Infinity;
    const cx = P.reduce((s, q) => s + q[0], 0) / P.length, cy = P.reduce((s, q) => s + q[1], 0) / P.length;
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), d = Math.hypot(ax + t * ex - x, ay + t * ey - y);
      if (d < bd) { bd = d; let nx = -ey, ny = ex; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        if (nx * (cx - (ax + t * ex)) + ny * (cy - (ay + t * ey)) < 0) { nx = -nx; ny = -ny; } best = [nx, ny]; }
    }
    return best || [0, 0];
  }

  /* ---- furniture ---- */
  /* Hand placements: room -> object name -> [x, y] room-local footprint origin. Applied first (sprite
     and footprint together, like any shift); the automatic fit then works round them. A desk's seat follows its desk. */
  const PLACE = {
    lounge: { 'cafe bar': [5, 1] },                          // off the north wall base, front (south) side open for the brew spot
    library: { sofa: [2, 4], 'book stand': [6, 6] },          // sofa one more tile in; lectern lower middle, east of the S door queue
    // Records re-laid to use the whole room: west shelves on the west wall south of the W door (y 3..4), north shelves
    // west of the N door (x 4..5), east shelves free-standing in the south-east, the desk in the centre (seat south of it)
    workshop: { 'drill bench': [2, 5] },                      // off the north-corner wall base, beside the lathe on the west side
    records: { 'west archive shelves': [1, 5], 'north archive shelves': [1, 1], 'east archive shelves': [6, 6], 'archive desk': [4, 3] },
  };
  const CORNER_INSET = 0.25;   // a measured base corner may sit this far (tiles) outside the polygon (the measure is ~0.5 exact)
  const POCKET_OK = 2;   // a shift may leave up to 2 floor tiles walled in behind furniture (a corner nook); more walls off part of the room
  function fitObjects(tiles, opts) {
    const seatSet = new Set((opts && opts.seats) || []);   // absolute 'x,y' seat tiles: no automatic shift lands on one
    if (typeof OBJECTS === 'undefined') return;
    const floorsOn = wanted && loaded;
    if (!floorsOn && !Object.keys(placements).length) return;
    shifts.length = 0;
    for (const k in OBJECTS.FLOOR_SHIFT) delete OBJECTS.FLOOR_SHIFT[k];
    for (const k in OBJECTS.KEEP) delete OBJECTS.KEEP[k];
    const fps = OBJECTS.footprints().map(p => Object.assign({}, p));
    const roomKeys = new Set((floorsOn ? Object.keys(polys) : []).concat(Object.keys(placements)));
    for (const key of roomKeys) {
      const r = roomObj(key), mine = fps.filter(p => p.room === key); if (!r || !mine.length) continue;
      const doors = doorAll(key);
      // off the floor: a footprint tile centre outside the polygon, or a corner of the sprite's measured base (OBJECTS.measured)
      const meas = OBJECTS.measured.filter(m => m.room === key);
      const baseOf = p => { if (p.hero) return null; const c = meas.filter(m => m.name === p.name); if (!c.length) return null;
        c.sort((a, b) => Math.hypot(a.footprint[0] - (p.x0 - r.x), a.footprint[1] - (p.y0 - r.y)) - Math.hypot(b.footprint[0] - (p.x0 - r.x), b.footprint[1] - (p.y0 - r.y))); return c[0]; };
      const cornersOff = (p, sx, sy) => { const m = p.base; if (!m) return [];
        const [bx, by] = m.back, [fx, fy] = m.front, cx = (bx + fx) / 2, cy = (by + fy) / 2;
        return [[bx, by], [fx, fy], [bx, fy], [fx, by]].map(([x, y]) => [r.x + x + sx + Math.sign(cx - x) * CORNER_INSET, r.y + y + sy + Math.sign(cy - y) * CORNER_INSET])
          .filter(([x, y]) => !insidePoint(key, x, y)); };
      const offFloor = (f, p, sx, sy) => tilesOf(f).filter(([x, y]) => !inRect(r, x, y) || !inside(key, x, y)).map(([x, y]) => [x + 0.5, y + 0.5])
        .concat(p ? cornersOff(p, sx || 0, sy || 0) : []);
      for (const p of mine) { p.x0 = p.x; p.y0 = p.y; p.base = baseOf(p); }
      const record = (p, sx, sy, why) => {
        const rec = { room: key, name: p.name, kind: p.kind, hero: !!p.hero, from: { x: p.x, y: p.y, w: p.w, h: p.h }, shift: [sx, sy], off: why };
        p.x += sx; p.y += sy;
        (OBJECTS.FLOOR_SHIFT[key] || (OBJECTS.FLOOR_SHIFT[key] = {}))[p.hero ? p.name : '#' + p.idx] = [sx, sy];
        shifts.push(rec);
        console.log('floors: shifted ' + key + ' ' + (p.hero ? 'hero ' : '') + p.name + ' ' + loc(r, rec.from.x, rec.from.y) + ' ' + p.w + 'x' + p.h + ' -> ' + loc(r, p.x, p.y) + ' (by ' + sx + ',' + sy + '; ' + why + ')');
      };
      // the placements file first: listed objects by position (same name), else by name and occurrence; heroes by name
      const P = placements[key];
      if (P) {
        const objs = mine.filter(p => !p.hero), used = new Set();
        (P.objects || []).forEach((o, i) => {
          if (!o || !Array.isArray(o.fp)) return;
          let p = objs[i] && objs[i].name === o.name && !used.has(objs[i]) ? objs[i] : null;
          if (!p) { const nth = P.objects.slice(0, i).filter(q => q && q.name === o.name).length; p = objs.filter(q => q.name === o.name)[nth] || null; }
          if (!p || used.has(p)) { console.warn('placements: ' + key + ' object ' + i + ' ' + o.name + ' matches nothing the page places'); return; }
          used.add(p); p.placed = true;
          if (Array.isArray(o.keep)) (OBJECTS.KEEP[key] || (OBJECTS.KEEP[key] = {}))['#' + p.idx] = o.keep.filter(q => Array.isArray(q) && q.length === 2).map(q => [Math.round(q[0]), Math.round(q[1])]);   // keep-out tiles
          if (o.fp[2] !== p.w || o.fp[3] !== p.h) console.warn('placements: ' + key + ' ' + o.name + ' size ' + o.fp[2] + 'x' + o.fp[3] + ' differs from the page (' + p.w + 'x' + p.h + '); position only');
          const sx = r.x + o.fp[0] - p.x, sy = r.y + o.fp[1] - p.y; if (sx || sy) record(p, sx, sy, 'placements file');
        });
        for (const h of (P.heroes || [])) {
          const p = mine.find(q => q.hero && q.name === (h && h.name));
          if (!p || !Array.isArray(h.fp)) { console.warn('placements: ' + key + ' hero ' + (h && h.name) + ' not placed here'); continue; }
          p.placed = true; const sx = r.x + h.fp[0] - p.x, sy = r.y + h.fp[1] - p.y; if (sx || sy) record(p, sx, sy, 'placements file');
          if (Array.isArray(h.keep)) (OBJECTS.KEEP[key] || (OBJECTS.KEEP[key] = {}))[p.name] = h.keep.filter(q => Array.isArray(q) && q.length === 2).map(q => [Math.round(q[0]), Math.round(q[1])]);
        }
      }
      if (!floorsOn || !polys[key]) continue;   // placements only: no floor fitting for this room
      for (const p of mine) { if (p.placed) continue; const t = PLACE[key] && PLACE[key][p.name]; if (!t) continue; p.placed = true;
        const sx = r.x + t[0] - p.x, sy = r.y + t[1] - p.y; if (sx || sy) record(p, sx, sy, 'placed by hand (FLOORS PLACE)'); }
      // free floor tiles nobody can reach from the room's doors (a shift must not wall off part of the room, POCKET_OK)
      const pockets = () => {
        const walk = (x, y) => inRect(r, x, y) && (doors.edge.has(x + ',' + y) || doors.inward.has(x + ',' + y) ||
          (inside(key, x, y) && !fps.some(q => q.room === key && q.block && !(q.open && q.open.includes(x + ',' + y)) && x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)));
        const seen = new Set(), st = [...doors.edge].map(k => k.split(',').map(Number)).filter(([x, y]) => walk(x, y));
        st.forEach(([x, y]) => seen.add(x + ',' + y));
        while (st.length) { const [x, y] = st.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (x + dx) + ',' + (y + dy); if (!seen.has(k) && walk(x + dx, y + dy)) { seen.add(k); st.push([x + dx, y + dy]); } } }
        let n = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (walk(x, y) && !seen.has(x + ',' + y)) n++;
        return n;
      };
      // heroes first: they keep their spot unless they cross the edge, and the rest fit around them
      const tileOff = p => tilesOf(p).some(([x, y]) => !inRect(r, x, y) || !inside(key, x, y)) ? 1 : 0;
      const order = mine.slice().sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0) || tileOff(b) - tileOff(a));   // heroes, then footprints off the floor, then base corners
      for (const p of order) {
        if (p.placed) { const o = offFloor(p, p, p.x - p.x0, p.y - p.y0); if (o.length) console.warn('floors: ' + key + ' ' + p.name + ' placed by hand but off the floor at ' + o.map(q => q.map(v => v.toFixed(2)).join(',')).join(' ')); continue; }
        const off = offFloor(p, p, 0, 0); if (!off.length) continue;
        // only a measured base corner is off (the footprint is on the floor): a one-tile move at most, else just reported
        const cornerOnly = !tilesOf(p).some(([x, y]) => !inRect(r, x, y) || !inside(key, x, y));
        // the wall it crosses: the mean inward normal of the polygon edges nearest its off-floor tiles. Cost of a shift:
        // tiles moved away from that wall, plus 0.9 per tile along it (so a piece stays against its wall where it can),
        // plus 5 for moving toward the wall
        let nx = 0, ny = 0; for (const [x, y] of off) { const n = edgeNormal(key, x, y); nx += n[0]; ny += n[1]; }
        const perpX = Math.abs(nx) >= Math.abs(ny), sgn = perpX ? Math.sign(nx) || 1 : Math.sign(ny) || 1;
        const cands = [];
        for (let sy = -4; sy <= 4; sy++) for (let sx = -4; sx <= 4; sx++) {
          if (!sx && !sy) continue;
          const perp = perpX ? sx : sy, along = perpX ? sy : sx;
          cands.push({ sx, sy, cost: Math.abs(perp) + 0.9 * Math.abs(along) + (perp * sgn < 0 ? 5 : 0) });
        }
        cands.sort((a, b) => a.cost - b.cost);
        const others = fps.filter(q => q !== p && q.room === key);
        // a desk may cover its own seat's tile: the seat moves with the desk (fitSpots)
        const ownSeat = (x, y) => p.kind === 'desk' && ((x >= p.x0 && x < p.x0 + p.w && (y === p.y0 - 1 || y === p.y0 + p.h)) || (y >= p.y0 && y < p.y0 + p.h && (x === p.x0 - 1 || x === p.x0 + p.w)));
        const fits = f => tilesOf(f).every(([x, y]) => inRect(r, x, y) && inside(key, x, y) && !doors.edge.has(x + ',' + y) && !doors.inward.has(x + ',' + y)
          && !(seatSet.has(x + ',' + y) && !ownSeat(x, y)) && !others.some(q => (q.block || !p.block) && x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h));
        const before = p.block ? pockets() : 0;
        let best = null;
        for (const c of cands) {
          if (cornerOnly && c.cost > 1) break;
          const f = { x: p.x + c.sx, y: p.y + c.sy, w: p.w, h: p.h }; if (!fits(f) || (cornerOnly && cornersOff(p, c.sx, c.sy).length)) continue;   // a footprint off the floor moves by its tiles (overhanging sprites measure badly)
          if (p.block) { const ox = p.x, oy = p.y; p.x = f.x; p.y = f.y; const after = pockets(); p.x = ox; p.y = oy; if (after > before + POCKET_OK) continue; }
          best = c; break;
        }
        if (!best && cornerOnly) { console.log('floors: ' + key + ' ' + p.name + ' at ' + loc(r, p.x, p.y) + ': its measured base reaches past the floor edge (' + off.map(([x, y]) => (x - r.x).toFixed(2) + ',' + (y - r.y).toFixed(2)).join(' ') + ') but no free one-tile move; left in place'); continue; }
        if (!best) { console.warn('floors: ' + key + ' ' + p.name + ' at ' + loc(r, p.x, p.y) + ' ' + p.w + 'x' + p.h + ' crosses the floor edge (' + off.map(([x, y]) => (x - r.x).toFixed(2) + ',' + (y - r.y).toFixed(2)).join(' ') + ') and has no free spot within 4 tiles; left in place'); continue; }
        record(p, best.sx, best.sy, 'off the floor at ' + off.map(([x, y]) => (x - r.x).toFixed(2) + ',' + (y - r.y).toFixed(2)).join(' '));
      }
    }
    if (shifts.length || Object.keys(OBJECTS.KEEP).length) OBJECTS.place(tiles);
    // check: every footprint now inside
    const bad = OBJECTS.footprints().filter(p => polys[p.room] && tilesOf(p).some(([x, y]) => !inside(p.room, x, y)));
    console.log('floors: ' + shifts.length + ' object(s) shifted onto the floor polygons' + (bad.length ? '; STILL OFF THE FLOOR: ' + bad.map(p => p.room + ' ' + p.name).join(', ') : '; every footprint inside its polygon'));
  }

  /* ---- seats and spots ---- opts: {free(x, y): no blocking footprint, deskTileOf(member), rooms: [keys drawn]} */
  function fitSpots(opts) {
    moves.length = 0;
    if (wanted && loaded) fitFloorSpots(opts);
    placeSeats();
  }
  /* Seats from the placements file: tile (room-local, fractional allowed) and face replace whatever was set; the desk is
     the footprint tile the seat faces (else any footprint tile beside it; the seat's own tile when it is on an object). */
  function placeSeats() {
    for (const key in placements) {
      const P = placements[key], r = roomObj(key); if (!P || !P.seats || !r) continue;
      for (const k in P.seats) {
        const q = P.seats[k]; if (!q || !Array.isArray(q.tile)) continue;
        const berth = CONFIG.ROOMS.find(rr => rr.seats && rr.seats[k]); if (!berth) { console.warn('placements: no seat for ' + k); continue; }
        if (berth !== r) console.warn('placements: ' + k + ' sits in ' + berth.key + ', the file puts the seat in ' + key);
        const s = berth.seats[k], was = [s.x, s.y];
        s.x = r.x + q.tile[0]; s.y = r.y + q.tile[1]; if (q.face) s.face = q.face;
        const tx = Math.floor(s.x), ty = Math.floor(s.y), fpAt = (x, y) => (typeof OBJECTS !== 'undefined' && OBJECTS.footprintAt) ? OBJECTS.footprintAt(x, y, true) : null;
        const step = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[s.face] || [0, -1];
        let desk = null;
        if (fpAt(tx, ty)) desk = { x: tx, y: ty };
        else if (fpAt(tx + step[0], ty + step[1])) desk = { x: tx + step[0], y: ty + step[1] };
        else for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) if (fpAt(tx + dx, ty + dy)) { desk = { x: tx + dx, y: ty + dy }; break; }
        if (desk) deskAbs[k] = desk; else console.warn('placements: ' + k + ' seat ' + q.tile.join(',') + ' has no object beside it (the desk check will warn)');
        if (was[0] !== s.x || was[1] !== s.y) moves.push({ room: key, what: 'seat ' + k, from: loc(r, was[0], was[1]), to: q.tile.join(','), why: 'placements file' });
        console.log('placements: seat ' + k + ' ' + key + ' ' + q.tile.join(',') + ' facing ' + s.face + (desk ? ' (desk ' + loc(r, desk.x, desk.y) + ')' : ''));
      }
    }
  }
  function fitFloorSpots(opts) {
    const free = opts && opts.free || (() => true);
    for (const r of CONFIG.ROOMS) {
      if (!polys[r.key] || (opts && opts.rooms && !opts.rooms.includes(r.key))) continue;
      const doors = doorInfo(r.key), taken = new Set();
      const ok = (x, y) => inRect(r, x, y) && inside(r.key, x, y) && free(x, y) && !doors.edge.has(x + ',' + y) && !doors.inward.has(x + ',' + y) && !taken.has(x + ',' + y);
      const good = (x, y) => inRect(r, x, y) && inside(r.key, x, y) && free(x, y) && !doors.edge.has(x + ',' + y);
      // nearest ok tile to (x, y) among cands (default: the room); the same row / column wins at near-equal distance
      const nearest = (x, y, cands) => {
        const list = cands || (() => { const a = []; for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) a.push([tx, ty]); return a; })();
        let best = null, bd = Infinity;
        for (const [tx, ty] of list) { if (!ok(tx, ty)) continue; const d = Math.hypot(tx - x, ty - y) + (tx === x || ty === y ? 0 : 0.75); if (d < bd) { bd = d; best = [tx, ty]; } }
        return best;
      };
      const log = (what, from, to, why) => { const m = { room: r.key, what, from: loc(r, from[0], from[1]), to: loc(r, to[0], to[1]), why }; moves.push(m); console.log('floors: moved ' + r.key + ' ' + what + ' ' + m.from + ' -> ' + m.to + ' (' + why + ')'); };
      // seats
      for (const k in (r.seats || {})) {
        const s = r.seats[k], d0 = opts && opts.deskTileOf ? opts.deskTileOf(k) : { x: s.x, y: s.y - 1 }, couch = d0 && d0.x === s.x && d0.y === s.y;
        let desk = d0 ? { x: d0.x, y: d0.y } : null; const was = [s.x, s.y];
        const sh = desk && shifts.find(q => q.room === r.key && desk.x >= q.from.x && desk.x < q.from.x + q.from.w && desk.y >= q.from.y && desk.y < q.from.y + q.from.h);
        if (sh) {   // the desk (or couch) moved: the seat goes with it
          desk = { x: desk.x + sh.shift[0], y: desk.y + sh.shift[1] }; s.x += sh.shift[0]; s.y += sh.shift[1];
          deskAbs[k] = couch ? { x: s.x, y: s.y } : desk;
          log('seat ' + k, was, [s.x, s.y], 'with ' + sh.name + ' shifted ' + sh.shift.join(','));
        }
        if (!good(s.x, s.y) || taken.has(s.x + ',' + s.y)) {
          const from = [s.x, s.y]; let to;
          if (couch || !desk) to = nearest(s.x, s.y);
          else to = nearest(s.x, s.y, [[desk.x, desk.y + 1], [desk.x + 1, desk.y], [desk.x - 1, desk.y], [desk.x, desk.y - 1]]) || nearest(s.x, s.y);
          if (to) {
            s.x = to[0]; s.y = to[1];
            if (desk && !couch) { deskAbs[k] = desk; const dx = desk.x - s.x, dy = desk.y - s.y; if (Math.abs(dx) + Math.abs(dy) === 1) s.face = dy < 0 ? 'north' : dy > 0 ? 'south' : dx > 0 ? 'east' : 'west'; }
            else deskAbs[k] = { x: s.x, y: s.y };
            log('seat ' + k, from, to, inside(r.key, from[0], from[1]) ? 'under a footprint or on a door' : 'off the floor polygon');
          } else console.warn('floors: ' + r.key + ' seat ' + k + ' at ' + loc(r, s.x, s.y) + ' is off the floor and has no free tile');
        }
        taken.add(s.x + ',' + s.y);
      }
      // standing spots (pads and FX anchors are not standing spots)
      const sp = r.spots || {};
      for (const name of ['stand', 'inbox', 'meet', 'leisure', 'bunks']) {
        const v = sp[name]; if (!v) continue;
        (Array.isArray(v) ? v : [v]).forEach((t, i) => {
          const x = Math.floor(t.x), y = Math.floor(t.y);
          if (good(x, y) && !taken.has(x + ',' + y)) { taken.add(x + ',' + y); return; }
          const to = nearest(x, y);
          if (!to) { console.warn('floors: ' + r.key + ' ' + name + i + ' at ' + loc(r, x, y) + ' is off the floor and has no free tile'); return; }
          const why = !inside(r.key, x, y) ? 'off the floor polygon' : taken.has(x + ',' + y) ? 'shared a tile' : 'under a footprint or on a door';
          t.x = to[0] + (t.x - x); t.y = to[1] + (t.y - y); taken.add(to[0] + ',' + to[1]);
          log(name + (Array.isArray(v) ? i : ''), [x, y], to, why);
        });
      }
    }
    console.log('floors: ' + moves.length + ' seat(s) / spot(s) moved onto the floor polygons');
  }
  function deskOf(member) { return deskAbs[member] || null; }

  /* ---- walkability: called inside BACKDROP's WORLD.finalize hook ---- */
  function applyBlocks() {
    if (!wanted || !loaded || typeof WORLD === 'undefined') return;
    let n = 0;
    for (const key in polys) {
      const r = roomObj(key), doors = doorInfo(key), list = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (WORLD.roomAt(x, y) !== key || inside(key, x, y) || doors.edge.has(x + ',' + y) || doors.inward.has(x + ',' + y)) continue;
        WORLD.block(x, y); list.push(x + ',' + y); n++;
      }
      blockedBy[key] = list;
    }
    console.log('floors: blocked ' + n + ' room tiles off the painted floor (' + Object.keys(blockedBy).filter(k => blockedBy[k].length).map(k => k + ' ' + blockedBy[k].length).join(', ') + ')');
  }

  /* Every seat at a desk object: off every footprint, adjacent to the desk, on its front (larger x + y) side, and a figure
     there sorts in front of the desk strips its sprite overlaps (AGENTS depth = x + y + 0.01 at the seat centre).
     deskTileOf: BACKDROP.deskTileOf. Loud warning per failing member; returns the failures. */
  function checkDesks(deskTileOf) {
    if (typeof OBJECTS === 'undefined' || !OBJECTS.items) return [];
    const bad = [], HALF = 30;   // half a seated figure's width on screen, world px
    for (const r of CONFIG.ROOMS) for (const k in (r.seats || {})) {
      const s = r.seats[k], d = deskTileOf ? deskTileOf(k) : { x: s.x, y: s.y - 1 }; if (!d || (d.x === s.x && d.y === s.y)) continue;   // couch seats
      const desk = OBJECTS.items.find(it => it.room === r.key && d.x >= it.fp.x && d.x < it.fp.x + it.fp.w && d.y >= it.fp.y && d.y < it.fp.y + it.fp.h);
      if (!desk) continue;
      const why = [], fp = desk.fp;
      const under = OBJECTS.footprintAt(s.x, s.y, false); if (under) why.push('seat under ' + under.name);
      const adj = (s.x >= fp.x && s.x < fp.x + fp.w && (s.y === fp.y - 1 || s.y === fp.y + fp.h)) || (s.y >= fp.y && s.y < fp.y + fp.h && (s.x === fp.x - 1 || s.x === fp.x + fp.w));
      if (!adj) why.push('seat not beside the desk');
      else if (s.y === fp.y - 1 || s.x === fp.x - 1) why.push('seat behind the desk (north / west side)');
      const sx = ISO.tileCenter(s.x, s.y).sx, dep = s.x + s.y + 1 + 0.01;
      const over = desk.strips.filter(st => st.x1 > sx - HALF && st.x0 < sx + HALF && st.depth >= dep);
      if (over.length) why.push('desk strips at depth ' + over.map(st => st.depth).join('/') + ' draw over the seated figure (depth ' + dep.toFixed(2) + ')');
      if (FLOORS.has(r.key) && !inside(r.key, s.x, s.y)) why.push('seat off the floor polygon');
      if (why.length) { bad.push(k); console.warn('floors: DESK CHECK FAILED ' + k + ' (' + r.key + ' seat ' + loc(r, s.x, s.y) + ', ' + desk.name + ' ' + loc(r, fp.x, fp.y) + ' ' + fp.w + 'x' + fp.h + '): ' + why.join('; ')); }
    }
    console.log('floors: desk check ' + (bad.length ? bad.length + ' FAILING: ' + bad.join(', ') : 'every desk seat in front of its desk, off every footprint'));
    return bad;
  }

  /* Why figures walk through furniture: every object whose measured sprite base (OBJECTS.measured, final positions)
     covers a walkable tile, i.e. a tile centre inside the base that WORLD does not block. Logged per object; returned. */
  function auditBases() {
    if (typeof OBJECTS === 'undefined' || !OBJECTS.measured || typeof WORLD === 'undefined') return [];
    const out = [], fps = OBJECTS.footprints();
    for (const m of OBJECTS.measured) {
      const r = roomObj(m.room); if (!r) continue;
      const fp = fps.find(p => p.room === m.room && p.name === m.name && p.x - r.x === m.footprint[0] && p.y - r.y === m.footprint[1]) || fps.find(p => p.room === m.room && p.name === m.name);
      if (fp && fp.block === false) continue;   // lowprofile: walked over by design
      const x0 = Math.min(m.back[0], m.front[0]), x1 = Math.max(m.back[0], m.front[0]), y0 = Math.min(m.back[1], m.front[1]), y1 = Math.max(m.back[1], m.front[1]);
      const open = [];
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        if (x + 0.5 <= x0 || x + 0.5 >= x1 || y + 0.5 <= y0 || y + 0.5 >= y1) continue;
        const ax = r.x + x, ay = r.y + y;
        if (WORLD.roomAt(ax, ay) === m.room && WORLD.walkable(ax, ay)) open.push(x + ',' + y);
      }
      if (open.length) out.push({ room: m.room, name: m.name, footprint: m.footprint.join(','), base: [x0, y0, x1, y1].map(v => +v.toFixed(2)).join(','), open });
    }
    for (const o of out) console.warn('floors: base audit ' + o.room + ' ' + o.name + ' (footprint ' + o.footprint + ', measured base ' + o.base + ') covers walkable tile(s) ' + o.open.join(' '));
    console.log('floors: base audit ' + (out.length ? out.length + ' object(s) whose sprite base covers walkable tiles' : 'every measured base is on blocked tiles'));
    auditLog = out; return out;
  }
  let auditLog = [];

  /* ?bdgrid=1: each polygon in yellow, its blocked tiles crossed in orange. */
  function debugDraw(ctx) {
    if (!wanted) return;
    ctx.save();
    for (const key in blockedBy) for (const k of blockedBy[key]) {
      const [x, y] = k.split(',').map(Number);
      ISO.tilePath(ctx, x, y); ctx.fillStyle = 'rgba(255,140,0,0.35)'; ctx.fill();
      const a = ISO.toScreen(x, y), b = ISO.toScreen(x + 1, y + 1), c = ISO.toScreen(x + 1, y), d = ISO.toScreen(x, y + 1);
      ctx.strokeStyle = 'rgba(255,140,0,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
    }
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 2.5;
    for (const key in polys) {
      const P = polys[key]; ctx.beginPath();
      P.forEach(([x, y], i) => { const s = ISO.toScreen(x, y); if (i) ctx.lineTo(s.sx, s.sy); else ctx.moveTo(s.sx, s.sy); });
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }

  return { PLACE, preload, inside, insidePoint, insetRect, poly, has, doorInfo, fitObjects, fitSpots, deskOf, applyBlocks, checkDesks, auditBases, get audit() { return auditLog.slice(); }, debugDraw,
           get enabled() { return wanted && loaded; }, get placementsOn() { return Object.keys(placements).length > 0; }, get placements() { return placements; }, get moves() { return moves.slice(); }, get shifts() { return shifts.slice(); },
           get blocked() { return JSON.parse(JSON.stringify(blockedBy)); }, get rooms() { return Object.keys(polys); } };
})();
