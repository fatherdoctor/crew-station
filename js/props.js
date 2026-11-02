/* Crew station: PROPS. The inbox tray and the room name plates. Contract: docs/ARCHITECTURE.md (PROPS).
   Reads CONFIG, ISO, FLOORS, CAMERA. */
'use strict';

const PROPS = (() => {
  const HH = CONFIG.TILE_H / 2;
  const TRAY = { src: CONFIG.FURNITURE_URL + 'inbox_tray_iso.png', room: 'bridge', x: 7, y: 3, cx: 38, by: 62 };
  let trayImg = null, tray = null, inbox = [];

  function preload() { return LOADQ.image(TRAY.src).then(im => { trayImg = im; }); }

  /* The tray stands at the room's inbox spot (after BACKDROP's overrides), or at its default tile. */
  function init() {
    const room = CONFIG.ROOMS.find(r => r.key === TRAY.room);
    if (!room) { tray = null; return; }
    const sp = room.spots && room.spots.inbox;
    const ax = sp ? sp.x : room.x + TRAY.x, ay = sp ? sp.y : room.y + TRAY.y;
    tray = { ax, ay, depth: ISO.depth(ax + 0.5, ay + 0.5, 0) + 0.05, rect: null };
  }

  function para(ctx, x0, y0, x1, y1, grow) {   // iso parallelogram of a tile rect, grown by grow px
    const g = grow || 0, n = ISO.toScreen(x0, y0, 0), e = ISO.toScreen(x1, y0, 0), s = ISO.toScreen(x1, y1, 0), w = ISO.toScreen(x0, y1, 0);
    ctx.beginPath(); ctx.moveTo(n.sx, n.sy - g); ctx.lineTo(e.sx + g, e.sy); ctx.lineTo(s.sx, s.sy + g); ctx.lineTo(w.sx - g, w.sy); ctx.closePath();
  }
  function drawTray(ctx, time) {
    const { ax, ay } = tray;
    // contact shadow: outer 0.12 one px out, inner 0.24 on the base
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; para(ctx, ax, ay, ax + 1, ay + 1, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.24)'; para(ctx, ax + 0.08, ay + 0.08, ax + 0.92, ay + 0.92, 0); ctx.fill();
    if (trayImg) {   // the sprite's base corner on the footprint's south corner
      const south = ISO.toScreen(ax + 1, ay + 1, 0), ix = Math.round(south.sx - TRAY.cx), iy = Math.round(south.sy - TRAY.by);
      ctx.drawImage(trayImg, ix, iy, trayImg.width, trayImg.height);
      tray.rect = { x0: ix, y0: iy, x1: ix + trayImg.width, y1: iy + trayImg.height };
    }
    const n = inbox.length;
    if (!n) return;
    const c = ISO.toScreen(ax + 0.5, ay + 0.5, 0), sx = c.sx, sy = c.sy + HH * 0.5 + HH / 2;
    const glow = 0.35 + 0.25 * Math.sin(time * 3);
    ctx.fillStyle = 'rgba(245,166,35,' + glow + ')';
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < Math.min(n, 6); i++) { ctx.fillStyle = i % 2 ? '#e8e2d0' : '#f5a623'; ctx.fillRect(sx - 10 + i * 2, sy - 56 - i * 4, 20, 3); }
    ctx.fillStyle = '#f5a623'; ctx.font = '12px VT323, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(n + ' for you', sx, sy - 62 - Math.min(n, 6) * 4);
  }

  /* ---- room name plates: a small VT323 plate on the floor by each room's south corner (dark pill, amber text). The
     text is 14 CSS px on screen at any zoom between 0.5 and 2 (counter-scaled by the camera zoom), smaller/larger
     outside that range. One per non-corridor room; built lazily so WORLD/BACKDROP are ready. ---- */
  const LABEL_PX = 14;
  // Per-room name plate position (room-local tile), overriding the floor-centre default: the pad's centre is the parked
  // shuttle's nose, so its plate sits in the south-west quarter
  const PLATE_AT = { pad: [2, 6] };
  let labels = null;
  function buildLabels() {
    labels = [];
    for (const room of CONFIG.ROOMS) {
      if (room.kind === 'corridor' || !room.name) continue;
      // The name plate sits at the centre of the room's floor. With the floor polygons loaded
      // (FLOORS) the centre is the polygon's bounding-rect centre; otherwise the rect centre.
      let cx = room.x + room.w / 2, cy = room.y + room.h / 2;
      if (typeof FLOORS !== 'undefined' && FLOORS && FLOORS.insetRect) { const b = FLOORS.insetRect(room.key); if (b) { cx = (b.x0 + b.x1) / 2; cy = (b.y0 + b.y1) / 2; } }
      if (PLATE_AT[room.key]) { cx = room.x + PLATE_AT[room.key][0] + 0.5; cy = room.y + PLATE_AT[room.key][1] + 0.5; }
      const tx = cx - 0.5, ty = cy - 0.5;
      const c = ISO.toScreen(tx + 0.5, ty + 0.5, 0);
      labels.push({ room: room.key, text: room.name.toUpperCase(), sx: c.sx, sy: c.sy + 6, depth: ISO.depth(tx + 0.5, ty + 0.5, 0) - 0.15 });   // drawn over the set anyway (main.js)
    }
  }
  function camZoom() { try { return (typeof CAMERA !== 'undefined' && CAMERA.state) ? CAMERA.state().zoom : 1; } catch (_) { return 1; } }
  function drawLabel(ctx, L) {
    const z = Math.max(0.5, Math.min(2, camZoom())), k = 1 / z;   // world px per screen px inside the readable band
    const fs = LABEL_PX * k, padX = 6 * k, h = (LABEL_PX + 4) * k;
    ctx.save();
    ctx.font = fs + 'px VT323, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(L.text).width + 2 * padX, x = L.sx - w / 2, y = L.sy - h / 2, r = h / 2;
    ctx.fillStyle = 'rgba(8,9,14,0.82)';
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(245,166,35,0.35)'; ctx.lineWidth = k; ctx.stroke();
    ctx.fillStyle = '#f5a623'; ctx.fillText(L.text, L.sx, L.sy + 0.5 * k);
    ctx.restore();
  }
  /* The plates as drawables. */
  function labelDrawables() {
    if (!labels) buildLabels();
    return labels.map(L => ({ depth: L.depth, t: 'label', room: L.room, draw: (ctx) => drawLabel(ctx, L) }));
  }

  function drawables(time) {
    const out = labelDrawables();
    if (tray) out.push({ depth: tray.depth, t: 'inbox', draw: (ctx) => drawTray(ctx, time) });
    return out;
  }

  function setInbox(list) { inbox = Array.isArray(list) ? list : []; }

  function hitTest(wx, wy) {
    const r = tray && tray.rect;
    if (!r || wx < r.x0 || wx > r.x1 || wy < r.y0 || wy > r.y1) return null;
    return { title: 'Your inbox', lines: inbox.length ? inbox.map(i => i.card + (i.for ? ' (for ' + (CONFIG.MEMBERS[i.for] ? CONFIG.MEMBERS[i.for].name : i.for) + ')' : '')) : ['Nothing waiting on you'] };
  }

  return { preload, init, drawables, labelDrawables, setInbox, hitTest };
})();
