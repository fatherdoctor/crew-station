/* Crew station: CAMERA. Pan/zoom/pinch, idle tour, framing, screen<->world.
   State: x, y = screen (CSS px) position of the world origin; zoom = world px -> CSS px. */
'use strict';

const CAMERA = (() => {
  const ZOOM_MIN = 0.2, ZOOM_MAX = 3, MARGIN = 40, OUT_TILES = 20, PAN_MARGIN = 96;   // OUT_TILES: how far past the hull the view may zoom out
  const st = { x: 0, y: 0, zoom: 1 };
  let vw = innerWidth, vh = innerHeight, dpr = 1, canvas = null;
  let onPickFn = null;
  let insetL = 0, insetB = 0;   // Crew panel: CSS px the crew panel covers on the left (desktop) / bottom (phone bar)
  // Crew panel: the visible station area is the window minus those insets; its centre replaces the window centre.
  const midX = () => insetL + (vw - insetL) / 2, midY = () => (vh - insetB) / 2;
  let idleSec = 0, touring = false, tour = null, lastInput = performance.now();
  let anim = null;   // {from:{x,y,zoom}, to:{x,y,zoom}, t, dur}
  const T = { W: CONFIG.TILE_W, H: CONFIG.TILE_H };

  /* ---- geometry helpers (do not depend on ISO/WORLD existing) ---- */
  const toScreen = (tx, ty) => (typeof ISO !== 'undefined' && ISO.toScreen)
    ? ISO.toScreen(tx, ty, 0) : { sx: (tx - ty) * T.W / 2, sy: (tx + ty) * T.H / 2 };
  const toTile = (wx, wy) => (typeof ISO !== 'undefined' && ISO.fromScreen)
    ? ISO.fromScreen(wx, wy) : { x: (wx / (T.W / 2) + wy / (T.H / 2)) / 2, y: (wy / (T.H / 2) - wx / (T.W / 2)) / 2 };

  function roomsForTour() { return CONFIG.ROOMS.filter(r => r.kind !== 'corridor'); }

  function roomCenter(r) {
    const c = toScreen(r.x + r.w / 2, r.y + r.h / 2);
    return { x: c.sx, y: c.sy };
  }

  const backdropOn = () => typeof BACKDROP !== 'undefined' && BACKDROP && typeof BACKDROP.active === 'function' && BACKDROP.active() && typeof BACKDROP.bounds === 'function';

  /* World-px bounds of the STATION itself (fit and pan clamp use this): WORLD.bounds() when available, else projected from CONFIG.ROOMS. */
  function stationBounds() {
    if (typeof WORLD !== 'undefined' && WORLD.bounds) {
      const b = WORLD.bounds();
      if (b && typeof b.minX === 'number') return { x: b.minX - 48, y: b.minY - 160, w: b.maxX - b.minX + 96, h: b.maxY - b.minY + 260 };
      if (b && typeof b.x === 'number' && typeof b.w === 'number') return b;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of CONFIG.ROOMS) {
      for (const [tx, ty] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
        const p = toScreen(tx, ty);
        minX = Math.min(minX, p.sx); maxX = Math.max(maxX, p.sx); minY = Math.min(minY, p.sy); maxY = Math.max(maxY, p.sy);
      }
    }
    if (!isFinite(minX)) return { x: -1600, y: -1100, w: 3200, h: 2200 };
    // room for tall back walls above the floor and the hull skirt below
    return { x: minX - 48, y: minY - 160, w: maxX - minX + 96, h: maxY - minY + 260 };
  }

  /* The area the view may show: the backdrop's bounds when it is active (it carries a 20-tile margin), else the station plus that margin. */
  function bounds() {
    if (backdropOn()) { const b = BACKDROP.bounds(); if (b && typeof b.w === 'number') return b; }
    const s = stationBounds(), mx = OUT_TILES * CONFIG.TILE_W, my = OUT_TILES * CONFIG.TILE_H;
    return { x: s.x - mx, y: s.y - my, w: s.w + 2 * mx, h: s.h + 2 * my };
  }

  function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

  function clampPan(s) {
    // Clamp the camera CENTER (the world point under the screen middle), not the station's visible fraction, so at any
    // zoom every point of the station (plus a small margin) can be brought to the middle of the screen.
    const b = panBounds();
    const cx = (midX() - s.x) / s.zoom, cy = (midY() - s.y) / s.zoom;   // Crew panel: visible centre
    const nx = Math.max(b.x, Math.min(b.x + b.w, cx)), ny = Math.max(b.y, Math.min(b.y + b.h, cy));
    s.x = midX() - nx * s.zoom; s.y = midY() - ny * s.zoom;
    return s;
  }

  /* World-px rect the view CENTER may reach: the station bounds plus PAN_MARGIN, kept inside BACKDROP.bounds() when the
     backdrop is active (that rect carries the space margin the art is drawn into). */
  function panBounds() {
    const s = stationBounds(), m = PAN_MARGIN;
    let x0 = s.x - m, y0 = s.y - m, x1 = s.x + s.w + m, y1 = s.y + s.h + m;
    if (backdropOn()) {
      const bb = BACKDROP.bounds();
      if (bb && typeof bb.w === 'number') {
        const a0 = Math.max(x0, bb.x), b0 = Math.max(y0, bb.y), a1 = Math.min(x1, bb.x + bb.w), b1 = Math.min(y1, bb.y + bb.h);
        if (a1 > a0 && b1 > b0) { x0 = a0; y0 = b0; x1 = a1; y1 = b1; }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function fitView() {
    const b = stationBounds();
    const z = clampZoom(Math.min((vw - insetL - 2 * MARGIN) / b.w, (vh - insetB - 2 * MARGIN) / b.h));   // Crew panel: fit the visible area
    return { zoom: z, x: midX() - (b.x + b.w / 2) * z, y: midY() - (b.y + b.h / 2) * z };
  }

  function viewCenteredOn(wx, wy, zoom) {
    zoom = clampZoom(zoom);
    return clampPan({ zoom, x: midX() - wx * zoom, y: midY() - wy * zoom });   // Crew panel: visible centre
  }

  function set(s) { st.x = s.x; st.y = s.y; st.zoom = s.zoom; }

  function zoomAt(factor, cx, cy) {
    const z = clampZoom(st.zoom * factor), k = z / st.zoom;
    set(clampPan({ zoom: z, x: cx - (cx - st.x) * k, y: cy - (cy - st.y) * k }));
  }

  function animateTo(target, dur) {
    anim = { from: { x: st.x, y: st.y, zoom: st.zoom }, to: target, t: 0, dur: dur || 0.8 };
  }

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* ---- input ---- */
  function noteInput() { lastInput = performance.now(); idleSec = 0; if (touring) stopTour(); anim = null; }

  const ptrs = new Map();
  let down = null, pinch = null, lastTap = 0, lastTapPos = null;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    noteInput();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, camX: st.x, camY: st.y };
      pinch = null;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: st.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, camX: st.x, camY: st.y };
      down = null;
    }
  }

  function onPointerMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      noteInput();
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const z = clampZoom(pinch.zoom * (d / Math.max(1, pinch.d))), k = z / pinch.zoom;
      // zoom toward the original pinch center, then follow the pinch center as it moves
      set(clampPan({ zoom: z, x: pinch.cx - (pinch.cx - pinch.camX) * k + (cx - pinch.cx), y: pinch.cy - (pinch.cy - pinch.camY) * k + (cy - pinch.cy) }));
      return;
    }
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved) { noteInput(); set(clampPan({ zoom: st.zoom, x: down.camX + dx, y: down.camY + dy })); }
    }
  }

  function onPointerUp(e) {
    ptrs.delete(e.pointerId);
    if (down && !down.moved && performance.now() - down.t < 300 && ptrs.size === 0) {
      const now = performance.now();
      if (e.pointerType !== 'mouse' && lastTapPos && now - lastTap < 300 && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < 24) {
        lastTap = 0; frameAt(e.clientX, e.clientY);          // double tap
      } else {
        lastTap = now; lastTapPos = { x: e.clientX, y: e.clientY };
        if (onPickFn) onPickFn(e.clientX, e.clientY);
      }
    }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) down = null;
    else if (ptrs.size === 1 && !pinch) { const p = [...ptrs.values()][0]; down = { x: p.x, y: p.y, t: performance.now(), moved: true, camX: st.x, camY: st.y }; }
  }

  function onWheel(e) {
    e.preventDefault(); noteInput();
    const f = Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0015);
    zoomAt(f, e.clientX, e.clientY);
  }

  function frameAt(clientX, clientY) {
    const w = toWorld(clientX, clientY), t = toTile(w.x, w.y);
    let key = null;
    if (typeof WORLD !== 'undefined' && WORLD.roomAt) key = WORLD.roomAt(Math.floor(t.x), Math.floor(t.y));
    else { const r = CONFIG.ROOMS.find(r => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h); key = r && r.key; }
    if (key) frameRoom(key); else animateTo(viewCenteredOn(w.x, w.y, Math.max(st.zoom, 1.4)), 0.8);
  }

  function onKey(e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const step = 80;
    switch (e.key) {
      case 'ArrowLeft': noteInput(); set(clampPan({ zoom: st.zoom, x: st.x + step, y: st.y })); break;
      case 'ArrowRight': noteInput(); set(clampPan({ zoom: st.zoom, x: st.x - step, y: st.y })); break;
      case 'ArrowUp': noteInput(); set(clampPan({ zoom: st.zoom, x: st.x, y: st.y + step })); break;
      case 'ArrowDown': noteInput(); set(clampPan({ zoom: st.zoom, x: st.x, y: st.y - step })); break;
      case '+': case '=': noteInput(); zoomAt(1.2, midX(), midY()); break;
      case '-': case '_': noteInput(); zoomAt(1 / 1.2, midX(), midY()); break;
      case '0': noteInput(); animateTo(fitView(), 0.6); break;
      case 't': case 'T': if (touring) { noteInput(); } else startTour(); break;
      default: return;
    }
    e.preventDefault();
  }

  /* ---- idle tour ---- */
  function startTour() {
    const rooms = roomsForTour(); if (!rooms.length) return;
    touring = true; idleSec = 0;
    tour = { rooms, i: -1, hold: 0 };
    nextStop();
  }
  function stopTour() { touring = false; tour = null; anim = null; }
  function nextStop() {
    tour.i = (tour.i + 1) % tour.rooms.length;
    const c = roomCenter(tour.rooms[tour.i]);
    anim = { from: { x: st.x, y: st.y, zoom: st.zoom }, to: viewCenteredOn(c.x, c.y, backdropOn() ? 1.6 : 1.4), t: 0, dur: 4 };
    tour.hold = 12;
  }

  /* ---- public ---- */
  function init(cv) {
    canvas = cv;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', e => { if (e.pointerType === 'touch') return; noteInput(); frameAt(e.clientX, e.clientY); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', onKey);
    set(fitView());
  }

  function resize(w, h, d) {
    const had = canvas !== null;
    vw = w; vh = h; dpr = d || 1;
    if (had && !touring && !anim) set(clampPan({ ...st }));
  }

  function apply(ctx) { ctx.setTransform(dpr * st.zoom, 0, 0, dpr * st.zoom, dpr * st.x, dpr * st.y); }

  function tick(dt) {
    if (anim) {
      anim.t += dt;
      const k = ease(Math.min(1, anim.t / anim.dur));
      st.x = anim.from.x + (anim.to.x - anim.from.x) * k;
      st.y = anim.from.y + (anim.to.y - anim.from.y) * k;
      st.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * k;
      if (anim.t >= anim.dur) anim = null;
    }
    if (touring && tour) {
      if (!anim) { tour.hold -= dt; if (tour.hold <= 0) nextStop(); }
    } else if (ptrs.size === 0) {
      idleSec += dt;
      if (idleSec >= CONFIG.TIMING.tourAfterSec && !document.hidden) startTour();
    }
  }

  function toWorld(clientX, clientY) { return { x: (clientX - st.x) / st.zoom, y: (clientY - st.y) / st.zoom }; }
  function toClient(wx, wy) { return { x: wx * st.zoom + st.x, y: wy * st.zoom + st.y }; }

  function frameRoom(key, dur) {
    const r = CONFIG.ROOMS.find(r => r.key === key); if (!r) return;
    const c = roomCenter(r);
    animateTo(viewCenteredOn(c.x, c.y, Math.max(1.4, Math.min(2, st.zoom))), dur || 0.8);
  }

  return {
    init, resize, apply, tick, toWorld, toClient, frameRoom, bounds, stationBounds, panBounds,
    /* center the view on world px (wx, wy) at zoom (clamped exactly like user input); returns the resulting state */
    centerOn: (wx, wy, zoom) => { noteInput(); set(viewCenteredOn(wx, wy, zoom == null ? st.zoom : zoom)); return { x: st.x, y: st.y, zoom: st.zoom }; },
    fit: () => animateTo(fitView(), 0.6),
    onPick: fn => { onPickFn = fn; },
    state: () => ({ x: st.x, y: st.y, zoom: st.zoom }),
    get touring() { return touring; },
    startTour, stopTour: () => { noteInput(); },
    viewport: () => ({ w: vw, h: vh, dpr }),
    /* Crew panel: the CSS px the crew panel covers (left column on desktop, bottom bar on phones). Fit, pan clamp, tour
       and centring use the area that is left. A change after init re-fits (it only changes across the 900 px breakpoint). */
    setInsets(left, bottom) {
      const l = Math.max(0, left || 0), b = Math.max(0, bottom || 0);
      if (l === insetL && b === insetB) return;
      insetL = l; insetB = b;
      if (canvas) { if (touring) stopTour(); animateTo(fitView(), 0.4); }
    },
    insets: () => ({ left: insetL, bottom: insetB }),
    /* Crew panel: glide (animated) to centre world px (wx, wy) in the visible area at `zoom`. */
    glideTo(wx, wy, zoom, dur) { noteInput(); animateTo(viewCenteredOn(wx, wy, zoom == null ? st.zoom : zoom), dur || 0.7); },
  };
})();
