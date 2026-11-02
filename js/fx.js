/* Crew station: FX. See docs/ARCHITECTURE.md.
   Parcels, speech bubbles, charging glow, the construction dock (epics), shuttle glow, ambient motes/steam/flicker,
   and timed floor markers. Everything draws in WORLD px (the camera transform is already applied). */
'use strict';

const FX = (() => {
  const T = CONFIG.TIMING, PAL = CONFIG.PALETTE;
  const TW = CONFIG.TILE_W, TH = CONFIG.TILE_H;
  const FONT = '16px VT323, monospace', FONT_S = '13px VT323, monospace';
  const HEAD_PX = 70;                                        // the figure's head above its feet
  const roomOf = key => CONFIG.ROOMS.find(r => r.key === key);
  // backdrop mode: a painted station under the grid; positions come from CONFIG at init time (BACKDROP rewrites seats/spots first)
  const BD = () => (typeof BACKDROP !== 'undefined' && BACKDROP && BACKDROP.active && BACKDROP.active()) ? BACKDROP : null;
  const PS = () => { const b = BD(); return (b && b.pixelScale) ? (Number(b.pixelScale()) || 1) : 1; };
  const snap = (sx, sy) => { const b = BD(); if (b && b.snap) { const q = b.snap(sx, sy); if (q && q.sx !== undefined) return q; if (q && q.x !== undefined) return { sx: q.x, sy: q.y }; } return { sx: Math.round(sx), sy: Math.round(sy) }; };

  // projection, with a local fallback so the module runs before/without iso.js
  const toScreen = (x, y, z) => (typeof ISO !== 'undefined' && ISO.toScreen) ? ISO.toScreen(x, y, z || 0)
    : { sx: (x - y) * TW / 2, sy: (x + y) * TH / 2 - (z || 0) };
  const depthOf = (x, y, z) => (typeof ISO !== 'undefined' && ISO.depth) ? ISO.depth(x, y, z || 0) : x + y + (z || 0) * 0.001;
  const centre = t => ({ x: t.x + 0.5, y: t.y + 0.5 });
  function pathBetween(a, b) {
    let p = null;
    try { if (typeof WORLD !== 'undefined' && WORLD.path) p = WORLD.path({ x: Math.floor(a.x), y: Math.floor(a.y) }, { x: Math.floor(b.x), y: Math.floor(b.y) }); } catch (_) { p = null; }
    if (p && p.length > 1) return p;
    const n = Math.max(2, Math.round(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
    const out = [];
    for (let i = 0; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
    return out;
  }
  const lerpColor = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t;
    const g = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
    const bl = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
  };
  const shade = (hex, f) => f >= 0 ? lerpColor(hex, '#ffffff', f) : lerpColor(hex, '#10121c', -f);
  const rgba = (hex, a) => { const p = parseInt(hex.slice(1), 16); return 'rgba(' + ((p >> 16) & 255) + ',' + ((p >> 8) & 255) + ',' + (p & 255) + ',' + a + ')'; };

  /* ---------------- particles: one pool, under 300 ---------------- */
  const MAXP = 400;
  const parts = []; for (let i = 0; i < MAXP; i++) parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, ttl: 1, color: '#fff', size: 2, g: 0 });
  let pCursor = 0;
  function spawn(x, y, z, vx, vy, vz, ttl, color, size, g) {
    for (let i = 0; i < MAXP; i++) {
      const p = parts[(pCursor + i) % MAXP];
      if (!p.on) { pCursor = (pCursor + i + 1) % MAXP; p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.age = 0; p.ttl = ttl; p.color = color; p.size = size; p.g = g || 0; return p; }
    }
    return null;
  }
  function tickParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i]; if (!p.on) continue;
      p.age += dt; if (p.age >= p.ttl) { p.on = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt;
      if (p.z < 0) { p.z = 0; p.vz = 0; }
    }
  }
  function drawParticles(ctx) {
    const ps = PS();
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i]; if (!p.on) continue;
      const k = p.age / p.ttl, a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const s0 = toScreen(p.x, p.y, p.z), s = snap(s0.sx, s0.sy), sz = Math.max(1, Math.round(p.size * ps));
      ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(s.sx - sz / 2), Math.round(s.sy - sz / 2), sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- bubbles ---------------- */
  const BUB = { talk: { bg: '#141720', fg: '#f2efe6', edge: '#8a93a8' }, blocked: { bg: '#2a0d0d', fg: '#ff8c8c', edge: PAL.red },
                ask: { bg: '#2a1d06', fg: '#ffd27a', edge: PAL.amber }, card: { bg: '#0b1e2b', fg: '#9fe0ff', edge: PAL.blue } };
  const bubbles = [], bubbleQueue = [];
  function wrapText(text, width, maxLines) {
    const words = text.split(/\s+/).filter(Boolean), lines = []; let cur = '';
    for (const w of words) {
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= width) cur += ' ' + w; else { lines.push(cur); cur = w; }
      if (lines.length === maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].slice(0, width - 1) + '\u2026';
    return lines.length ? lines : [''];
  }
  function bubble(o) {
    const kind = BUB[o.kind] ? o.kind : 'talk', wide = kind === 'ask' || kind === 'blocked', raw = String(o.text || '').slice(0, wide ? 140 : 66);
    const b = { x: o.x, y: o.y, text: raw, lines: wrapText(raw, wide ? 24 : 22, wide ? 5 : 3), kind, ttl: o.ttl || T.bubbleTtlSec, age: 0, dead: false,
                moveTo(x, y) { this.x = x; this.y = y; return this; }, close() { this.dead = true; } };
    if (bubbles.length < 12) bubbles.push(b); else if (bubbleQueue.length < 24) bubbleQueue.push(b);
    return b;
  }
  function tickBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.age += dt; if (b.dead || b.age >= b.ttl) bubbles.splice(i, 1); }
    while (bubbles.length < 12 && bubbleQueue.length) bubbles.push(bubbleQueue.shift());
  }
  function drawBubbles(ctx) {
    ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const b of bubbles) {
      const k = b.kind, c = BUB[k];
      const fadeIn = Math.min(1, b.age / 0.25), fadeOut = Math.min(1, (b.ttl - b.age) / 0.4);
      const a = Math.max(0, Math.min(fadeIn, fadeOut));
      const s = snap(toScreen(b.x + 0.5, b.y + 1, 0).sx, toScreen(b.x + 0.5, b.y + 1, 0).sy), ps = PS(), tl = Math.round(6 * ps);
      let tw = 0; for (const ln of b.lines) tw = Math.max(tw, ctx.measureText(ln).width);
      const w = Math.ceil(tw) + 14, h = 6 + 16 * b.lines.length;
      const bob = Math.sin(b.age * 3) * 1.5;
      const x0 = Math.round(s.sx - w / 2), y0 = Math.round(s.sy - HEAD_PX * ps - 18 - h - tl + bob);   // tail 6 px (scaled) above the nameplate pill
      ctx.globalAlpha = a;
      ctx.fillStyle = c.edge; ctx.fillRect(x0 - 1, y0 + 2, w + 2, h - 4); ctx.fillRect(x0 + 2, y0 - 1, w - 4, h + 2);
      ctx.fillStyle = c.bg; ctx.fillRect(x0, y0 + 2, w, h - 4); ctx.fillRect(x0 + 2, y0, w - 4, h);
      // tail
      ctx.fillStyle = c.edge; for (let k = 0; k < 3; k++) { const hw = Math.max(1, Math.round((3 - k) * ps)); ctx.fillRect(Math.round(s.sx) - hw, y0 + h + Math.round(k * 2 * ps), hw * 2, Math.round(2 * ps)); }
      ctx.fillStyle = c.bg; ctx.fillRect(Math.round(s.sx) - 2, y0 + h - 1, 4, 2);
      ctx.fillStyle = c.fg; b.lines.forEach((ln, i) => ctx.fillText(ln, Math.round(s.sx), y0 + 11 + i * 16));
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- parcels ---------------- */
  const PARCEL_COLOR = { review: PAL.blue, verdict: PAL.green, closure: PAL.amber, merge: PAL.amber };
  const parcels = [], restTiles = new Map();
  let lastDepart = -10, parcelClock = 0;
  const tileKey = (x, y) => Math.floor(x) + ',' + Math.floor(y);
  const REST_SECONDS = 20 * 60, REST_SHOWN = 3;
  function isSeatTile(tx, ty) { for (const r of CONFIG.ROOMS) for (const k in (r.seats || {})) { const st = r.seats[k]; if (st.x === tx && st.y === ty) return true; } return false; }
  function seatInfo(memberKey) { for (const r of CONFIG.ROOMS) if (r.seats && r.seats[memberKey]) return { seat: r.seats[memberKey], room: r }; return null; }
  // slots along the receiver's desk row (the wall side of the seat), one per tile, nearest the desk first
  function deskSlot(memberKey) {
    let si = seatInfo(memberKey);
    if (!si && memberKey === 'inbox') { const b = roomOf('bridge'); const ib = inboxSpot(); if (b) si = { seat: { x: ib.x, y: ib.y + 1, face: 'north' }, room: b }; }
    if (!si) return null;
    const { seat, room } = si, row = seat.face === 'south' ? seat.y + 1 : seat.y - 1;
    for (const dx of [-1, 1, -2, 2, -3, 3, 0]) {
      const tx = seat.x + dx, ty = row;
      if (tx < room.x || tx >= room.x + room.w || ty < room.y || ty >= room.y + room.h) continue;
      if (isSeatTile(tx, ty) || restTiles.has(tileKey(tx, ty))) continue;
      return { x: tx + 0.5, y: ty + 0.5 };
    }
    return null;
  }
  // a parcel spawned without a receiver key (AGENTS calls FX.parcel with tiles) is grouped by the nearest seat to its destination
  function memberNearSeat(t) { if (!t) return null; let best = null, bd = 2.5; for (const r of CONFIG.ROOMS) for (const k in (r.seats || {})) { const st = r.seats[k]; const d = Math.hypot(st.x + 0.5 - t.x, st.y + 0.5 - t.y); if (d < bd) { bd = d; best = k; } } return best; }
  function restingFor(memberKey) { let n = 0; for (const q of parcels) if (q.done && q.to === memberKey) n++; return n; }
  function freeRestTile(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    const tries = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const d of tries) {
      const tx = cx + d[0], ty = cy + d[1];
      if (restTiles.has(tileKey(tx, ty)) || isSeatTile(tx, ty)) continue;
      try { if (typeof WORLD !== 'undefined' && WORLD.walkable && !WORLD.walkable(tx, ty)) continue; } catch (_) {}
      return { x: tx + 0.5, y: ty + 0.5 };
    }
    return { x: cx + 0.5, y: cy + 0.5 };
  }
  function parcel(o) {
    const path = pathBetween(o.from, o.to);
    let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const departAt = Math.max(parcelClock, lastDepart + 1.5); lastDepart = departAt;
    const p = { path, len, t: 0, dur: o.duration || Math.max(4, len / T.walkTilesPerSec), label: String(o.label || ''), kind: o.kind || 'review',
                fail: !!o.fail, warn: !!o.warn, done: false, rest: 0, x: path[0].x, y: path[0].y, z: 20, departAt, restAt: null, slide: 0, to: o.toKey || memberNearSeat(o.to) || null, hidden: false, extra: 0 };
    parcels.push(p); return p;
  }
  function posAlong(path, len, k) {
    let d = k * len;
    for (let i = 1; i < path.length; i++) {
      const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (d <= seg || i === path.length - 1) { const u = seg ? Math.min(1, d / seg) : 1; return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * u, y: path[i - 1].y + (path[i].y - path[i - 1].y) * u }; }
      d -= seg;
    }
    return path[path.length - 1];
  }
  function tickParcels(dt, moving) {
    parcelClock += dt;
    for (let i = parcels.length - 1; i >= 0; i--) {
      const p = parcels[i];
      if (!p.done) {
        if (moving && parcelClock >= p.departAt) p.t += dt / p.dur;
        if (p.t >= 1) {
          p.t = 1; p.done = true;
          const end = p.path[p.path.length - 1];
          const order = p.to ? restingFor(p.to) - 1 : 0;             // how many already rest at this receiver (this one is counted, hence -1)
          p.hidden = order >= REST_SHOWN;
          const r = (!p.hidden && p.to && deskSlot(p.to)) || freeRestTile(end.x, end.y);
          p.restAt = r; p.restKey = p.hidden ? null : tileKey(r.x, r.y); if (p.restKey) restTiles.set(p.restKey, true); p.fromX = end.x; p.fromY = end.y;
        }
        const q = posAlong(p.path, p.len, p.t); p.x = q.x; p.y = q.y;
        p.z = 20 + Math.sin(p.t * 40) * 3;
      } else {
        p.rest += dt;
        if (p.rest > REST_SECONDS) { if (p.restKey) restTiles.delete(p.restKey); parcels.splice(i, 1); continue; }
        p.slide = Math.min(1, p.slide + dt * 2);
        p.x = p.fromX + (p.restAt.x - p.fromX) * p.slide; p.y = p.fromY + (p.restAt.y - p.fromY) * p.slide;
        p.z = 6 + (1 - p.slide) * 14;
      }
    }
  }
  function updateExtras() {
    for (const p of parcels) p.extra = 0;
    const byTo = new Map();
    for (const p of parcels) { if (!p.done || !p.to) continue; if (!byTo.has(p.to)) byTo.set(p.to, { shown: null, hidden: 0 }); const e = byTo.get(p.to); if (p.hidden) e.hidden++; else e.shown = p; }
    for (const e of byTo.values()) if (e.shown && e.hidden) e.shown.extra = e.hidden;
  }
  /* Parcel art, non-essential: each file on its own; a missing one falls back to drawCrate. */
  const CRATE_ART = { size: 48, footX: 24, footY: 44, scale: 0.5 };
  const crateArt = {};
  for (const [k, file] of [['plain', 'parcel-crate.png'], ['flagged', 'parcel-crate-flagged.png'], ['notes', 'parcel-crate-notes.png']])
    LOADQ.image('assets/props/' + file).then(im => { if (im) crateArt[k] = im; });
  /* A small crate in hard pixels: dark outline, lit lid, two straps, a shaded right side. cx, bottom = its foot, cs = width. */
  function drawCrate(ctx, cx, bottom, cs, ps, fail) {
    const u = Math.max(1, Math.round(2 * ps)), x = cx - Math.round(cs / 2), y = bottom - cs;
    const body = fail ? '#7a3030' : '#7a5530', lid = fail ? '#a04848' : '#a87c46', side = fail ? '#5a2424' : '#5a3e24', strap = fail ? '#3a1818' : '#3a2a18';
    ctx.fillStyle = '#14100a'; ctx.fillRect(x - u, y - u, cs + 2 * u, cs + 2 * u);
    ctx.fillStyle = body; ctx.fillRect(x, y, cs, cs);
    ctx.fillStyle = lid; ctx.fillRect(x, y, cs, 2 * u);
    ctx.fillStyle = side; ctx.fillRect(x + cs - u, y + 2 * u, u, cs - 2 * u);
    ctx.fillStyle = strap; ctx.fillRect(x + 2 * u, y, u, cs); ctx.fillRect(x + cs - 3 * u, y, u, cs);
  }
  function drawParcel(ctx, p) {
    const ps = PS(), s0 = toScreen(p.x, p.y, 0), s = snap(s0.sx, s0.sy), col = p.fail ? PAL.red : p.warn ? PAL.amber : (PARCEL_COLOR[p.kind] || PAL.blue);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(s.sx, s.sy, 10 * ps, 5 * ps, 0, 0, Math.PI * 2); ctx.fill();
    const top = s.sy - Math.round(p.z * ps), cs = Math.round(16 * ps);
    const art = crateArt[p.fail ? 'flagged' : p.warn ? 'notes' : 'plain'];
    if (art) {   // nearest neighbour; the art's foot point lands where the drawn crate's foot goes
      const k = CRATE_ART.scale * ps, prevSmooth = ctx.imageSmoothingEnabled, size = Math.round(CRATE_ART.size * k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(art, Math.round(s.sx - CRATE_ART.footX * k), Math.round(top - CRATE_ART.footY * k), size, size);
      ctx.imageSmoothingEnabled = prevSmooth;
    } else drawCrate(ctx, Math.round(s.sx), Math.round(top), cs, ps, p.fail);
    // tag
    ctx.font = FONT_S; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.ceil(ctx.measureText(p.label).width) + 8;
    const ty = top - cs - 12;
    ctx.fillStyle = '#0d0f16'; ctx.fillRect(Math.round(s.sx - w / 2), Math.round(ty), w, 14);
    ctx.fillStyle = col; ctx.fillRect(Math.round(s.sx - w / 2), Math.round(ty), w, 1); ctx.fillRect(Math.round(s.sx - w / 2), Math.round(ty + 13), w, 1);
    ctx.fillText(p.label, Math.round(s.sx), Math.round(ty + 7));
    if (p.extra > 0) { const t = '+' + p.extra, tw = Math.ceil(ctx.measureText(t).width) + 6; ctx.fillStyle = '#0d0f16'; ctx.fillRect(Math.round(s.sx + w / 2) + 2, Math.round(ty), tw, 14); ctx.fillStyle = PAL.amber; ctx.fillText(t, Math.round(s.sx + w / 2) + 2 + tw / 2, Math.round(ty + 7)); }
  }

  /* ---------------- charging pads ---------------- */
  const pads = [];
  function initPads() {
    const prev = pads.slice();   // a rebuild keeps who is charging and the glow
    pads.length = 0;
    const r = roomOf('charging'); if (!r || !r.spots || !r.spots.pads) return;
    r.spots.pads.forEach((t, i) => pads.push({ i, x: t.x, y: t.y, on: prev[i] ? prev[i].on : false, heat: prev[i] ? prev[i].heat : 0, phase: i * 0.7 }));
  }
  function setCharging(i, on) { if (pads[i]) pads[i].on = !!on; }
  function drawPad(ctx, p, time) {
    const c = centre(p), s = toScreen(c.x, c.y, 0);
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.2 + p.phase);
    const a = 0.25 + 0.2 * pulse + p.heat * 0.5;
    ctx.strokeStyle = rgba(PAL.cyan, a); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(s.sx, s.sy, TW * 0.36, TH * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = rgba(PAL.cyan, 0.08 + p.heat * 0.25);
    ctx.beginPath(); ctx.ellipse(s.sx, s.sy, TW * 0.36, TH * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(PAL.cyan, 0.5 + 0.5 * pulse); ctx.fillRect(s.sx - 2, s.sy - 1, 4, 2);
  }

  /* ---------------- construction dock: block stacks, built block by block from the floor to full, then shipped off,
     drawn with the 64x48 iso block art in assets/blocks/ ---------------- */
  const BW = 2, BD_ = 2, BH = 5, BLOCKS = BW * BD_ * BH;      // 2 wide x 2 deep x 5 high = 20 blocks per epic, one tile each
  const BLK_W = 64, BLK_H = 32, BLK_Z = 16;                   // sprite: 64x48 = a 64x32 top diamond over 16 px side faces
  const modules = [];                                         // one per epic slot (x, y, w, h in tiles; pct; code ...)
  const stackState = new Map();                               // code -> persistent per-epic animation state
  const demoPct = new Map();
  let demoT = 20, shippedSet = new Set();
  try { const raw = sessionStorage.getItem('crewstation.fx.shipped'); if (raw) shippedSet = new Set(JSON.parse(raw)); } catch (_) { shippedSet = new Set(); }
  function rememberShipped(code) { shippedSet.add(code); try { sessionStorage.setItem('crewstation.fx.shipped', JSON.stringify(Array.from(shippedSet))); } catch (_) {} }

  // block index -> (bx, by, bz): floor layer first, then layer by layer, each layer row by row
  function blockPos(i) { const bz = Math.floor(i / (BW * BD_)), r = i % (BW * BD_); return { bx: r % BW, by: Math.floor(r / BW), bz }; }
  // painter's order inside a layer: back (small bx+by) to front; layers bottom to top
  const PAINT_ORDER = (() => { const o = []; for (let bz = 0; bz < BH; bz++) { const layer = []; for (let by = 0; by < BD_; by++) for (let bx = 0; bx < BW; bx++) layer.push(bz * BW * BD_ + by * BW + bx); layer.sort((a, b) => { const pa = blockPos(a), pb = blockPos(b); return (pa.bx + pa.by) - (pb.bx + pb.by) || pa.by - pb.by; }); o.push(...layer); } return o; })();

  /* block art: sprites, loaded once; procedural 64x48 cubes stand in until they arrive */
  const BLOCK_FILES = { hull: 'block-hull.png', window: 'block-hull-window.png', girder: 'block-girder.png', vent: 'block-vent.png', roof: 'block-roof.png',
                        roofDone: 'block-roof-done.png', crate: 'block-crate.png', ghost: 'block-ghost.png', hook: 'hook.png' };
  const blockArt = {}; let blockArtStarted = false;
  function loadBlockArt() {
    if (blockArtStarted) return; blockArtStarted = true;
    for (const k in BLOCK_FILES) { const im = new Image(); im.onload = () => { blockArt[k] = im; }; im.onerror = () => {}; im.src = 'assets/blocks/' + BLOCK_FILES[k]; }
  }
  const BLOCK_PAL = { top: '#4a4b55', left: '#23242f', right: '#3b3632', line: '#121318', rivetT: '#5e5f6b', rivetS: '#15161c',
                      pip: '#ffb84a', pipDim: '#7a4a10', build: '#ffb347', roof: '#6a5a3a', roofHi: '#a0803a' };
  const blockSprites = {};
  function makeBlock(variant) {   // 64x48 procedural stand-in, same geometry as the art
    const cv = document.createElement('canvas'); cv.width = BLK_W; cv.height = BLK_H + BLK_Z; const g = cv.getContext('2d');
    const poly = (pts, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill(); };
    const N = [32, 0], E = [64, 16], S = [32, 32], W = [0, 16], Eb = [64, 32], Sb = [32, 48], Wb = [0, 32];
    if (variant === 'glow') {
      g.strokeStyle = 'rgba(255,179,71,0.75)'; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 0.5); g.lineTo(63.5, 16); g.lineTo(32, 31.5); g.lineTo(0.5, 16); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(0.5, 16); g.lineTo(0.5, 32); g.lineTo(32, 47.5); g.lineTo(63.5, 32); g.lineTo(63.5, 16); g.moveTo(32, 31.5); g.lineTo(32, 47.5); g.stroke();
      poly([N, E, S, W], 'rgba(255,179,71,0.10)'); return cv;
    }
    if (variant === 'ghost') { g.strokeStyle = 'rgba(95,200,255,0.7)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(32, 0.5); g.lineTo(63.5, 16); g.lineTo(32, 31.5); g.lineTo(0.5, 16); g.closePath(); g.moveTo(0.5, 16); g.lineTo(0.5, 32); g.lineTo(32, 47.5); g.lineTo(63.5, 32); g.lineTo(63.5, 16); g.moveTo(32, 31.5); g.lineTo(32, 47.5); g.stroke(); poly([N, E, S, W], 'rgba(95,200,255,0.08)'); return cv; }
    poly([N, E, S, W], variant === 'roof' || variant === 'roofDone' ? BLOCK_PAL.roof : BLOCK_PAL.top);
    poly([W, S, Sb, Wb], BLOCK_PAL.left); poly([S, E, Eb, Sb], BLOCK_PAL.right);
    g.strokeStyle = BLOCK_PAL.line; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 0.5); g.lineTo(63.5, 16); g.lineTo(32, 31.5); g.lineTo(0.5, 16); g.closePath(); g.moveTo(0.5, 16); g.lineTo(0.5, 32); g.lineTo(32, 47.5); g.lineTo(63.5, 32); g.lineTo(63.5, 16); g.moveTo(32, 31.5); g.lineTo(32, 47.5); g.stroke();
    g.fillStyle = BLOCK_PAL.rivetT; g.fillRect(32, 6, 2, 2); g.fillRect(16, 16, 2, 2); g.fillRect(46, 16, 2, 2); g.fillRect(32, 26, 2, 2);
    if (variant === 'window') { g.fillStyle = BLOCK_PAL.pipDim; g.fillRect(10, 34, 10, 5); g.fillRect(42, 34, 10, 5); g.fillStyle = BLOCK_PAL.pip; g.fillRect(12, 35, 6, 3); g.fillRect(44, 35, 6, 3); }
    if (variant === 'girder') { g.clearRect(0, 0, 64, 48); g.strokeStyle = '#c86a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 1); g.lineTo(63, 16); g.lineTo(32, 31); g.lineTo(1, 16); g.closePath(); g.moveTo(1, 16); g.lineTo(1, 32); g.lineTo(32, 47); g.lineTo(63, 32); g.lineTo(63, 16); g.moveTo(32, 31); g.lineTo(32, 47); g.moveTo(1, 32); g.lineTo(32, 31); g.lineTo(63, 32); g.stroke(); }
    if (variant === 'roofDone') { g.fillStyle = PAL.green; g.fillRect(31, 10, 3, 3); }
    if (variant === 'crate') { g.fillStyle = '#6a4a2a'; poly([N, E, S, W], '#8a6a3a'); poly([W, S, Sb, Wb], '#5a3e22'); poly([S, E, Eb, Sb], '#6e4c2a'); }
    return cv;
  }
  function blockSprite(v) { if (blockArt[v]) return blockArt[v]; if (!blockSprites[v]) blockSprites[v] = makeBlock(v); return blockSprites[v]; }
  const hashI = (a, b, c) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function bodyRole(p, idx) { const h = hashI(p.bx + 1, p.by + 1, p.bz + 1 + idx * 7); return h < 0.25 ? 'window' : h < 0.35 ? 'vent' : 'hull'; }

  function epicPct(e) { let p = Math.max(0, Math.min(1, Number(e.pct) || 0)); if (demoPct.has(e.code)) p = Math.max(p, demoPct.get(e.code)); if (/^(done|complete|shipped)$/i.test(String(e.state || '').trim())) p = 1; return p; }
  function buildDock(model) {
    loadBlockArt();
    modules.length = 0;
    const r = roomOf('dock'); if (!r) return;
    const epics = (model && model.epics) || [];
    const cols = 3, mw = 2, mh = 2, gapX = 1, gapY = 1;
    epics.slice(0, 27).forEach((e, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = r.x + 1 + col * (mw + gapX), y = r.y + 1 + row * (mh + gapY);
      if (y + mh > r.y + r.h || x + mw > r.x + r.w) return;
      const pct = epicPct(e), target = Math.round(pct * BLOCKS);
      let st = stackState.get(e.code);
      if (!st) { st = { placed: target, flying: null, flyT: 0, flash: 0, completeSince: null, shipT: null, shipped: shippedSet.has(e.code), dustT: 0, sparkT: 2 + Math.random() * 6 }; stackState.set(e.code, st); }
      if (target < st.placed) { st.placed = target; st.flying = null; }   // a drop just removes blocks; a rise delivers them one by one
      modules.push({ code: e.code, name: e.name, pct, target, x, y, w: mw, h: mh, done: target >= BLOCKS, idx: i, st, color: r.accent });
    });
  }
  function tickDock(dt, reduced) {
    if (curModel && curModel.demo && modules.length) { demoT -= dt; if (demoT <= 0) { demoT = 20; for (let k = 0; k < 2; k++) { const m = modules[Math.floor(Math.random() * modules.length)]; demoPct.set(m.code, Math.min(1, epicPct({ code: m.code, pct: m.pct }) + 0.02)); } buildDock(curModel); } }
    for (const m of modules) {
      const st = m.st;
      if (st.shipped) continue;
      if (st.flash > 0) st.flash -= dt;
      if (st.dustT > 0) st.dustT -= dt;
      if (st.flying !== null) {
        st.flyT += dt / 0.8;
        if (st.flyT >= 1) {
          st.placed = st.flying + 1; st.flying = null; st.flash = 0.08;
          const p = blockPos(st.placed - 1), gx = m.x + p.bx + 0.5, gy = m.y + p.by + 0.5;
          if (!reduced) for (let i = 0; i < 10; i++) spawn(gx, gy, p.bz * BLK_Z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 6 + Math.random() * 10, 0.6 + Math.random() * 0.4, '#8a8478', 2, 20);
        }
      } else if (st.placed < m.target) { st.flying = st.placed; st.flyT = reduced ? 1 : 0; }
      if (st.placed >= BLOCKS && st.flying === null) {
        if (st.completeSince === null) st.completeSince = 0;
        st.completeSince += dt;
        if (st.shipT === null && st.completeSince > 60) { st.shipT = 0; st.dustT = 0.8; }
      } else { st.completeSince = null; }
      if (st.shipT !== null) { st.shipT += dt / 5; if (st.shipT >= 1) { st.shipT = null; st.shipped = true; rememberShipped(m.code); } }
      if (!reduced && st.placed > 0 && st.placed < BLOCKS && st.shipT === null) {
        st.sparkT -= dt;
        if (st.sparkT <= 0) { st.sparkT = 6 + Math.random() * 8; const p = blockPos(st.placed - 1); weldAt(m.x + p.bx + 0.5, m.y + p.by + 1, p.bz * BLK_Z + 8); st.flash = 0.06; }
      }
    }
  }
  function weldAt(x, y, z) {
    for (let i = 0; i < 10; i++) spawn(x, y, z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 30 + Math.random() * 50, 0.4 + Math.random() * 0.4, Math.random() < 0.3 ? '#fff6d8' : PAL.amber, 2, 160);
    for (let i = 0; i < 4; i++) spawn(x, y, z + 4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 10 + Math.random() * 8, 2 + Math.random() * 2, '#6e6a66', 3, -4);
  }
  const easeIn = t => t * t * t;
  // sprite top-left for the block whose footprint north corner is tile (m.x+bx, m.y+by) at height bz (plus extra px)
  function blockScreen(m, bx, by, bz, zExtra) { const t = toScreen(m.x + bx, m.y + by, bz * BLK_Z + BLK_Z + (zExtra || 0)); const q = snap(t.sx - BLK_W / 2, t.sy); return { sx: q.sx, sy: q.sy }; }
  function roleFor(m, i, placed, complete) {
    const p = blockPos(i);
    if (complete && p.bz === BH - 1) return (p.bx === BW - 1 && p.by === BD_ - 1) ? 'roofDone' : 'roof';
    const topLayer = Math.floor((placed - 1) / (BW * BD_)), layerFull = placed % (BW * BD_) === 0;
    if (!complete && p.bz === topLayer && !layerFull) return 'girder';           // the layer still being built is scaffold
    return bodyRole(p, m.idx);
  }
  /* Epic caption: the dock stack under world point (wx, wy), front-most first: its tile diamond or the screen
     rect of its stack (blocks + the label above), or null. */
  function hitTestModule(wx, wy) {
    const order = modules.slice().sort((a, b) => (b.x + b.y + b.w + b.h) - (a.x + a.y + a.w + a.h));
    const t = ISO.fromScreen(wx, wy);
    for (const m of order) if (t.x >= m.x && t.x < m.x + m.w && t.y >= m.y && t.y < m.y + m.h) return m;   // its floor slot first
    for (const m of order) {
      const L = toScreen(m.x, m.y + m.h, 0), R = toScreen(m.x + m.w, m.y, 0), N = toScreen(m.x, m.y, 0), S = toScreen(m.x + m.w, m.y + m.h, 0);
      const layers = Math.ceil(((m.st && !m.st.shipped) ? m.st.placed : 0) / (BW * BD_)), top = N.sy - layers * BLK_Z - 58;
      if (wx >= L.sx && wx <= R.sx && wy >= top && wy <= S.sy) return m;
    }
    return null;
  }
  /* The HUD caption for a dock stack: the epic from BOARD.model (board.js deriveEpics) and its open cards from BOARD.raw. */
  function moduleCaption(m, model) {
    const e = ((model && model.epics) || []).find(q => q.code === m.code) || { code: m.code, name: m.name, cards: [], columns: {} };
    const mem = k => (k && CONFIG.MEMBERS[k] && CONFIG.MEMBERS[k].name) || (k === 'owner' ? 'Owner' : k) || '';
    const cols = ['Done', 'In review', 'Next 24h', 'Blocked/Waiting', 'Backlog'].filter(c => e.columns && e.columns[c]).map(c => c + ' ' + e.columns[c]).join(' · ');
    const raw = (typeof BOARD !== 'undefined' && BOARD.raw && BOARD.raw.cards) || [], byCode = new Map(raw.map(c => [c.code, c]));
    const open = (e.cards || []).map(c => byCode.get(c)).filter(c => c && c.column !== 'Done')
      .sort((a, b) => String(b.status_date || '').localeCompare(String(a.status_date || '')));
    const short = t => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, '') + '...' : t; };
    const lines = [e.goal || null, e.doneWhen ? { label: 'Done when:', text: e.doneWhen } : null,
      (e.done || 0) + '/' + (e.total || 0) + ' cards (' + Math.round((e.pct || 0) * 100) + '%)' + (cols ? ' · ' + cols : ''),
      e.note && e.note !== e.state ? e.note : (e.note || null)];
    for (const c of open.slice(0, 6)) lines.push({ label: c.code, text: short(c.plain || c.title) + (c.queue ? ' (' + mem(c.queue) + ')' : '') });
    if (open.length > 6) lines.push('+' + (open.length - 6) + ' more');
    return { title: e.code + (e.name ? ' · ' + e.name : ''), subtitle: [e.owner ? mem(e.owner) : null, e.targetText ? 'target ' + e.targetText : null].filter(Boolean).join(' · '), lines };
  }
  function drawStack(ctx, m, time) {
    const st = m.st;
    const base = toScreen(m.x + m.w / 2, m.y + m.h / 2, 0);
    if (st.shipped) {   // chalk outline of the slot and a small 'delivered' plaque
      const c = [toScreen(m.x + 0.25, m.y + 0.25, 0), toScreen(m.x + m.w - 0.25, m.y + 0.25, 0), toScreen(m.x + m.w - 0.25, m.y + m.h - 0.25, 0), toScreen(m.x + 0.25, m.y + m.h - 0.25, 0)];
      ctx.strokeStyle = 'rgba(220,214,190,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(c[0].sx, c[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].sx, c[i].sy); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#1c1e24'; ctx.fillRect(Math.round(base.sx) - 9, Math.round(base.sy) - 7, 18, 8);
      ctx.fillStyle = '#3a3d46'; ctx.fillRect(Math.round(base.sx) - 9, Math.round(base.sy) - 7, 18, 1);
      ctx.fillStyle = rgba(PAL.green, 0.7 + 0.3 * Math.sin(time * 2 + m.idx)); ctx.fillRect(Math.round(base.sx) - 1, Math.round(base.sy) - 5, 3, 3);
      return;
    }
    let lift = 0, alpha = 1;
    if (st.shipT !== null) { const k = easeIn(st.shipT); lift = k * 300; alpha = st.shipT > 0.7 ? Math.max(0, 1 - (st.shipT - 0.7) / 0.3) : 1; }
    ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * alpha * (1 - lift / 400)).toFixed(2) + ')';
    const c0 = [toScreen(m.x, m.y, 0), toScreen(m.x + m.w, m.y, 0), toScreen(m.x + m.w, m.y + m.h, 0), toScreen(m.x, m.y + m.h, 0)];
    ctx.beginPath(); ctx.moveTo(c0[0].sx, c0[0].sy + 2); ctx.lineTo(c0[1].sx + 3, c0[1].sy + 2); ctx.lineTo(c0[2].sx, c0[2].sy + 4); ctx.lineTo(c0[3].sx - 3, c0[3].sy + 2); ctx.closePath(); ctx.fill();
    if (st.shipT !== null) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gy = base.sy - lift + 4;
      for (const stp of [[1, 0.1], [0.66, 0.12], [0.36, 0.2]]) { ctx.fillStyle = rgba(PAL.blue, stp[1] * alpha); ctx.beginPath(); ctx.ellipse(base.sx, gy, Math.round(56 * stp[0]), Math.round(26 * stp[0]), 0, 0, Math.PI * 2); ctx.fill(); }
      if (st.dustT > 0) { const u = 1 - st.dustT / 0.8; ctx.strokeStyle = rgba('#d8d0b8', 0.5 * (1 - u)); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(base.sx, base.sy, 40 + u * 90, 20 + u * 45, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    ctx.globalAlpha = alpha;
    const placed = st.placed, buildFrom = Math.max(0, placed - 1), complete = placed >= BLOCKS, building = !complete && st.shipT === null;   // only the freshly placed block glows
    const glow = blockSprite('glow'), ghost = blockSprite('ghost');
    for (const i of PAINT_ORDER) {
      const p = blockPos(i);
      if (i < placed) {
        const q = blockScreen(m, p.bx, p.by, p.bz, lift);
        ctx.drawImage(blockSprite(roleFor(m, i, placed, complete)), q.sx, q.sy);
        if (i >= buildFrom && building) ctx.drawImage(glow, q.sx, q.sy);
      } else if (building && i !== st.flying && i < placed + 3 + (st.flying !== null ? 1 : 0)) {
        const q = blockScreen(m, p.bx, p.by, p.bz, 0);               // ghosts hint the finished silhouette
        ctx.globalAlpha = alpha * 0.8; ctx.drawImage(ghost, q.sx, q.sy); ctx.globalAlpha = alpha;
      }
    }
    if (st.flash > 0) { ctx.fillStyle = 'rgba(255,250,230,' + Math.min(0.6, st.flash * 6).toFixed(2) + ')'; const p = blockPos(Math.max(0, placed - 1)); const q = blockScreen(m, p.bx, p.by, p.bz, lift); ctx.beginPath(); ctx.moveTo(q.sx + 32, q.sy); ctx.lineTo(q.sx + 64, q.sy + 16); ctx.lineTo(q.sx + 64, q.sy + 32); ctx.lineTo(q.sx + 32, q.sy + 48); ctx.lineTo(q.sx, q.sy + 32); ctx.lineTo(q.sx, q.sy + 16); ctx.closePath(); ctx.fill(); }
    // supply crates beside a stack under construction (what is still to come, 1-3)
    if (building) {
      const n = Math.max(1, Math.min(3, Math.ceil((1 - m.pct) * 3))), crate = blockSprite('crate');
      for (let k = 0; k < n; k++) { const q = blockScreen(m, m.w, m.h - 1, k, 0); ctx.drawImage(crate, q.sx, q.sy); }
    }
    // the block being delivered: descends from crane height on a cable with the hook
    if (st.flying !== null && st.flyT < 1) {
      const p = blockPos(st.flying), topZ = Math.ceil(placed / (BW * BD_)) * BLK_Z, from = topZ + 120, k = easeIn(Math.min(1, st.flyT));
      const zNow = from + (p.bz * BLK_Z - from) * k - p.bz * BLK_Z;
      const q = blockScreen(m, p.bx, p.by, p.bz, zNow);
      const r = roomOf('dock'), cableTop = r ? toScreen(m.x + p.bx + 0.5, r.y, 0).sy - 150 : q.sy - 200;
      const cx = q.sx + BLK_W / 2;
      ctx.strokeStyle = '#8a8070'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + 0.5, cableTop); ctx.lineTo(cx + 0.5, q.sy - 40); ctx.stroke();
      const hook = blockArt.hook; if (hook) ctx.drawImage(hook, Math.round(cx - 8), q.sy - 46); else { ctx.fillStyle = '#c9a23a'; ctx.fillRect(cx - 2, q.sy - 6, 5, 6); }
      ctx.drawImage(blockSprite(bodyRole(p, m.idx)), q.sx, q.sy); ctx.drawImage(glow, q.sx, q.sy);
    }
    ctx.globalAlpha = 1;
  }
  function drawModuleLabel(ctx, m) {
    if (m.st && m.st.shipped) return;
    // floating tag above the stack's current height, so the row in front never covers it
    const layers = Math.ceil((m.st ? m.st.placed : m.target) / (BW * BD_)), lift = (m.st && m.st.shipT !== null) ? easeIn(m.st.shipT) * 300 : 0;
    const lc0 = toScreen(m.x + m.w / 2, m.y + m.h / 2, layers * BLK_Z + 40 + lift), lc = { sx: lc0.sx, sy: lc0.sy - 18 };
    ctx.font = FONT_S; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const txt = m.code + ' ' + Math.round(m.pct * 100) + '%';
    const w = Math.ceil(ctx.measureText(txt).width) + 8;
    ctx.fillStyle = 'rgba(11,11,16,0.85)'; ctx.fillRect(Math.round(lc.sx - w / 2), lc.sy + 4, w, 14);
    ctx.fillStyle = m.done ? PAL.green : PAL.amber; ctx.fillText(txt, Math.round(lc.sx), lc.sy + 5);
  }

  /* ---------------- shuttle (glow only) ---------------- */
  const shuttle = { x: 0, y: 0, anim: -1, phase: 0 };
  function initShuttle() { const r = roomOf('pad'); if (r && r.spots && r.spots.shuttle) { shuttle.x = r.spots.shuttle.x; shuttle.y = r.spots.shuttle.y; } }
  function drawShuttleGlow(ctx, time) {
    const c = toScreen(shuttle.x + 0.5, shuttle.y + 0.5, 0);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    let lift = 0, dust = 0;
    if (shuttle.anim >= 0) { const k = shuttle.anim / 20; lift = Math.sin(k * Math.PI); dust = k < 0.15 ? k / 0.15 : (k > 0.85 ? (1 - k) / 0.15 : 0); }
    // landing light ring
    ctx.strokeStyle = rgba(PAL.amber, 0.3 + 0.4 * pulse); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(c.sx, c.sy, TW * 1.2, TH * 1.2, 0, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, on = ((time / 1.5 + i) % 8) < 1.2; ctx.fillStyle = on ? PAL.amber : PAL.amberDim; ctx.fillRect(Math.round(c.sx + Math.cos(a) * TW * 1.2) - 2, Math.round(c.sy + Math.sin(a) * TH * 1.2) - 1, 4, 2); }
    // thruster glow
    const g = ctx.createRadialGradient(c.sx, c.sy, 2, c.sx, c.sy, 40 + lift * 30);
    g.addColorStop(0, rgba(PAL.blue, 0.55 + lift * 0.4)); g.addColorStop(0.5, rgba(PAL.blue, 0.18 + lift * 0.2)); g.addColorStop(1, rgba(PAL.blue, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c.sx, c.sy, 44 + lift * 30, 22 + lift * 15, 0, 0, Math.PI * 2); ctx.fill();
    if (dust > 0) { ctx.strokeStyle = rgba('#d8d0b8', 0.5 * dust); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(c.sx, c.sy, 30 + (1 - dust) * 90, 15 + (1 - dust) * 45, 0, 0, Math.PI * 2); ctx.stroke(); }
  }

  /* ---------------- markers ---------------- */
  const markers = [];
  // 'ask' (waiting on you) draws nothing: the nameplate glyph and the bubble already say it.
  // The call still returns a handle so callers need not change.
  function marker(x, y, kind) { const m = { x, y, kind, age: 0, dead: false }; if (kind !== 'ask') markers.push(m); return m; }
  function clearMarker(h) { if (h) h.dead = true; }
  function nearestDoorPoint(x, y) {
    const rk = (typeof WORLD !== 'undefined' && WORLD.roomAt) ? WORLD.roomAt(Math.floor(x), Math.floor(y)) : null;
    const r = rk ? roomOf(rk) : CONFIG.ROOMS.find(r => r.kind === 'room' && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    if (!r) return { x: x + 3, y };
    let best = null, bd = 1e9;
    for (const d of CONFIG.DOORS) {
      if (d.room !== r.key) continue;
      const p = d.side === 'N' ? { x: r.x + d.at + d.width / 2, y: r.y } : d.side === 'S' ? { x: r.x + d.at + d.width / 2, y: r.y + r.h }
              : d.side === 'W' ? { x: r.x, y: r.y + d.at + d.width / 2 } : { x: r.x + r.w, y: r.y + d.at + d.width / 2 };
      const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = p; }
    }
    return best || { x: x + 3, y };
  }
  function drawMarker(ctx, m, time) {
    const ps = PS();
    if (m.kind === 'blocked') {
      const a0 = toScreen(m.x + 0.5, m.y + 0.5, 0), a = snap(a0.sx, a0.sy), dp = nearestDoorPoint(m.x + 0.5, m.y + 0.5), b0 = toScreen(dp.x, dp.y, 0), b = snap(b0.sx, b0.sy);
      const n = Math.max(3, Math.round(Math.hypot(b.sx - a.sx, b.sy - a.sy) / (10 * ps))), blink = 0.55 + 0.45 * Math.sin(time * 4), lw = Math.round(6 * ps), lh = Math.round(4 * ps);
      for (let i = 0; i <= n; i++) {
        const u = i / n, px = a.sx + (b.sx - a.sx) * u, py = a.sy + (b.sy - a.sy) * u;
        ctx.fillStyle = i % 2 ? rgba(PAL.red, blink) : rgba('#7a2020', 0.9);
        ctx.fillRect(Math.round(px - lw / 2), Math.round(py - lh / 2), lw, lh);
      }
      const bs = Math.round(10 * ps), bi = Math.round(6 * ps);
      ctx.fillStyle = rgba(PAL.red, blink); ctx.fillRect(Math.round(b.sx - bs / 2), Math.round(b.sy - bs / 2), bs, bs);
      ctx.fillStyle = '#1a0a0a'; ctx.fillRect(Math.round(b.sx - bi / 2), Math.round(b.sy - bi / 2), bi, bi);
    }
  }

  /* ---------------- ambient ---------------- */
  let steamT = 0, moteT = 0;
  function tickAmbient(dt, reduced) {
    if (reduced) return;
    const gh = roomOf('lounge'), re = roomOf('reactor');
    moteT += dt;
    if (gh && moteT > 0.35) { moteT = 0; spawn(gh.x + 0.5 + Math.random() * (gh.w - 1), gh.y + 0.5 + Math.random() * (gh.h - 1), 10 + Math.random() * 30, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 4 + Math.random() * 6, 5 + Math.random() * 4, Math.random() < 0.5 ? PAL.green : '#d8ffb0', 2, 0); }
    steamT += dt;
    if (re && re.spots && re.spots.core && steamT > 6) {
      steamT = 0; const c = re.spots.core;
      for (let i = 0; i < 10; i++) spawn(c.x + 0.5 + (Math.random() - 0.5) * 0.4, c.y + 0.5 + (Math.random() - 0.5) * 0.4, 60 + Math.random() * 20, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 25 + Math.random() * 20, 2.5 + Math.random() * 1.5, '#c8d8e8', 3, 0);
    }
  }

  /* ---------------- events -> parcels ---------------- */
  const shownEvents = new Set();
  function seatOf(memberKey) {
    for (const r of CONFIG.ROOMS) if (r.seats && r.seats[memberKey]) return { x: r.seats[memberKey].x, y: r.seats[memberKey].y };
    const m = CONFIG.MEMBERS[memberKey]; const r = m && roomOf(m.room);
    return r ? { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) } : null;
  }
  function inboxSpot() { const b = roomOf('bridge'); return b && b.spots && b.spots.inbox ? b.spots.inbox : (b ? { x: b.x + 5, y: b.y + 3 } : { x: 18, y: 3 }); }
  function shortCode(code) { code = String(code || ''); if (code.length <= 14) return code; return code.slice(0, 5) + '…' + code.slice(-2); }
  function parcelLabel(e) {
    const card = shortCode(e.card);
    if (e.kind === 'handoff') return (card + ' review').trim();
    if (e.kind === 'verdict') { const v = String(e.verdict || '').toUpperCase(); const short = /REJECTED/.test(v) ? 'REJECTED' : /NOTES/.test(v) ? 'NOTES' : /APPROVED/.test(v) ? 'APPROVED' : ''; return (card + ' ' + short).trim(); }
    if (e.kind === 'closure') return (card + ' closed').trim();
    if (e.kind === 'merge') { const m = /#\s?(\d+)/.exec((e.label || '') + ' ' + (e.proof || '')); return m ? 'merged #' + m[1] : (card ? card + ' merged' : 'merged'); }
    return (e.label || card || e.kind);
  }
  function spawnEventParcels(model) {
    if (!model || !model.events || model.stale) return;
    for (const e of model.events) {
      if (!(e.ageMinutes < T.handoffWindowMinutes)) continue;
      if (!['handoff', 'verdict', 'closure', 'merge'].includes(e.kind)) continue;
      const id = e.kind + '|' + (e.card || '') + '|' + (e.when instanceof Date ? e.when.getTime() : String(e.when));
      if (shownEvents.has(id)) continue;
      const from = e.from ? seatOf(e.from) : inboxSpot();
      const to = (e.kind === 'closure' || e.kind === 'merge') ? inboxSpot() : (e.to ? seatOf(e.to) : inboxSpot());
      if (!from || !to) continue;
      shownEvents.add(id);
      const fail = e.kind === 'verdict' && /REJECTED/i.test(e.verdict || ''), warn = e.kind === 'verdict' && /NOTES/i.test(e.verdict || '');
      parcel({ from: centre(from), to: centre(to), label: parcelLabel(e), kind: e.kind === 'handoff' ? 'review' : e.kind, fail, warn, toKey: (e.kind === 'closure' || e.kind === 'merge') ? 'inbox' : (e.to || null) });
      if (e.kind === 'merge' || (e.from === CONFIG.ROLES.visitor || e.to === CONFIG.ROLES.visitor)) shuttle.anim = 0;
    }
    const visitor = model.members && model.members[CONFIG.ROLES.visitor], recentVisitor = visitor && visitor.minutesSinceRun != null && visitor.minutesSinceRun < 15;
    if (recentVisitor && shuttle.anim < 0 && !shuttle.playedVisitor) { shuttle.anim = 0; shuttle.playedVisitor = true; }
  }


  /* ---------------- ambient life and light ---------------- */
  const SODIUM = '#ff7a10', SMOKE = '#6e6a66';
  const rooms = () => CONFIG.ROOMS.filter(r => r.kind === 'room');
  const deskGlows = [], hallLamps = [], growBars = [], padStrip = [];
  let hallLampsScanned = false;
  const holo = { x: 15.5, y: 6, on: true, room: 'bridge' };
  const reactor = { x: 18.5, y: 37.5, arcT: 1.5, arcs: [], arcLife: 0, ventT: 2, vent: { x: 21.5, y: 33.3 } };
  const fab = { x: 19, y: 23.3, t: 1 };
  const buzz = { x: 11.5, y: 9.5, on: true, t: 0 };
  const crane = { t: 0 }, sky = { starT: 20, star: null, satT: 90, sat: null }, mist = { t: 12 }, dust = { t: 0 };
  let noiseSeed = 1;
  const noise = () => { noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0; return noiseSeed / 4294967296; };
  function fillDiamond(ctx, x0, y0, x1, y1, z) {
    z = z || 0; const c = [toScreen(x0, y0, z), toScreen(x1, y0, z), toScreen(x1, y1, z), toScreen(x0, y1, z)];
    ctx.beginPath(); ctx.moveTo(c[0].sx, c[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].sx, c[i].sy); ctx.closePath(); ctx.fill();
  }
  // three flat concentric steps (outer 0.28a, middle 0.56a, core 1.0a with additive overlap): pixel pools, not fog
  const GLOW_STEPS = [[1.0, 0.28], [0.66, 0.28], [0.36, 0.44]];
  function glow(ctx, sx, sy, rx, ry, color, a) {
    if (a <= 0) return;
    for (const st of GLOW_STEPS) { ctx.fillStyle = rgba(color, a * st[1]); ctx.beginPath(); ctx.ellipse(Math.round(sx), Math.round(sy), Math.round(rx * st[0]), Math.max(1, Math.round(ry * st[0])), 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function initLife() {
    deskGlows.length = 0; padStrip.length = 0;
    hallLamps.length = 0; hallLampsScanned = false;
    // Every light is tied to a graphic source: no free-floating corner-lamp glows (the
    // room tiles paint their own lamps).
    for (const r of rooms()) {
      for (const k in (r.seats || {})) {
        // the desk screen is the source: a small pool that leaves the desk tile and spills onto the seat tile
        const st = r.seats[k], b = BD();
        let desk = (b && b.deskTileOf) ? b.deskTileOf(k) : null;
        if (!desk) desk = { x: st.x, y: st.y - 1 };
        if (desk.x === st.x && desk.y === st.y) continue;   // no desk (the Garden couch): no screen, no glow
        let dx = Math.sign(st.x - desk.x), dy = Math.sign(st.y - desk.y);
        if (Math.abs(st.x - desk.x) + Math.abs(st.y - desk.y) !== 1) { dx = 0; dy = 1; }   // not adjacent: spill south
        deskGlows.push({ dx: desk.x, dy: desk.y, sx: dx, sy: dy, phase: Math.random() * 6, accent: PAL.blue, member: k });
      }
    }
    // grow lamps over the beds only: in tiles mode the Garden art paints its own magenta grow bars over the planters,
    // so FX only adds their light at the painted bars (found in lounge.png)
    const bdx = BD(), lt = bdx && bdx.tiles && bdx.tiles.lounge;
    growBars.length = 0;
    if (lt && lt.img && lt.A) scanGrowBars(lt);
    const pad = roomOf('pad'); if (pad) for (let x = pad.x + 0.5; x < pad.x + pad.w; x += 1) padStrip.push({ x, y: pad.y + pad.h - 0.5 });
    // holotable glow: at the room spot 'holotable' (the globe hero's footprint); no such spot, no glow
    { const hr = rooms().find(r => r.spots && r.spots.holotable); holo.on = true;
      if (hr) { const hs = hr.spots.holotable; holo.room = hr.key; holo.x = hs.x + 0.5 + ((hs.w || 1) - 1) / 2; holo.y = hs.y + 0.5 + ((hs.h || 1) - 1) / 2; }
      else holo.on = false; }
    const re = roomOf('reactor'); if (re) { if (re.spots && re.spots.core) { reactor.x = re.spots.core.x + 0.5; reactor.y = re.spots.core.y + 0.5; } reactor.vent = { x: re.x + 8.5, y: re.y + 0.3 }; }
    const ws = roomOf('workshop'); if (ws) { const fs0 = ws.spots && ws.spots.fabricator; if (fs0) { fab.x = fs0.x + 0.5; fab.y = fs0.y + 0.3; } else { fab.x = ws.x + 6; fab.y = ws.y + 1.3; } }
    fab.on = !!(ws && ws.spots && ws.spots.fabricator);
    const cv = roomOf('corr_va'), ch = roomOf('corr_h0'); if (cv && ch) { buzz.x = cv.x + cv.w / 2; buzz.y = ch.y + ch.h / 2; }
  }
  /* Hall edge lamps: the amber lamp heads painted on the hall rails. Measured from the hall pieces themselves
     (corridor-x / -y: three lamps per rail, at the piece ends and middle, one every ~2 tiles, ~12 px up on the rail;
     the crossings and sealed ends carry none), placed the way BACKDROP lays the pieces (a 6-tile piece every 5
     tiles), and kept only where the composited hall layer still shows the lamp (room tiles cut the hall layer). Each gets a small halo on the head and a pool on the deck inward. */
  const CORR_STEP = 5, CORR_UNDER = 0.5, CORR_JOIN = 0.6, LAMP_Z = 12;   // mirror BACKDROP's hall layout constants
  const isLampPx = (d, i) => d[i + 3] > 200 && d[i] > 230 && d[i + 1] > 150 && d[i + 2] < 120;
  function pieceLamps(piece) {   // lamp heads in a piece: world px offsets from the piece's grid origin + the rail's inward direction
    if (piece._lamps) return piece._lamps;
    const im = piece.img, cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    let d; try { d = g.getImageData(0, 0, im.width, im.height).data; } catch (_) { return (piece._lamps = []); }
    const cl = [];
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      if (!isLampPx(d, (y * im.width + x) * 4)) continue;
      let c = cl.find(c => Math.abs(c.x / c.n - x) < 8 && Math.abs(c.y / c.n - y) < 8); if (!c) { c = { x: 0, y: 0, n: 0 }; cl.push(c); } c.x += x; c.y += y; c.n++;
    }
    const A = piece.A, out = [];
    for (const c of cl) {
      if (c.n < 6) continue;
      const px = c.x / c.n, py = c.y / c.n, wx = A.a * px + A.c * py + A.e, wy = A.b * px + A.d * py + A.f;
      const f = ISO.fromScreen(wx, wy + LAMP_Z);                       // the lamp's foot, in piece tiles
      // straight pieces only: a lamp sits on one of the two LONG rails; anything else (mid-floor and end stripes) is paint
      const onX = piece.w > piece.h, across = onX ? Math.min(Math.abs(f.y), Math.abs(f.y - piece.h)) : Math.min(Math.abs(f.x), Math.abs(f.x - piece.w));
      if (across > 0.35) continue;
      const inx = onX ? 0 : (Math.abs(f.x) < Math.abs(f.x - piece.w) ? 1 : -1), iny = onX ? (Math.abs(f.y) < Math.abs(f.y - piece.h) ? 1 : -1) : 0;
      out.push({ wx, wy, fx: f.x, fy: f.y, inx, iny });
    }
    return (piece._lamps = out);
  }
  function scanHallLamps() {
    hallLampsScanned = true;
    const b = BD(), C = b && b.tilesMode && b.tilesMode() && b.corridors, L = C && C.layer, plan = C && C.plan;
    if (!L || !L.canvas || !plan || !C.pieces) return;
    let data; try { data = L.canvas.getContext('2d').getImageData(0, 0, L.canvas.width, L.canvas.height).data; } catch (_) { return; }
    const LW = L.canvas.width, LH = L.canvas.height, kx = LW / L.w, ky = LH / L.h;
    const shows = (wx, wy) => {   // a lamp pixel within 3 px of the head in the composited hall layer
      const cx = Math.round((wx - L.x) * kx), cy = Math.round((wy - L.y) * ky);
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && y >= 0 && x < LW && y < LH && isLampPx(data, (y * LW + x) * 4)) return true;
      return false;
    };
    const add = (piece, gx, gy) => {
      if (!piece) return;
      const ox = (gx - gy) * TW / 2, oy = (gx + gy) * TH / 2;
      for (const l of pieceLamps(piece)) {
        const hx = l.wx + ox, hy = l.wy + oy;
        if (!shows(hx, hy) || hallLamps.some(o => Math.abs(o.hx - hx) < 8 && Math.abs(o.hy - hy) < 8)) continue;
        const f = toScreen(gx + l.fx + l.inx * 0.5, gy + l.fy + l.iny * 0.5, 0);
        if (hallLamps.length < 300) hallLamps.push({ hx, hy, fx: f.sx, fy: f.sy });
      }
    };
    const P = C.pieces;
    for (const run of plan.runs) {
      const pass = run.dir, piece = P[pass]; if (!piece) continue;
      const lo = pass === 'x' ? run.x : run.y, hi = lo + (pass === 'x' ? run.w : run.h), Lp = pass === 'x' ? piece.w : piece.h;
      const atX = v => plan.crosses.some(c => pass === 'x' ? (c.y === run.y && (c.x === v || c.x + c.w === v)) : (c.x === run.x && (c.y === v || c.y + c.h === v)));
      const jLo = run.joinLo && !atX(lo) ? CORR_JOIN : 0, jHi = run.joinHi && !atX(hi) ? CORR_JOIN : 0;
      const u0 = atX(lo) ? CORR_UNDER : jLo, u1 = atX(hi) ? CORR_UNDER : jHi;
      const eLo = run.endLo ? P[pass === 'x' ? 'end-w' : 'end-n'] : null, eHi = run.endHi ? P[pass === 'x' ? 'end-e' : 'end-s'] : null;
      const a = eLo ? lo + eLo[pass === 'x' ? 'w' : 'h'] - 1 : lo - u0, e = eHi ? hi - eHi[pass === 'x' ? 'w' : 'h'] + 1 : hi + u1;
      for (let s = a, n = 0; n < 40; s += CORR_STEP, n++) { add(piece, pass === 'x' ? s : run.x, pass === 'x' ? run.y : s); if (s + Lp >= e) break; }
    }
    console.log('fx: ' + hallLamps.length + ' painted hall lamps found');
  }
  function scanGrowBars(t) {
    const im = t.img, cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    let d; try { d = g.getImageData(0, 0, im.width, im.height).data; } catch (_) { return; }
    const cl = [];
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const i = (y * im.width + x) * 4; if (d[i + 3] < 200 || d[i] < 190 || d[i + 1] > 170 || d[i + 2] < 160) continue;
      let c = cl.find(c => Math.abs(c.x / c.n - x) < 30 && Math.abs(c.y / c.n - y) < 16); if (!c) { c = { x: 0, y: 0, n: 0 }; cl.push(c); } c.x += x; c.y += y; c.n++;
    }
    const A = t.A;
    for (const c of cl) { if (c.n < 10) continue; const px = c.x / c.n, py = c.y / c.n; growBars.push({ sx: A.a * px + A.c * py + A.e, sy: A.b * px + A.d * py + A.f, n: c.n }); }
  }
  function stationBounds() {
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const r of CONFIG.ROOMS) for (const p of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) { const s = toScreen(p[0], p[1], 0); minx = Math.min(minx, s.sx); maxx = Math.max(maxx, s.sx); miny = Math.min(miny, s.sy); maxy = Math.max(maxy, s.sy); }
    return { minx, maxx, miny, maxy };
  }
  function puff(x, y, z, n, color, size, spread, rise, ttl) {
    for (let i = 0; i < n; i++) spawn(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + Math.random() * 6, (Math.random() - 0.5) * 0.5 + 0.15, (Math.random() - 0.5) * 0.5 - 0.15, rise * (0.7 + Math.random() * 0.6), ttl * (0.7 + Math.random() * 0.6), color, size, -3);
  }
  function tickLife(dt, reduced) {
    if (reduced) return;
    // unreliable lamps: flaky corner lamps sag and jump; one corridor lamp buzzes on and off
    buzz.t -= dt; if (buzz.t <= 0) { buzz.on = !buzz.on; buzz.t = buzz.on ? 0.3 + noise() * 3 : 0.05 + noise() * 0.6; }
    // dust in every lit pool
    dust.t -= dt;
    if (dust.t <= 0 && deskGlows.length) { dust.t = 0.25; const g = deskGlows[Math.floor(Math.random() * deskGlows.length)]; spawn(g.dx + 0.5 + g.sx * 0.9 + (Math.random() - 0.5) * 0.8, g.dy + 0.5 + g.sy * 0.9 + (Math.random() - 0.5) * 0.8, 4 + Math.random() * 40, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 4, 5 + Math.random() * 5, '#d8cfb8', 1, 0); }
    // reactor arcs, sparks, vent
    reactor.arcT -= dt;
    if (reactor.arcT <= 0) {
      reactor.arcT = 2.2 + Math.random() * 1.6; reactor.arcLife = 0.18; reactor.arcs.length = 0;
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const pts = [], ex = reactor.x + (Math.random() - 0.5) * 2.2, ey = reactor.y + (Math.random() - 0.5) * 2.2, ez = 8 + Math.random() * 35;
        for (let k = 0; k <= 6; k++) { const u = k / 6, j = k > 0 && k < 6; pts.push({ x: reactor.x + (ex - reactor.x) * u + (j ? (Math.random() - 0.5) * 0.5 : 0), y: reactor.y + (ey - reactor.y) * u + (j ? (Math.random() - 0.5) * 0.5 : 0), z: 62 + (ez - 62) * u + (j ? (Math.random() - 0.5) * 14 : 0) }); }
        reactor.arcs.push(pts);
        for (let s2 = 0; s2 < 5; s2++) spawn(ex, ey, ez, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 30 + Math.random() * 40, 0.5 + Math.random() * 0.5, PAL.cyan, 2, 140);
      }
    }
    if (reactor.arcLife > 0) reactor.arcLife -= dt;
    if (Math.random() < dt * 4) spawn(reactor.x + (Math.random() - 0.5) * 0.8, reactor.y + (Math.random() - 0.5) * 0.8, 20 + Math.random() * 40, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 18 + Math.random() * 14, 1.5 + Math.random(), Math.random() < 0.5 ? PAL.cyan : '#d8ffff', 2, 0);
    reactor.ventT -= dt; if (reactor.ventT <= 0) { reactor.ventT = 3.5 + Math.random() * 2; puff(reactor.vent.x, reactor.vent.y, 72, 12, '#cfd8e0', 3, 0.4, 24, 3.5); }
    // the Workshop fabricator smokes
    fab.t -= dt; if (fab.on !== false && fab.t <= 0) { fab.t = 1.2 + Math.random() * 2.5; puff(fab.x, fab.y, 48, 7, SMOKE, 3, 0.5, 14, 4); if (Math.random() < 0.35) for (let i = 0; i < 6; i++) spawn(fab.x, fab.y, 30, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 30 + Math.random() * 40, 0.4 + Math.random() * 0.4, PAL.amber, 2, 160); }
    // garden fireflies + mist
    const gh = roomOf('lounge');
    if (gh) {
      if (Math.random() < dt * 1.2) spawn(gh.x + 0.5 + Math.random() * (gh.w - 1), gh.y + 0.5 + Math.random() * (gh.h - 1), 15 + Math.random() * 35, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 8, 2 + Math.random() * 3, '#e8ff7a', 2, 0);
      mist.t -= dt; if (mist.t <= 0) { mist.t = 10 + Math.random() * 6; const b = { x: gh.x + 1, y: gh.y + 3, w: gh.w - 2, h: 1 }; for (let i = 0; i < 16; i++) spawn(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 10 + Math.random() * 20, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 6 + Math.random() * 6, 2 + Math.random() * 2, '#e6f6ff', 3, 0); }
    }
    crane.t += dt;
    // sky
    sky.starT -= dt;
    if (sky.starT <= 0 && !sky.star) { sky.starT = 30 + Math.random() * 20; const b = stationBounds(); sky.star = { sx: b.minx + Math.random() * (b.maxx - b.minx), sy: b.miny - 300 - Math.random() * 200, vx: 500 + Math.random() * 300, vy: 220 + Math.random() * 120, age: 0, ttl: 0.7 }; }
    if (sky.star) { sky.star.age += dt; sky.star.sx += sky.star.vx * dt; sky.star.sy += sky.star.vy * dt; if (sky.star.age > sky.star.ttl) sky.star = null; }
    sky.satT -= dt;
    if (sky.satT <= 0 && !sky.sat) { sky.satT = 150 + Math.random() * 90; const b = stationBounds(); sky.sat = { sx: b.minx - 200, sy: b.miny - 120 - Math.random() * 250, vx: (b.maxx - b.minx + 400) / 40, vy: 0.6, age: 0, ttl: 40 }; }
    if (sky.sat) { sky.sat.age += dt; sky.sat.sx += sky.sat.vx * dt; sky.sat.sy += sky.sat.vy * dt; if (sky.sat.age > sky.sat.ttl) sky.sat = null; }
  }
  function drawSky(ctx) {
    if (sky.star) { const s = sky.star, a = Math.sin(s.age / s.ttl * Math.PI); ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.9).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx - s.vx * 0.12, s.sy - s.vy * 0.12); ctx.stroke(); ctx.strokeStyle = 'rgba(200,220,255,' + (a * 0.35).toFixed(2) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx - s.vx * 0.3, s.sy - s.vy * 0.3); ctx.stroke(); }
    if (sky.sat) { const s = sky.sat; ctx.fillStyle = '#d8dce8'; ctx.fillRect(Math.round(s.sx), Math.round(s.sy), 2, 2); ctx.fillStyle = '#9aa4b8'; ctx.fillRect(Math.round(s.sx) - 3, Math.round(s.sy) + 1, 2, 1); ctx.fillRect(Math.round(s.sx) + 3, Math.round(s.sy) + 1, 2, 1); if ((s.age % 1.5) < 0.12) { ctx.fillStyle = PAL.amber; ctx.fillRect(Math.round(s.sx) + 1, Math.round(s.sy) - 2, 1, 1); } }
  }
  function strokeArcs(ctx, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    for (const arc of reactor.arcs) { ctx.beginPath(); arc.forEach((q, i) => { const z = toScreen(q.x, q.y, q.z); i ? ctx.lineTo(z.sx, z.sy) : ctx.moveTo(z.sx, z.sy); }); ctx.stroke(); }
  }
  /* desk screen pool: banded from the desk's front edge across the seat tile (three steps, brightest at the desk) */
  function drawDeskGlow(ctx, g, time, reduced, pool, busy) {
    // the screen's light on the floor at the seat side of the desk: one soft radial pool
    const a = (reduced ? 0.16 : 0.13 + 0.04 * (0.5 + 0.5 * Math.sin(time * 0.9 + g.phase))) * (busy(g.member) ? 1 : pool);
    const c = toScreen(g.dx + 0.5 + g.sx * 1.15, g.dy + 0.5 + g.sy * 1.15, 0);
    glow(ctx, c.sx, c.sy, 40, 20, g.accent, a);
  }
  function deskPoolDepth(g) {
    const fallback = depthOf(g.dx + 0.5, g.dy + 0.5, 0) - 0.5;
    if (typeof OBJECTS === 'undefined' || !OBJECTS.items) return fallback;
    const it = OBJECTS.items.find(o => o.fp && g.dx >= o.fp.x && g.dx < o.fp.x + o.fp.w && g.dy >= o.fp.y && g.dy < o.fp.y + o.fp.h);
    if (!it || !it.strips || !it.strips.length) return fallback;
    return Math.min(fallback, Math.min(...it.strips.map(s => s.depth)) - 0.01);
  }
  function drawDeskGlowSorted(ctx, g) {   // Objects layer: one desk pool as a depth-sorted drawable
    const night = !!(curModel && curModel.isNight), m = curModel && curModel.members && curModel.members[g.member];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    drawDeskGlow(ctx, g, clockT, reducedMotion, night ? 0.5 : 1, () => !!(m && (m.state === 'working' || m.activeRecently)));
    ctx.restore();
  }
  function drawLife(ctx, time, reduced) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const night = !!(curModel && curModel.isNight), members = (curModel && curModel.members) || {};
    const pool = night ? 0.5 : 1;                                   // broad floor pools step down at night
    const busy = k => { const m = members[k]; return !!(m && (m.state === 'working' || m.activeRecently)); };
    // static glows (always on, dimmer when flaky)

    for (const b of growBars) { const r = Math.min(30, 10 + b.n * 0.4); glow(ctx, b.sx, b.sy, r, r * 0.4, '#ff6ad5', 0.3 * pool); glow(ctx, b.sx - 2, b.sy + 22, r * 1.1, r * 0.5, '#ff6ad5', 0.12 * pool); }   // the bar, and its light on the plants below
    if (!hallLampsScanned) scanHallLamps();
    for (const l of hallLamps) { glow(ctx, l.fx, l.fy, 22, 11, PAL.amber, 0.14 * pool); glow(ctx, l.hx, l.hy, 5, 4, '#ffd27a', 0.35); }
    // steady sodium wash over the open dock and the pad: an even
    // area light, no per-frame dirt, no free discs on the floor
    { const d = roomOf('dock'), p = roomOf('pad');
      if (d) { ctx.fillStyle = rgba(SODIUM, 0.06 * pool); fillDiamond(ctx, d.x, d.y, d.x + d.w, d.y + d.h); }
      if (p) { ctx.fillStyle = rgba(SODIUM, 0.05 * pool); fillDiamond(ctx, p.x, p.y, p.x + p.w, p.y + p.h); } }
    // holotable: cyan pool + rotating wireframe station
    if (holo.on) { const s = toScreen(holo.x, holo.y, 0); glow(ctx, s.sx, s.sy, 40, 20, PAL.cyan, reduced ? 0.2 : 0.16 + 0.06 * Math.sin(time * 2));
      const ang = reduced ? 0 : time * 0.6, k = 0.028, cz = s.sy - 52, jitter = (!reduced && Math.sin(time * 31) > 0.95) ? 2 : 0;
      ctx.strokeStyle = rgba(PAL.cyan, 0.55); ctx.lineWidth = 1;
      for (const r of rooms()) { ctx.beginPath(); [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].forEach((p, i) => { const px = (p[0] - 25) * k, py = (p[1] - 20) * k; const rx = px * Math.cos(ang) - py * Math.sin(ang), ry = px * Math.sin(ang) + py * Math.cos(ang); const X = s.sx + (rx - ry) * 32 + jitter, Y = cz + (rx + ry) * 16; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); ctx.stroke(); }
      ctx.fillStyle = rgba(PAL.cyan, 0.5); for (let i = 0; i < 6; i++) { const a2 = ang * 2 + i; ctx.fillRect(Math.round(s.sx + Math.cos(a2) * 26), Math.round(cz + Math.sin(a2) * 10), 2, 2); }
      ctx.strokeStyle = rgba(PAL.cyan, 0.18); ctx.beginPath(); ctx.moveTo(s.sx - 30, s.sy); ctx.lineTo(s.sx - 36, cz); ctx.moveTo(s.sx + 30, s.sy); ctx.lineTo(s.sx + 36, cz); ctx.stroke(); }
    // reactor core: pulse, arcs, heat shimmer
    { const s = toScreen(reactor.x, reactor.y, 0); const p = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 2.6); glow(ctx, s.sx, s.sy - 20, 70 + p * 16, 50 + p * 10, PAL.cyan, 0.22 + 0.14 * p); glow(ctx, s.sx, s.sy - 40, 14, 14, '#ffffff', 0.25 + 0.3 * p);
      if (reactor.arcLife > 0) { strokeArcs(ctx, rgba(PAL.cyan, 0.5), 4); strokeArcs(ctx, rgba('#e0ffff', 0.95), 1.5); }
      if (!reduced) { ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; for (let k = 0; k < 3; k++) { const yy = s.sy - 78 - k * 9; ctx.beginPath(); for (let x = -28; x <= 28; x += 4) ctx.lineTo(s.sx + x, yy + Math.sin(time * 6 + x * 0.35 + k) * 1.6); ctx.stroke(); } } }
    if (!reduced) {
      // landing pad beacon + chasing strip, sodium-coloured
      { const c = toScreen(shuttle.x + 0.5, shuttle.y + 0.5, 0), ang = time * 1.6; ctx.fillStyle = rgba(SODIUM, 0.12); ctx.save(); ctx.translate(c.sx, c.sy); ctx.scale(1, 0.5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, TW * 2.4, ang, ang + 0.5); ctx.closePath(); ctx.fill(); ctx.restore();
        padStrip.forEach((q, i) => { const on = ((time / 1.5 + i) % padStrip.length) < 1.5; const s = toScreen(q.x, q.y, 0); ctx.fillStyle = on ? SODIUM : rgba(SODIUM, 0.25); ctx.fillRect(Math.round(s.sx) - 1, Math.round(s.sy) - 1, 3, 2); }); }
      // dock crane light
      { const d = roomOf('dock'); if (d) { const u = 0.5 + 0.5 * Math.sin(crane.t * 0.21); const s = toScreen(d.x + u * d.w, d.y + 0.2, 0); ctx.fillStyle = '#ffd080'; ctx.fillRect(Math.round(s.sx) - 2, Math.round(s.sy) - 72, 4, 3); glow(ctx, s.sx, s.sy - 70, 12, 8, SODIUM, 0.6); const g = ctx.createLinearGradient(0, s.sy - 70, 0, s.sy); g.addColorStop(0, rgba(SODIUM, 0.2)); g.addColorStop(1, rgba(SODIUM, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(s.sx - 3, s.sy - 70); ctx.lineTo(s.sx + 3, s.sy - 70); ctx.lineTo(s.sx + 26, s.sy); ctx.lineTo(s.sx - 26, s.sy); ctx.closePath(); ctx.fill(); } }
    }
    ctx.restore();
  }

  /* ---------------- public ---------------- */
  let curModel = null, stale = false, reducedMotion = false, clockT = 0;
  const drawList = [];
  function rebuildPositions() { initPads(); initShuttle(); initLife(); }
  function init(model) {
    curModel = model; rebuildPositions(); buildDock(model);
    spawnEventParcels(model);
  }
  function onModel(model) { curModel = model; stale = !!(model && model.stale); rebuildPositions(); buildDock(model); spawnEventParcels(model); }
  function tick(dt, model, now, opts) {
    if (model) { curModel = model; stale = !!model.stale; }
    reducedMotion = !!(opts && opts.reducedMotion);
    clockT += dt;
    tickBubbles(dt); tickParcels(dt, !stale); tickParticles(dt); tickAmbient(dt, reducedMotion); tickLife(dt, reducedMotion);
    for (const p of pads) p.heat += ((p.on ? 1 : 0) - p.heat) * Math.min(1, dt * 2);
    if (!reducedMotion) for (const p of pads) if (p.on && Math.random() < dt * 6) spawn(p.x + 0.2 + Math.random() * 0.6, p.y + 0.2 + Math.random() * 0.6, 0, 0, 0, 18 + Math.random() * 12, 1.2 + Math.random() * 0.8, PAL.cyan, 2, 0);
    tickDock(dt, reducedMotion);
    if (shuttle.anim >= 0) { shuttle.anim += dt; if (shuttle.anim > 20) shuttle.anim = -1; }
    for (let i = markers.length - 1; i >= 0; i--) { markers[i].age += dt; if (markers[i].dead) markers.splice(i, 1); }
  }
  function drawables() {
    drawList.length = 0;
    const time = clockT;
    drawList.push({ depth: -1e9, draw: ctx => drawSky(ctx) });
    for (const p of pads) drawList.push({ depth: depthOf(p.x, p.y, 0) - 0.2, draw: ctx => drawPad(ctx, p, time) });
    for (const m of markers) drawList.push({ depth: depthOf(m.x, m.y, 0) - 0.2, draw: ctx => drawMarker(ctx, m, time) });
    // Objects layer: desk pools sort just behind their desk tile, under the desk sprite and any figure
    // A desk pool lies on the floor, so it sorts behind the WHOLE desk sprite (its back-most strip), never between the
    // desk's strips: sorted just behind the front tile it washed the desk's rear columns and read as a pale patch.
    for (const g of deskGlows) drawList.push({ depth: deskPoolDepth(g), draw: ctx => drawDeskGlowSorted(ctx, g) });
    // the ring and thruster glow lie on the pad floor, so they sort behind the WHOLE landed
    // shuttle (below its back footprint tile, one tile north-west of the anchor), never over its hull
    drawList.push({ depth: depthOf(shuttle.x - 1, shuttle.y - 1, 0) - 0.6, draw: ctx => drawShuttleGlow(ctx, time) });
    for (const m of modules) drawList.push({ depth: depthOf(m.x + m.w, m.y + m.h, 0), kind: 'module', /* tag */ draw: ctx => drawStack(ctx, m, time) });
    updateExtras();
    for (const p of parcels) if (!p.hidden && (p.done || parcelClock >= p.departAt)) drawList.push({ depth: depthOf(p.x, p.y, p.z) + 0.3, draw: ctx => drawParcel(ctx, p) });
    drawList.push({ depth: 1e6, draw: ctx => drawParticles(ctx) });
    return drawList;
  }
  function drawOverlay(ctx) { drawLife(ctx, clockT, reducedMotion); for (const m of modules) drawModuleLabel(ctx, m); drawBubbles(ctx); }

  // the procedural block stand-ins are the only canvases FX keeps; rebuild() drops them (remade on use)
  function bakedCanvases() { return Object.values(blockSprites); }
  function rebuild() { for (const k in blockSprites) { blockSprites[k].width = 0; delete blockSprites[k]; } }
  return { bakedCanvases, rebuild, init, onModel, tick, drawables, drawOverlay, bubble, parcel, setCharging, marker, clearMarker, rebuildPositions,
           hitTestModule, moduleCaption,   // epic caption: main.js pick()
           _debug: { parts, bubbles, parcels, modules, pads, shuttle, hallLamps, deskGlows, holo, growBars, dock: { shipped: shippedSet } } };
})();
