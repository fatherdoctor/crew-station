/* Crew station: the tile world. See docs/ARCHITECTURE.md.
   WORLD.init() resolves CONFIG.ROOMS / DOORS into tiles, walls and door crossings; BACKDROP hooks
   WORLD.finalize() to block object footprints with WORLD.block(x, y); WORLD.finalize() builds the nav grid used by path(). */
'use strict';

const WORLD = (() => {
  const W = CONFIG.GRID.w, H = CONFIG.GRID.h;
  const roomOf = new Int16Array(W * H).fill(-1);     // index into rooms, or -1 (space)
  const corridorAt = new Uint8Array(W * H);          // 1 if any corridor covers the tile
  const blocked = new Uint8Array(W * H);             // props
  const walk = new Uint8Array(W * H);                // finalize(): floor and not blocked
  const rooms = CONFIG.ROOMS.map((r, i) => Object.assign({ index: i }, r));
  const byKey = {};
  rooms.forEach(r => { byKey[r.key] = r; });
  const idx = (x, y) => y * W + x;
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  let crossings = new Set();                          // "x,y>x2,y2" pairs allowed across a wall (doors)
  let doorTiles = [];                                 // {room, x, y, ox, oy, side}
  let wallSegs = null;

  function init() {
    roomOf.fill(-1); corridorAt.fill(0); blocked.fill(0); crossings = new Set(); doorTiles = []; wallSegs = null;
    // corridors first, rooms override (a room tile is never a corridor tile)
    for (const r of rooms) if (r.kind === 'corridor') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inGrid(x, y)) { roomOf[idx(x, y)] = r.index; corridorAt[idx(x, y)] = 1; }
    for (const r of rooms) if (r.kind !== 'corridor') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inGrid(x, y)) { roomOf[idx(x, y)] = r.index; corridorAt[idx(x, y)] = 0; }
    for (const d of CONFIG.DOORS) {
      const r = byKey[d.room]; if (!r) continue;
      for (let i = 0; i < (d.width || 1); i++) {
        let x, y, ox, oy;
        if (d.side === 'N') { x = r.x + d.at + i; y = r.y; ox = x; oy = y - 1; }
        else if (d.side === 'S') { x = r.x + d.at + i; y = r.y + r.h - 1; ox = x; oy = y + 1; }
        else if (d.side === 'W') { x = r.x; y = r.y + d.at + i; ox = x - 1; oy = y; }
        else { x = r.x + r.w - 1; y = r.y + d.at + i; ox = x + 1; oy = y; }
        if (!inGrid(x, y) || !inGrid(ox, oy) || roomOf[idx(ox, oy)] < 0) continue;
        doorTiles.push({ room: r.key, side: d.side, x, y, ox, oy });
        crossings.add(x + ',' + y + '>' + ox + ',' + oy); crossings.add(ox + ',' + oy + '>' + x + ',' + y);
      }
    }
  }

  const isFloor = (x, y) => inGrid(x, y) && roomOf[idx(x, y)] >= 0;
  function roomAt(x, y) { if (!isFloor(x, y)) return null; return rooms[roomOf[idx(x, y)]].key; }
  function roomObjAt(x, y) { if (!isFloor(x, y)) return null; return rooms[roomOf[idx(x, y)]]; }
  function block(x, y) { if (inGrid(x, y)) blocked[idx(x, y)] = 1; }
  function unblock(x, y) { if (inGrid(x, y)) blocked[idx(x, y)] = 0; }
  function walkable(x, y) { return inGrid(x, y) && walk[idx(x, y)] === 1; }
  function isBlocked(x, y) { return inGrid(x, y) && blocked[idx(x, y)] === 1; }

  function finalize() {
    for (let i = 0; i < W * H; i++) walk[i] = (roomOf[i] >= 0 && !blocked[i]) ? 1 : 0;
    wallSegs = null;
  }

  /* May an agent step from (x, y) to the 4-neighbour (nx, ny)? Same room, corridor to corridor, through a door,
     or onto / off an open pad. */
  function canStep(x, y, nx, ny) {
    if (!walkable(nx, ny) || !isFloor(x, y)) return false;
    const a = roomOf[idx(x, y)], b = roomOf[idx(nx, ny)];
    if (a === b) return true;
    const ra = rooms[a], rb = rooms[b];
    if (ra.kind === 'corridor' && rb.kind === 'corridor') return true;
    if (crossings.has(x + ',' + y + '>' + nx + ',' + ny)) return true;
    if ((ra.kind === 'pad' || rb.kind === 'pad') && (ra.kind === 'corridor' || rb.kind === 'corridor' || ra.kind === 'pad' && rb.kind === 'pad')) return true;
    return false;
  }

  /* A* on tile centres, 4-neighbour. from/to may be floats (tile centres or agent positions).
     Cardinal walk: every change of direction costs TURN_COST, so paths prefer long straight legs
     over staircases (the state is tile + incoming direction). */
  const TURN_COST = 1.2;
  /* Screen walk (AGENTS sets it with setStepMode('diag') when SCREEN_WALK is on): steps are the four
     DIAGONAL grid moves, which are straight up / down / left / right on screen ((-1,-1) up, (1,1) down, (1,-1) right,
     (-1,1) left). A diagonal step needs BOTH two-step routes through its orthogonal neighbours to be legal (so it never grazes a wall
     corner, a blocked tile or a door jamb; a 1-wide door is crossed with one orthogonal step). Diagonal moves keep x + y parity, so an orthogonal step stays allowed
     at ORTH_COST to reach the other half of the tiles (usually one short step at the start or end of a walk). */
  const ORTH_COST = 1.5;   // per orthogonal step: above a diagonal (1) so rooms walk screen-straight, low enough that a 3-wide hall is a straight (screen-diagonal) leg rather than a zigzag
  let stepMode = 'orth';
  function setStepMode(m) { stepMode = m === 'diag' ? 'diag' : 'orth'; }
  function canDiag(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy; if (!walkable(nx, ny)) return false;
    // both two-step routes must be legal: a diagonal never grazes a wall corner, a blocked tile or a 1-wide door jamb
    return (canStep(x, y, x + dx, y) && canStep(x + dx, y, nx, ny)) && (canStep(x, y, x, y + dy) && canStep(x, y + dy, nx, ny));
  }
  function path(from, to) {
    const sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
    if (!isFloor(sx, sy) || !walkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [{ x: tx + 0.5, y: ty + 0.5 }];
    const diag = stepMode === 'diag';
    const N = diag ? [[1, -1], [-1, 1], [1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const S = N.length + 1, START = N.length;   // state = tile * S + incoming dir (START = none)
    const open = [], g = new Float32Array(W * H * S).fill(Infinity), came = new Int32Array(W * H * S).fill(-1), closed = new Uint8Array(W * H * S);
    const h = diag ? (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) : (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const s0 = idx(sx, sy) * S + START;
    // binary heap on f (the open list grows with the direction states)
    const push = n => { open.push(n); let i = open.length - 1; while (i) { const p = (i - 1) >> 1; if (open[p].f <= open[i].f) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
    const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l].f < open[m].f) m = l; if (r < open.length && open[r].f < open[m].f) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
    g[s0] = 0; push({ s: s0, f: h(sx, sy) });
    let guard = 0;
    while (open.length && guard++ < 250000) {
      const cur = pop(), cs = cur.s;
      if (closed[cs]) continue; closed[cs] = 1;
      const ci = Math.floor(cs / S), cd = cs % S, cx = ci % W, cy = (ci - cx) / W;
      if (cx === tx && cy === ty) {
        const out = []; let st = cs;
        while (st !== -1) { const i = Math.floor(st / S), x = i % W, y = (i - x) / W; out.push({ x: x + 0.5, y: y + 0.5 }); st = came[st]; }
        out.reverse();
        return out;
      }
      for (let d = 0; d < N.length; d++) {
        const ddx = N[d][0], ddy = N[d][1], nx = cx + ddx, ny = cy + ddy, isDiag = ddx && ddy;
        if (!inGrid(nx, ny) || !(isDiag ? canDiag(cx, cy, ddx, ddy) : canStep(cx, cy, nx, ny))) continue;
        const ns = idx(nx, ny) * S + d; if (closed[ns]) continue;
        const ng = g[cs] + (diag && !isDiag ? ORTH_COST : 1) + (corridorAt[idx(nx, ny)] ? 0 : 0.05) + (cd !== START && cd !== d ? TURN_COST : 0);
        if (ng < g[ns]) { g[ns] = ng; came[ns] = cs; push({ s: ns, f: ng + h(nx, ny) }); }
      }
    }
    return null;
  }

  function tilesOf(roomKey) {
    const r = byKey[roomKey]; if (!r) return [];
    const out = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inGrid(x, y) && roomOf[idx(x, y)] === r.index) out.push({ x, y });
    return out;
  }
  function randomTileIn(roomKey) {
    const ts = tilesOf(roomKey).filter(t => walkable(t.x, t.y) && !doorTiles.some(d => d.x === t.x && d.y === t.y));
    if (!ts.length) return null;
    const t = ts[Math.floor(Math.random() * ts.length)];
    return { x: t.x, y: t.y };
  }
  function doorsOf(roomKey) { return doorTiles.filter(d => d.room === roomKey); }

  /* Wall segments in tile-corner coordinates, door gaps removed, contiguous runs merged.
     side N/W are tall back walls, S/E low rails. Corridors only wall against space. */
  function wallSegments() {
    if (wallSegs) return wallSegs;
    const segs = [];
    const doorGap = new Set();
    for (const d of doorTiles) doorGap.add(d.room + ':' + d.side + ':' + d.x + ',' + d.y);
    for (const r of rooms) {
      if (r.kind === 'pad') continue;
      const runs = { N: [], S: [], W: [], E: [] };
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (!inGrid(x, y) || roomOf[idx(x, y)] !== r.index) continue;
        const sides = r.kind === 'corridor'
          ? { N: !isFloor(x, y - 1), S: !isFloor(x, y + 1), W: !isFloor(x - 1, y), E: !isFloor(x + 1, y) }
          : { N: y === r.y, S: y === r.y + r.h - 1, W: x === r.x, E: x === r.x + r.w - 1 };
        for (const s of ['N', 'S', 'W', 'E']) {
          if (!sides[s] || doorGap.has(r.key + ':' + s + ':' + x + ',' + y)) continue;
          // corridor: skip where the neighbour across is another corridor tile of another corridor (handled by isFloor)
          runs[s].push({ x, y });
        }
      }
      for (const s of ['N', 'S', 'W', 'E']) {
        const horizontal = s === 'N' || s === 'S';
        const key = horizontal ? 'y' : 'x', along = horizontal ? 'x' : 'y';
        runs[s].sort((a, b) => a[key] - b[key] || a[along] - b[along]);
        let cur = null;
        for (const t of runs[s]) {
          if (cur && cur[key] === t[key] && cur.end === t[along]) { cur.end = t[along] + 1; continue; }
          cur = { room: r.key, kind: r.kind, side: s, tall: s === 'N' || s === 'W', [key]: t[key], start: t[along], end: t[along] + 1 };
          segs.push(cur);
        }
      }
    }
    for (const sg of segs) {
      if (sg.side === 'N') { sg.x0 = sg.start; sg.y0 = sg.y; sg.x1 = sg.end; sg.y1 = sg.y; }
      else if (sg.side === 'S') { sg.x0 = sg.start; sg.y0 = sg.y + 1; sg.x1 = sg.end; sg.y1 = sg.y + 1; }
      else if (sg.side === 'W') { sg.x0 = sg.x; sg.y0 = sg.start; sg.x1 = sg.x; sg.y1 = sg.end; }
      else { sg.x0 = sg.x + 1; sg.y0 = sg.start; sg.x1 = sg.x + 1; sg.y1 = sg.end; }
    }
    wallSegs = segs;
    return segs;
  }

  /* World px bounds of the floor (no margins). */
  function bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (roomOf[idx(x, y)] >= 0) {
      for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
        const s = ISO.toScreen(cx, cy); minX = Math.min(minX, s.sx); maxX = Math.max(maxX, s.sx); minY = Math.min(minY, s.sy); maxY = Math.max(maxY, s.sy);
      }
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  function debugDraw(ctx) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (roomOf[idx(x, y)] < 0) continue;
      ISO.tilePath(ctx, x, y);
      ctx.fillStyle = blocked[idx(x, y)] ? 'rgba(255,80,80,0.35)' : corridorAt[idx(x, y)] ? 'rgba(80,200,255,0.18)' : 'rgba(120,255,120,0.14)';
      ctx.fill();
    }
    for (const d of doorTiles) { ISO.tilePath(ctx, d.x, d.y); ctx.fillStyle = 'rgba(255,220,60,0.5)'; ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    for (const sg of wallSegments()) {
      const a = ISO.toScreen(sg.x0, sg.y0), b = ISO.toScreen(sg.x1, sg.y1);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
  }

  return { W, H, rooms, byKey, init, finalize, block, unblock, isBlocked, isFloor, walkable, canStep, roomAt, roomObjAt,
           path, TURN_COST, setStepMode, get stepMode() { return stepMode; }, tilesOf, randomTileIn, doorsOf, doorTiles: () => doorTiles.slice(), wallSegments, bounds, debugDraw,
           isCorridor: (x, y) => inGrid(x, y) && corridorAt[idx(x, y)] === 1 };
})();
