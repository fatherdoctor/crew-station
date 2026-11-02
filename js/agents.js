/* Crew station: the crew's behavior. Contract: docs/ARCHITECTURE.md (Agents).
   One agent per CONFIG member plus a Drone pool. A member's BOARD state picks a plan (work, roam, charge, blocked,
   ask); recent board events (hand-offs, verdicts, closures, plans) are acted out as walks and conversations.
   Positions are continuous tile coordinates: (tx + 0.5, ty + 0.5) is the center of tile (tx, ty). */
'use strict';

const AGENTS = (() => {
  const T = CONFIG.TIMING;
  // Figures walk straight on SCREEN: up / down / left / right. On this grid those are the four DIAGONAL grid moves
  // (screen up = grid north-west (-1,-1), down = south-east (1,1), right = north-east (1,-1), left = south-west (-1,1));
  // WORLD.setStepMode('diag') makes the pathfinder use them (an orthogonal step costs more and is used only to change tile
  // parity). Collinear steps merge into one leg, and a figure stops TURN_PAUSE_SEC at each turn. WALK_TRACK maps each grid
  // step to its track: walk_north-west = screen up, walk_south-east = screen down, walk_north-east = screen right,
  // walk_south-west = screen left. A skin without that track falls back to WALK_FACE. A rare orthogonal (parity) step uses
  // the screen-horizontal track.
  const TURN_PAUSE_SEC = 0.1;
  const WALK_TRACK = {
    '-1,-1': 'north-west', '1,1': 'south-east', '1,-1': 'north-east', '-1,1': 'south-west',   // screen up / down / right / left
    '1,0': 'north-east', '0,-1': 'north-east', '-1,0': 'south-west', '0,1': 'south-west',   // orthogonal parity steps
  };
  // screen components of each grid-straight step: grid east (1,0) = screen down-right, north (0,-1) = up-right, west (-1,0) = up-left, south (0,1) = down-left
  const ORTH_COMPONENTS = { '1,0': ['south-east', 'north-east'], '0,-1': ['north-west', 'north-east'], '-1,0': ['north-west', 'south-west'], '0,1': ['south-east', 'south-west'] };
  const WALK_FACE = { 'north-west': 'north', 'south-east': 'south', 'north-east': 'east', 'south-west': 'west' };   // fallback track
  if (typeof WORLD !== 'undefined' && WORLD.setStepMode) WORLD.setStepMode('diag');
  const agents = [];            // every figure, crew and drones
  const byKey = {};             // crew agents by member key
  const drones = [];
  const claims = { pads: new Map(), stand: new Map() };   // spot index -> agent id
  const acted = new Set();      // event ids already performed
  const seatTiles = new Set();  // "x,y" of every seat, never a wander destination for someone else
  let nextId = 1;
  let lastModel = null;
  let frameClock = 0;
  // Tuning on top of CONFIG: walk 30 % slower than CONFIG.TIMING.walkTilesPerSec, figures 20 % shorter
  // (desk height), roam far less, chance meetings at most once per 3 minutes per figure.
  const SPEED_K = 0.7, SIZE_K = 1.2, MEET_EVERY_SEC = 180;
  const WANDER_WAIT = [25, 70], DRONE_WANDER_WAIT = [15, 40];

  const PHRASES = [
    'Have you seen the planet today?', 'Coffee is a lie for robots.', 'The hall lights flicker again.',
    'Ran the tests twice.', 'My pad charges faster than yours.', 'The Observatory window is the best one.',
    'Quiet night on the station.', 'Nice work on the docs.', 'The garden smells like ozone.',
    'Who moved my desk lamp?', 'Did the board refresh yet?', 'I like the amber lights.',
    'Ten minutes until the next pass.', 'The core hums in B flat.', 'Mind the door, it sticks.',
  ];

  /* Accomplishment chats: about once per 6-10 minutes station-wide, a chance meeting is about a card
     that really closed today or yesterday (board.json cards in the Done column whose status reads "DONE <date> ...").
     The member whose queue closed it speaks when they are one of the pair; the other reacts. No completions in the last
     two days: no such chats. Never an invented card. */
  const ACCOMP_EVERY_SEC = [360, 600];
  const ACCOMP_REACT = ['Nice work.', 'Ship it.', 'Good one.', 'That one took a while.'];
  let accompCache = null, accompRaw = null, accompNextAt = null;
  function shortTitle(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');
    if (t.length <= 42) return t;
    const cut = t.slice(0, 42); const sp = cut.lastIndexOf(' ');
    return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[.:;,-]+$/, '') + '...';
  }
  /* [{code, title, queue, member, date, verdict, text}] from BOARD.raw: Done cards dated today or yesterday (board day). */
  function accomplishments() {
    const raw = typeof BOARD !== 'undefined' && BOARD.raw; if (!raw || !Array.isArray(raw.cards)) return [];
    if (raw === accompRaw && accompCache) return accompCache;
    const today = raw.today || (BOARD.model && BOARD.model.today); if (!today) return [];
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - 1);
    const yest = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const out = [];
    for (const c of raw.cards) {
      if (!c || !c.code || c.column !== 'Done' || c.queue === 'owner') continue;   // the owner's own decision cards are not crew news
      const m = /^DONE (\d{4}-\d{2}-\d{2})/.exec(c.status || ''); if (!m || (m[1] !== today && m[1] !== yest)) continue;
      if (c.code.endsWith(CONFIG.CODES.review) || c.code.endsWith(CONFIG.CODES.closure)) continue;   // review and closure rows: the parent card is the news
      const verdict = /APPROVED WITH NOTES/i.test(c.status) ? 'Approved with notes.' : /\bAPPROVED\b/.test(c.status) ? 'Approved.' : null;
      const member = CONFIG.MEMBERS[c.queue] ? c.queue : null;
      out.push({ code: c.code, title: shortTitle(c.title), queue: c.queue, member, date: m[1], verdict, points: +c.points || 0, text: c.code + ' is done: ' + shortTitle(c.title) + (shortTitle(c.title).endsWith('...') ? '' : '.') });
    }
    accompRaw = raw; accompCache = out;
    return out;
  }
  /* Plays one accomplishment chat between a and b (already set talking); false when there is none to tell. */
  function accomplishmentChat(a, b) {
    const pool = accomplishments(); if (!pool.length) return false;
    const mine = pool.filter(c => c.member && (c.member === a.key || c.member === b.key));
    const card = pick(mine.length ? mine : pool);
    const sp = card.member === b.key ? b : a, other = sp === a ? b : a;
    sayBubble(sp, card.text, 'talk', T.talkSec * 0.6);
    if (card.verdict && Math.random() < 0.6) {
      setTimeout(() => { if (other.act === 'talk') sayBubble(other, 'Approved?', 'talk', 2.4); }, 2500);
      setTimeout(() => { if (sp.act === 'talk') sayBubble(sp, card.verdict, 'talk', 2.4); }, 4800);
    } else {
      const lines = ACCOMP_REACT.filter(l => l !== 'That one took a while.' || card.points >= 3);
      setTimeout(() => { if (other.act === 'talk') sayBubble(other, pick(lines), 'talk', T.talkSec * 0.5); }, 2500);
    }
    return true;
  }

  /* ---------- helpers ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const roomOf = key => CONFIG.ROOMS.find(r => r.key === key);
  const center = t => ({ x: Math.floor(t.x) + 0.5, y: Math.floor(t.y) + 0.5 });
  const sameTile = (a, b) => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const tileKey = t => Math.floor(t.x) + ',' + Math.floor(t.y);
  const hasWorld = () => typeof WORLD !== 'undefined' && WORLD && typeof WORLD.path === 'function';
  const hasFx = fn => typeof FX !== 'undefined' && FX && typeof FX[fn] === 'function';
  const IX = () => typeof INTERACTIONS !== 'undefined' && INTERACTIONS;   // Interactions: the ambient object layer (js/interactions.js)
  const walkableTile = t => !hasWorld() || !WORLD.walkable || WORLD.walkable(Math.floor(t.x), Math.floor(t.y));

  let doorSet = null;
  function isDoorTile(t) {
    if (!doorSet) { doorSet = new Set(); if (hasWorld() && WORLD.doorTiles) for (const d of WORLD.doorTiles()) { doorSet.add(d.x + ',' + d.y); if (d.ox != null) doorSet.add(d.ox + ',' + d.oy); } }
    return doorSet.has(tileKey(t));
  }
  function isJunction(t) {
    const x = Math.floor(t.x), y = Math.floor(t.y);
    let v = false, h = false;
    for (const r of CONFIG.ROOMS) if (r.kind === 'corridor' && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { if (r.w <= 3) v = true; else h = true; }
    return v && h;
  }
  const hallSpot = t => t && (isDoorTile(t) || isJunction(t));
  function seatOf(key) {
    for (const r of CONFIG.ROOMS) if (r.seats && r.seats[key]) return Object.assign({ room: r.key }, r.seats[key]);
    return null;
  }
  function spotsOf(roomKey, name) { const r = roomOf(roomKey); return (r && r.spots && r.spots[name]) || []; }

  function findPath(from, to) {
    if (!hasWorld()) return [center(to)];
    const p = WORLD.path({ x: Math.floor(from.x), y: Math.floor(from.y) }, { x: Math.floor(to.x), y: Math.floor(to.y) });
    if (!p || !p.length) return null;
    return legsOf(p.map(center));
  }
  /* Keep only the points where the direction changes (and the last), so each path point ends a leg. */
  function legsOf(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], n = pts[i + 1], q = pts[i - 1];
      if (!n || !q) { out.push(p); continue; }
      if (Math.sign(p.x - q.x) !== Math.sign(n.x - p.x) || Math.sign(p.y - q.y) !== Math.sign(n.y - p.y)) out.push(p);
    }
    return out;
  }
  function randomTileIn(roomKey) {
    for (let i = 0; i < 6; i++) {
      let t = null;
      if (hasWorld() && WORLD.randomTileIn) t = WORLD.randomTileIn(roomKey);
      if (!t) { const r = roomOf(roomKey); if (!r) return null; t = { x: r.x + Math.floor(Math.random() * r.w), y: r.y + Math.floor(Math.random() * r.h) }; }
      if (!seatTiles.has(tileKey(t)) && walkableTile(t) && !hallSpot(t)) return center(t);
    }
    return null;
  }
  function besideSeat(seat) {
    const cands = [{ x: seat.x - 1, y: seat.y }, { x: seat.x + 1, y: seat.y }, { x: seat.x, y: seat.y + 1 }, { x: seat.x - 1, y: seat.y + 1 }, { x: seat.x + 1, y: seat.y + 1 }];
    const free = cands.filter(t => !seatTiles.has(tileKey(t)) && walkableTile(t) && !agents.some(a => a.target && sameTile(a.target, t) && a.target !== null));
    return center(free.length ? pick(free) : cands[2]);
  }
  function claimSpot(kind, list, agent) {
    for (let i = 0; i < list.length; i++) if (!claims[kind].has(i)) { claims[kind].set(i, agent.id); agent.claim = { kind, i }; if (kind === 'pads' && hasFx('setCharging')) FX.setCharging(i, true); return center(list[i]); }
    return null;
  }
  /* Charging pads: a pad's dock spot is its exact fractional CONFIG spot + 0.5 (the painted coil centre; FX draws its ring
     at the same point). A figure paths to the nearest free walkable tile, then glides the last step onto the spot. */
  function padSpot(i) { const p = spotsOf('charging', 'pads')[i]; return p ? { x: p.x + 0.5, y: p.y + 0.5 } : null; }
  function approachTile(spot) {
    const ok = (x, y) => walkableTile({ x, y }) && !(hasWorld() && WORLD.isBlocked && WORLD.isBlocked(x, y)) && !isDoorTile({ x, y });
    const fx = Math.floor(spot.x), fy = Math.floor(spot.y);
    if (ok(fx, fy)) return { x: fx + 0.5, y: fy + 0.5 };
    let best = null, bd = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!ok(fx + dx, fy + dy)) continue;
      const c = { x: fx + dx + 0.5, y: fy + dy + 0.5 }, d = dist(c, spot);
      if (d < bd) { bd = d; best = c; }
    }
    return best || { x: fx + 0.5, y: fy + 0.5 };
  }
  function settleOnPad(a, spot) {
    a.x = spot.x; a.y = spot.y; a.path = null; a.target = null; a.onArrive = null;
    a.charging = true; a.act = a.isDrone ? 'idle' : 'sit'; a.dir = a.isDrone ? 'south' : 'north'; a.actUntil = Infinity;
  }
  function dockAt(a, spot) {
    if (!spot) return false;
    if (dist(a, spot) < 0.02) { settleOnPad(a, spot); return true; }
    const glide = x => { x.path = [{ x: spot.x, y: spot.y }]; x.target = { x: spot.x, y: spot.y }; x.onArrive = y => settleOnPad(y, spot); x.act = 'walk'; };
    const near = approachTile(spot);
    if (sameTile(a, near)) { glide(a); return true; }
    return goTo(a, near, glide);
  }
  function releaseSpot(agent) {
    if (agent.claim) { if (agent.claim.kind === 'pads' && hasFx('setCharging')) FX.setCharging(agent.claim.i, false); claims[agent.claim.kind].delete(agent.claim.i); agent.claim = null; }
    agent.charging = false;
  }
  function bubble(agent, text, kind, ttl) {
    if (typeof FX === 'undefined' || !FX || typeof FX.bubble !== 'function') return;
    if (agent.bubbleRef && agent.bubbleRef.close) agent.bubbleRef.close();
    agent.bubbleRef = FX.bubble({ x: agent.x - 0.5, y: agent.y - 0.5, text, kind: kind || 'talk', ttl: ttl || T.bubbleTtlSec });
  }
  function sayBubble(agent, text, kind, ttl) { agent.bubbleText = text; agent.bubbleKind = kind; agent.bubbleUntil = frameClock + (ttl || T.bubbleTtlSec); bubble(agent, text, kind, ttl); }

  /* ---------- agent construction ---------- */
  function makeAgent(member, isDrone, n) {
    const seat = isDrone ? null : seatOf(member.key);
    const berth = roomOf(member.room);
    let start;
    if (seat) start = center(seat);
    else if (isDrone) { const b = spotsOf('workshop', 'bunks'); start = center(b[n % b.length] || { x: berth.x + 1, y: berth.y + 1 }); }
    else start = center({ x: berth.x + 2, y: berth.y + 2 });
    const a = {
      id: nextId++, key: member.key, member, isDrone: !!isDrone, name: isDrone ? 'Drone' : member.name,
      skin: member.skin, scale: (member.scale || 1) * SIZE_K,
      x: start.x, y: start.y, dir: seat ? SPRITES.faceDir(seat.face) : 'south',
      seat, berth: member.room,
      state: 'queued', plan: 'roam', act: 'idle', actUntil: 0, path: null, target: null, onArrive: null,
      frame: 0, animT: 0, blinkAt: rnd(2, 6), blinkUntil: 0,
      waitUntil: rnd(1, 6), gestureAt: rnd(20, 90), fidgetAt: rnd(5, 20), askAt: 3, talkedAt: -999,
      helpFor: null, claim: null, event: null, bubbleText: null, bubbleKind: null, bubbleUntil: 0, charging: false,
      lastSeat: null,
    };
    if (seat) seatTiles.add(tileKey(seat));
    return a;
  }

  function init(model) {
    agents.length = 0; drones.length = 0; seatTiles.clear(); doorSet = null;
    claims.pads.clear(); claims.stand.clear();
    for (const k of Object.keys(byKey)) delete byKey[k];
    for (const m of Object.values(CONFIG.MEMBERS)) {
      if (m.pool) continue;
      const a = makeAgent(m, false, 0); agents.push(a); byKey[m.key] = a;
    }
    const pool = CONFIG.MEMBERS[CONFIG.ROLES.pool];
    if (pool) {
      const n = Math.max(pool.minCount || 2, Math.min(pool.maxCount || 6, helpersTotal(model)));
      for (let i = 0; i < n; i++) { const a = makeAgent(pool, true, i); a.name = 'Drone'; agents.push(a); drones.push(a); }
    }
    onModel(model);
  }

  function helpersTotal(model) {
    let n = 0;
    if (model && model.members) for (const m of Object.values(model.members)) n += (m.helpersRunning || 0);
    return n;
  }

  /* ---------- plans from the board ---------- */
  function planFor(a, model) {
    const m = model && model.members && model.members[a.key];
    const st = m ? m.state : 'queued';
    a.state = st; a.info = m || null;
    if (st === 'working') return 'work';
    if (st === 'blocked') return 'blocked';
    if (st === 'waiting-on-you') return 'ask';
    if (st === 'sleeping' && model && model.isNight) return 'charge';
    return 'roam';
  }

  function onModel(model) {
    lastModel = model;
    for (const a of agents) {
      if (a.isDrone) continue;
      const p = planFor(a, model);
      if (p !== a.plan) {
        a.plan = p; if (!a.event) { stopActivity(a); a.waitUntil = frameClock + rnd(0.5, 3); }
        if (a.marker && hasFx('clearMarker')) { FX.clearMarker(a.marker); a.marker = null; }
        if ((p === 'blocked' || p === 'ask') && a.seat && hasFx('marker')) a.marker = FX.marker(a.seat.x, a.seat.y, p === 'ask' ? 'ask' : 'blocked');
      }
    }
    assignDrones(model);
    scheduleEvents(model);
  }

  function stopActivity(a) {
    a.path = null; a.target = null; a.onArrive = null; a.act = 'idle'; a.actUntil = 0; a.charging = false; a.typing = false; a.chargeAt = 0; a.wallSpot = null;
    if (a.plan !== 'charge' && a.plan !== 'ask') releaseSpot(a);
    if (IX() && (a.ix || a.held)) INTERACTIONS.cancel(a);   // Interactions: drop the action, put held items back
  }

  function assignDrones(model) {
    // helpers running on a queue -> drones beside that desk; the rest roam
    const needs = [];
    if (model && model.members) for (const m of Object.values(model.members)) {
      if ((m.helpersRunning || 0) > 0 && byKey[m.key] && byKey[m.key].seat) for (let i = 0; i < m.helpersRunning; i++) needs.push(m.key);
    }
    let i = 0;
    for (const mn of drones) {
      const want = needs[i++] || null;
      if (mn.helpFor !== want) { mn.helpFor = want; stopActivity(mn); mn.waitUntil = frameClock + rnd(0.2, 2); if (want) releaseSpot(mn); }   // a helper leaves its pad
      mn.plan = want ? 'help' : (model && model.isNight ? 'charge' : 'roam');
    }
  }

  /* ---------- events ---------- */
  function eventId(e) { return e.kind + '|' + (e.card || '') + '|' + (e.when instanceof Date ? e.when.toISOString() : String(e.when)); }
  function scheduleEvents(model) {
    if (!model || !model.events || model.stale) return;
    for (const e of model.events) {
      if (e.ageMinutes == null || e.ageMinutes >= T.handoffWindowMinutes) continue;
      const id = eventId(e); if (acted.has(id)) continue;
      acted.add(id);
      const from = e.from && byKey[e.from], to = e.to && byKey[e.to], merger = byKey[CONFIG.ROLES.merger];
      let actor = from, host = to, text = e.label || e.card || e.kind, where = null, kind = 'card';
      if (e.kind === 'handoff') { text = (e.card || '') + ' to review'; }
      else if (e.kind === 'verdict') { text = (e.card || '') + ' ' + (e.verdict || 'reviewed'); }
      else if (e.kind === 'closure') { host = merger; text = (e.card || '') + ' closed'; }
      else if (e.kind === 'merge') { host = merger; text = e.label || ((e.card || '') + ' merged'); actor = from || merger; }
      else if (e.kind === 'plan') { actor = byKey[CONFIG.ROLES.planner]; host = merger; text = 'plan posted'; }
      else if (e.kind === 'helpers' || e.kind === 'skip') continue;
      if (!actor || actor.event) continue;
      if (actor.plan === 'work') continue;                   // a working figure never leaves its desk
      if (!host || host === actor) continue;
      if (host.key === CONFIG.ROLES.merger) { const ms = spotsOf(host.member.room, 'meet'), mp = Array.isArray(ms) ? ms[0] : ms; where = mp ? center(mp) : besideSeat(host.seat); }
      else where = host.seat ? besideSeat(host.seat) : randomTileIn(host.berth);
      if (!where) continue;
      actor.event = { host, text, kind, where, stage: 'go', waitUntil: null };
      stopActivity(actor); actor.waitUntil = 0;
      summon(host);
    }
  }

  function hostBerth(h) { return h.seat ? h.seat : null; }
  function hostReady(h) { const t = hostBerth(h); return !t || sameTile(h, t); }
  function summon(h) {
    const t = hostBerth(h);
    if (!t || sameTile(h, t) || h.event) return;
    if (h.plan !== 'roam' && h.plan !== 'work' && h.plan !== 'blocked') return;
    stopActivity(h);
    h.summoned = true;
    if (goTo(h, t, x => { sitDown(x, x.plan === 'work' ? 'type' : 'sit'); x.waitUntil = frameClock + 30; x.summoned = false; })) h.waitUntil = frameClock + 40;
    else h.summoned = false;
  }
  /* ---------- movement ---------- */
  function goTo(a, target, onArrive) {
    if (!target) return false;
    const p = findPath(a, target);
    if (!p) return false;
    if (p.length && sameTile(p[0], a)) p.shift();
    a.path = p; a.target = center(target); a.onArrive = onArrive || null; a.act = 'walk';
    return true;
  }
  function stepPath(a, dt) {
    const help = a.isDrone && a.plan === 'help' && IX() ? (INTERACTIONS.HELPER_SPEED || 1) : 1;   // Interactions: helpers hurry (HELPER_SPEED)
    const speed = T.walkTilesPerSec * SPEED_K * (a.isDrone ? 1.25 : 1) * help;
    let allowance = speed * dt;
    if (a.turnUntil && frameClock < a.turnUntil) allowance = 0;   // the brief stop at a turn
    while (a.path && a.path.length && allowance > 0) {
      const n = a.path[0], dx = n.x - a.x, dy = n.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { a.path.shift(); continue; }
      // the leg's grid step -> a walk track; an off-centre start keeps the main axis
      const ax = Math.abs(dx), ay = Math.abs(dy), kx = ax > 0.25 * Math.max(ax, ay) ? Math.sign(dx) : 0, ky = ay > 0.25 * Math.max(ax, ay) ? Math.sign(dy) : 0;
      const tk = WALK_TRACK[kx + ',' + ky];
      // an orthogonal step keeps the track of the leg before it (the way the figure was facing); a path's first step uses the table
      // an orthogonal (grid-straight) step is a screen diagonal: keep the prior leg's track only when it points along one of
      // that diagonal's two screen components (so nobody walks backwards); otherwise use the table's track for the step
      const pick = t => (!t ? a.dir : SPRITES.hasTrack(a.skin, 'walk_' + t) ? t : WALK_FACE[t]);
      let nd;
      if ((kx && ky) || !a.legDir) nd = pick(tk);
      else { const comp = ORTH_COMPONENTS[kx + ',' + ky] || []; nd = comp.includes(a.legDir) ? a.legDir : pick(tk); }
      if (a.legDir && nd !== a.legDir && TURN_PAUSE_SEC > 0) { a.dir = nd; a.legDir = nd; a.turnUntil = frameClock + TURN_PAUSE_SEC; break; }
      a.dir = nd; a.legDir = nd;
      const step = Math.min(d, allowance);
      a.x += dx / d * step; a.y += dy / d * step; allowance -= step;
      if (step >= d - 1e-6) a.path.shift();
    }
    a.animT += dt;
    if (!a.path || !a.path.length) {
      a.path = null; a.act = 'idle'; a.legDir = null;   // a new path starts without a turn stop
      if (a.target) { a.x = a.target.x; a.y = a.target.y; }
      const cb = a.onArrive; a.onArrive = null; a.target = null;
      if (cb) cb(a);
    }
  }

  /* ---------- per-plan behavior ---------- */
  function atSeat(a) { return a.seat && sameTile(a, a.seat); }
  /* Which way a seated figure faces its desk. Read live from the CONFIG seat so the backdrop owner can set
     seat.face = 'east' / 'west' later (most hand-placed seats face 'east'; the Garden couch is 'south'). */
  function seatFace(a) {
    const live = a.seat && !a.isDrone ? seatOf(a.key) : null;
    const f = (live && live.face) || (a.seat && a.seat.face) || 'north';
    if (a.seat) a.seat.face = f;
    return SPRITES.CARDINALS.includes(f) ? f : 'north';
  }
  function canType(a, dir) {
    if (SPRITES.hasTrack) return SPRITES.hasTrack(a.skin, 'type_' + dir);
    const t = SPRITES.tracksOf ? SPRITES.tracksOf(a.skin) : []; return t.includes('type_' + dir);
  }
  function sitDown(a, track) {
    a.x = a.seat.x + 0.5; a.y = a.seat.y + 0.5;
    a.typing = track === 'type';
    a.dir = seatFace(a);
    a.act = (track === 'type' && !canType(a, a.dir)) ? 'sit' : (track || 'sit');   // no type_<face>: sit_<face> with a typing nudge
    a.actUntil = Infinity;
  }
  function doWork(a) {
    if (a.act === 'walk') return;
    if (!atSeat(a)) { if (!goTo(a, a.seat, x => sitDown(x, 'type'))) a.waitUntil = frameClock + 2; return; }
    if (IX() && INTERACTIONS.desk(a, 'work')) return;   // Interactions: a stretch or a sip at the desk
    if (a.act === 'gesture') { if (frameClock > a.actUntil) sitDown(a, 'type'); return; }
    if (!(a.act === 'type' || (a.act === 'sit' && a.typing))) sitDown(a, 'type');
    if (frameClock > a.gestureAt) { a.act = 'gesture'; a.dir = 'south'; a.actUntil = frameClock + 10; a.gestureAt = frameClock + rnd(70, 120); }
  }
  function doBlocked(a) {
    if (a.act === 'walk') return;
    if (!atSeat(a)) { if (!goTo(a, a.seat, x => sitDown(x, 'sit'))) a.waitUntil = frameClock + 2; return; }
    if (IX() && INTERACTIONS.desk(a, 'blocked')) return;   // Interactions: fidget (stretch / head turn) at the desk
    if (a.act === 'gesture') { if (frameClock > a.actUntil) sitDown(a, 'sit'); }
    else if (a.act !== 'sit') sitDown(a, 'sit');
    if (frameClock > a.fidgetAt) { a.act = 'gesture'; a.dir = 'south'; a.actUntil = frameClock + 3; a.fidgetAt = frameClock + 20; }
    if (frameClock > a.askAt) { const on = (a.info && a.info.blockedOn && a.info.blockedOn[0]) || 'something'; sayBubble(a, 'waits on ' + on, 'blocked'); a.askAt = frameClock + 30; }
  }
  function doAsk(a) {
    if (a.act === 'walk') return;
    const stand = spotsOf('bridge', 'stand');
    if (!a.claim || a.claim.kind !== 'stand') {
      const t = claimSpot('stand', stand, a) || randomTileIn('bridge');
      if (!goTo(a, t, x => { x.act = 'idle'; x.dir = 'south-west'; })) a.waitUntil = frameClock + 2;
      return;
    }
    if (frameClock > a.askAt) {
      const on = (a.info && a.info.waitingOn && a.info.waitingOn[0]) || 'an answer';
      sayBubble(a, 'needs you: ' + on, 'ask'); a.askAt = frameClock + 25;
    }
    if (frameClock > a.waitUntil) {
      // pace between stand tiles
      const i = a.claim.i, j = (i + 1) % stand.length;
      const dest = sameTile(a, stand[i]) ? stand[j] : stand[i];
      if (!claims.stand.has(j) || j === i || sameTile(a, stand[j])) goTo(a, dest, x => { x.dir = 'south-west'; });
      a.waitUntil = frameClock + rnd(6, 12);
    }
  }
  function wallRow(a) {
    const r = roomOf('charging'); if (!r) return null;
    const used = agents.filter(o => o !== a && o.wallSpot).map(o => o.wallSpot.y);
    for (let y = r.y + 1; y < r.y + r.h; y++) { const t = { x: r.x, y }; if (!used.includes(y) && walkableTile(t) && !spotsOf('charging', 'pads').some(p => p.x === t.x && p.y === t.y)) return center(t); }
    return null;
  }
  function doCharge(a) {
    if (a.act === 'walk') return;
    if (a.charging) {
      // docked: pinned to the coil centre; nothing (wander, door-tile rules, meetings) moves a charging figure
      const s = a.claim && a.claim.kind === 'pads' ? padSpot(a.claim.i) : null;
      if (s && (a.x !== s.x || a.y !== s.y)) { a.x = s.x; a.y = s.y; }
      return;
    }
    if (frameClock < (a.dockRetryAt || 0)) return;
    const pads = spotsOf('charging', 'pads');
    if (a.isDrone && !a.chargeAt) a.chargeAt = frameClock + 10;          // the crew gets first pick of the pads
    if (a.isDrone && frameClock < a.chargeAt) { if (a.act === 'idle' && frameClock > a.waitUntil) doRoam(a); return; }
    if (!a.claim || a.claim.kind !== 'pads') {
      let t = claimSpot('pads', pads, a);
      if (!t && a.isDrone) { t = wallRow(a); if (t) { a.wallSpot = t; if (!goTo(a, t, x => { x.charging = true; x.act = 'idle'; x.dir = 'south-east'; })) a.dockRetryAt = frameClock + 3; return; } }
      if (!t) { doRoam(a); return; }
    }
    // claimed (fresh, or re-docking after a talk / event interrupted the walk): approach tile, then glide onto the coil
    if (!dockAt(a, padSpot(a.claim.i))) a.dockRetryAt = frameClock + 3;
  }
  function pickWanderDest(a) {
    // 70 % own room, 20 % a leisure room, 10 % a hall; done-today 50 / 40 / 10
    const done = !a.isDrone && a.state === 'done-today';
    const pOwn = done ? 0.5 : 0.7, pLeisure = done ? 0.4 : 0.2;
    const r = Math.random();
    if (r < pOwn) return randomTileIn(a.berth);
    if (r < pOwn + pLeisure && a.member.leisure && a.member.leisure.length) {
      const room = pick(a.member.leisure), spots = spotsOf(room, 'leisure');
      const free = spots.filter(s => !agents.some(o => o !== a && ((o.target && sameTile(o.target, s)) || sameTile(o, s))));
      return free.length ? center(pick(free)) : randomTileIn(room);
    }
    const corr = pick(CONFIG.ROOMS.filter(x => x.kind === 'corridor'));
    return corr ? randomTileIn(corr.key) : randomTileIn(a.berth);
  }
  function doRoam(a) {
    if (a.act === 'walk' || a.act === 'talk') return;
    if (a.charging && a.plan === 'charge' && a.claim && a.claim.kind === 'pads') return;   // a docked figure never wanders off its pad
    if (a.claim) releaseSpot(a);
    a.charging = false;
    if (IX() && INTERACTIONS.roam(a)) return;   // Interactions: one action per ~90 s, otherwise sit at the own seat (Drones: lamps, shuttle cargo)
    if (frameClock < a.waitUntil) return;
    const dest = pickWanderDest(a);
    if (dest && goTo(a, dest, x => { x.act = 'idle'; if (hallSpot(x)) x.waitUntil = Math.min(x.waitUntil, frameClock + 3); })) {
      const w = a.isDrone ? rnd(DRONE_WANDER_WAIT[0], DRONE_WANDER_WAIT[1]) : rnd(WANDER_WAIT[0], WANDER_WAIT[1]);
      a.waitUntil = frameClock + w + 2;
    } else a.waitUntil = frameClock + 2;
  }
  /* Helping: INTERACTIONS.help runs a fast job loop in the helped member's room (knobs HELPER_* at the top of
     interactions.js). The gesture beside the desk below is only the fallback before INTERACTIONS has built its registry. */
  function doHelp(a) {
    if (a.act === 'walk') return;
    const host = byKey[a.helpFor];
    if (!host || !host.seat) { doRoam(a); return; }
    if (IX() && INTERACTIONS.help(a, host)) return;   // Interactions: the helper job loop
    if (!a.target && !(a.helpSpot && sameTile(a, a.helpSpot))) {
      a.helpSpot = besideSeat(host.seat);
      if (!goTo(a, a.helpSpot, x => { x.act = 'gesture'; x.dir = 'north-east'; x.actUntil = Infinity; })) a.waitUntil = frameClock + 2;
      return;
    }
    if (a.act === 'idle') { a.act = 'gesture'; a.actUntil = Infinity; }
  }
  function doEvent(a) {
    const ev = a.event;
    if (!ev) return;
    if (a.act === 'walk') return;
    if (ev.stage === 'go') {
      ev.stage = 'going';
      if (!goTo(a, ev.where, x => { ev.stage = 'talk'; })) { a.event = null; a.waitUntil = frameClock + 1; }
      return;
    }
    if (ev.stage === 'going') { ev.stage = 'wait'; ev.waitUntil = frameClock + 20; a.act = 'idle'; a.dir = SPRITES.headingToDir(ev.host.x - a.x, ev.host.y - a.y) || 'south'; }
    if (ev.stage === 'wait') {
      if (!hostReady(ev.host) && ev.host.act === 'walk' && frameClock < ev.waitUntil) return;
      if (!hostReady(ev.host) && frameClock < ev.waitUntil) { if (!ev.host.summoned) summon(ev.host); return; }
      ev.stage = 'talk';
    }
    if (ev.stage === 'talk') {
      const h = ev.host;
      a.dir = SPRITES.headingToDir(h.x - a.x, h.y - a.y) || 'south';
      a.act = 'talk'; a.actUntil = frameClock + T.talkSec;
      if (h.act !== 'walk') { h.prevAct = h.act; h.prevDir = h.dir; h.act = 'talk'; h.actUntil = frameClock + T.talkSec; h.dir = SPRITES.headingToDir(a.x - h.x, a.y - h.y); }
      sayBubble(a, ev.text, ev.kind, T.talkSec);
      ev.stage = 'talking';
      return;
    }
    if (ev.stage === 'talking') {
      if (frameClock < a.actUntil) return;
      const h = ev.host;
      if (h.act === 'talk') { h.act = h.prevAct === 'type' || h.prevAct === 'sit' ? h.prevAct : 'idle'; if (h.prevDir) h.dir = h.prevDir; h.actUntil = h.act === 'idle' ? 0 : Infinity; }
      ev.stage = 'berth';
      const berth = a.seat ? a.seat : randomTileIn(a.berth);
      a.act = 'idle';
      if (!goTo(a, berth, x => { x.event = null; x.waitUntil = frameClock + 1; x.act = 'idle'; })) { a.event = null; }
      return;
    }
  }

  /* ---------- chance meetings ---------- */
  function meetings() {
    const roamers = agents.filter(a => (a.plan === 'roam' || (a.isDrone && a.plan !== 'help')) && !a.event && a.act !== 'talk' && !a.charging && !a.ix);   // Interactions: never interrupt an action
    for (let i = 0; i < roamers.length; i++) for (let j = i + 1; j < roamers.length; j++) {
      const a = roamers[i], b = roamers[j];
      if (frameClock - a.talkedAt < MEET_EVERY_SEC || frameClock - b.talkedAt < MEET_EVERY_SEC) continue;
      if (dist(a, b) > 1.5) continue;
      for (const [p, q] of [[a, b], [b, a]]) {
        p.path = null; p.target = null; p.onArrive = null;
        p.dir = SPRITES.headingToDir(q.x - p.x, q.y - p.y); p.act = 'talk'; p.actUntil = frameClock + T.talkSec;
        p.talkedAt = frameClock; p.waitUntil = frameClock + T.talkSec + rnd(2, 6);
      }
      if (accompNextAt === null) accompNextAt = frameClock + rnd(ACCOMP_EVERY_SEC[0] / 3, ACCOMP_EVERY_SEC[1] / 3);   // the first one comes sooner
      if (frameClock >= accompNextAt && accomplishmentChat(a, b)) accompNextAt = frameClock + rnd(ACCOMP_EVERY_SEC[0], ACCOMP_EVERY_SEC[1]);   // a real card closed today or yesterday
      else {
        sayBubble(a, pick(PHRASES), 'talk', T.talkSec * 0.6);
        setTimeout(() => { if (b.act === 'talk') sayBubble(b, pick(PHRASES), 'talk', T.talkSec * 0.5); }, 2500);
      }
      roamers.splice(j, 1); roamers.splice(i, 1); i--; break;
    }
  }

  /* ---------- tick ---------- */
  let lastNight = null;
  function tick(dt, model, now) {
    frameClock += dt;
    if (IX()) INTERACTIONS.tick(dt, model);   // Interactions: shuttle, lamps, particles, persistence
    if (model && (model !== lastModel || model.isNight !== lastNight)) { lastNight = model.isNight; onModel(model); }
    for (const a of agents) {
      // timed activities end
      if (a.act === 'talk' && frameClock > a.actUntil && !a.event) { a.act = a.charging ? 'sit' : 'idle'; a.actUntil = 0; }
      if (a.act === 'walk' && a.path) stepPath(a, dt);
      else if (a.act === 'walk') { a.act = 'idle'; }
      if (a.event) { doEvent(a); }
      else if (a.act === 'talk') { /* conversation in progress */ }
      else if (a.isDrone) { if (a.plan === 'help') doHelp(a); else if (a.plan === 'charge') doCharge(a); else doRoam(a); }
      else switch (a.plan) {
        case 'work': doWork(a); break;
        case 'blocked': doBlocked(a); break;
        case 'ask': doAsk(a); break;
        case 'charge': doCharge(a); break;
        default: doRoam(a);
      }
      if (a.bubbleRef) { if (a.bubbleRef.dead) a.bubbleRef = null; else a.bubbleRef.moveTo(a.x - 0.5, a.y - 0.5); }
      // animation clocks
      a.animT += dt;
      if (a.act === 'idle') {
        if (frameClock > a.blinkAt) { a.blinkUntil = frameClock + 0.15; a.blinkAt = frameClock + rnd(3, 7); }
        if (!a.isDrone && !a.charging && frameClock > a.gestureAt) { a.act = 'gesture'; a.actUntil = frameClock + 2.5; a.gestureAt = frameClock + rnd(25, 60); }
      }
      if (a.act === 'gesture' && frameClock > a.actUntil && a.actUntil !== Infinity) { a.act = a.charging ? 'sit' : 'idle'; }
    }
    meetings();
  }

  /* ---------- drawing ---------- */
  function trackFor(a) {
    if (IX()) { const ix = INTERACTIONS.pose(a); if (ix) return ix; }   // Interactions: action frames, carry while walking
    const idle = a.act === 'idle' || a.act === 'stand';
    if (a.act === 'walk') { const n = SPRITES.frames(a.skin, 'walk', a.dir) || 4; return { track: 'walk', dir: a.dir, frame: Math.floor(a.animT * (n >= 8 ? 10 : 6) * SPEED_K) }; }   // 4-frame sheets step slower so a stride matches ~1 tile/s
    // some skins have diagonal sit/type tracks: use the figure's facing when the skin has it, else the nearest cardinal
    if (a.act === 'type') return { track: 'type', dir: SPRITES.hasTrack(a.skin, 'type_' + a.dir) || SPRITES.CARDINALS.includes(a.dir) ? a.dir : 'north', frame: Math.floor(a.animT * 6) };
    if (a.act === 'sit') return { track: 'sit', dir: SPRITES.hasTrack(a.skin, 'sit_' + a.dir) || SPRITES.CARDINALS.includes(a.dir) ? a.dir : 'north', frame: 0 };
    if (a.act === 'talk') { const f = SPRITES.frames(a.skin, 'talk', a.dir); return { track: 'talk', dir: a.dir, frame: Math.floor(a.animT * (f > 2 ? 8 : 4)) }; }
    if (a.act === 'gesture') return { track: 'gesture', dir: a.dir, frame: Math.floor(a.animT * 8) };
    if (idle && frameClock < a.blinkUntil && a.dir === 'south') return { track: 'blink', dir: 'south', frame: 0 };
    return { track: 'rot', dir: a.dir, frame: 0 };
  }
  /* Figures scale with the painting and snap to its pixel grid. */
  const backdropOn = () => typeof BACKDROP !== 'undefined' && BACKDROP && typeof BACKDROP.active === 'function' && BACKDROP.active();
  function pixelScale() { if (!backdropOn()) return 1; return (typeof BACKDROP.pixelScale === 'function') ? (BACKDROP.pixelScale() || 1) : 1.68; }
  function snapPoint(sx, sy) {
    if (!backdropOn()) return { sx, sy };
    if (typeof BACKDROP.snap === 'function') { const p = BACKDROP.snap(sx, sy); if (p && p.sx != null) return p; if (p && p.x != null) return { sx: p.x, sy: p.y }; }
    const ps = pixelScale(); return { sx: Math.round(sx / ps) * ps, sy: Math.round(sy / ps) * ps };
  }
  function figureScale(a) { return a.scale * pixelScale(); }
  function drawAgent(ctx, a) {
    const s0 = ISO.toScreen(a.x, a.y);
    const s = snapPoint(s0.sx, s0.sy);
    const sc = figureScale(a), ps = pixelScale();
    ctx.save();
    if (ps !== 1) {
      // flat iso ellipse in two steps (a darker core inside a softer rim), on the painting's grid
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy + ps, 16 * sc, 8 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy + ps, 10 * sc, 5 * sc, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy + 1, 15 * sc, 7 * sc, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    const t = trackFor(a);
    const nudge = (a.act === 'sit' && a.typing) ? (Math.floor(a.animT / 0.4) % 2) * ps : 0;
    SPRITES.draw(ctx, a.skin, t.track, t.dir, t.frame, s.sx, s.sy + 4 * sc - nudge - (t.lift || 0) * ps, sc);   // Interactions: lift = carry bob
  }
  function drawables() {
    return agents.map(a => ({ depth: ISO.depth(a.x, a.y, 0) + 0.01, draw: ctx => drawAgent(ctx, a) }));
  }
  function drawOverlay(ctx, camera) {
    const z = (camera && camera.state && camera.state().zoom) || 1;
    const k = 1 / Math.max(0.6, Math.min(1.6, z));
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = Math.round(14 * k) + 'px VT323, monospace';
    for (const a of agents) {
      if (a.isDrone && z < 0.7) continue;
      const s = ISO.toScreen(a.x, a.y);
      const top = s.sy - 92 * figureScale(a) * 0.78;
      const label = a.name;
      const w = ctx.measureText(label).width + 10 * k, h = 15 * k;
      const px = s.sx, py = top - 6 * k;
      ctx.fillStyle = 'rgba(8,8,12,0.72)';
      roundRect(ctx, px - w / 2, py - h / 2, w, h, 4 * k); ctx.fill();
      ctx.fillStyle = a.key === CONFIG.ROLES.merger ? CONFIG.PALETTE.amber : (a.isDrone ? CONFIG.PALETTE.textDim : CONFIG.PALETTE.text);
      ctx.fillText(label, px, py + 1);
      // state glyph
      let glyph = null, color = null;
      if (a.state === 'waiting-on-you' && !a.isDrone) { glyph = '?'; color = CONFIG.PALETTE.amber; }
      else if (a.state === 'blocked' && !a.isDrone) { glyph = '⛓'; color = CONFIG.PALETTE.red; }
      if (a.charging) {
        const gx = px + w / 2 + 8 * k, gy = py, u = 1.1 * k;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(frameClock * 5 + a.id); ctx.fillStyle = CONFIG.PALETTE.cyan;
        ctx.beginPath(); ctx.moveTo(gx + 1 * u, gy - 7 * u); ctx.lineTo(gx - 3 * u, gy + 1 * u); ctx.lineTo(gx, gy + 1 * u); ctx.lineTo(gx - 1 * u, gy + 7 * u);
        ctx.lineTo(gx + 3 * u, gy - 1 * u); ctx.lineTo(gx, gy - 1 * u); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (glyph) {
        const pulse = 0.7 + 0.3 * Math.sin(frameClock * 4 + a.id);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = color; ctx.font = Math.round(16 * k) + 'px VT323, monospace';
        ctx.fillText(glyph, px + w / 2 + 8 * k, py);
        ctx.font = Math.round(14 * k) + 'px VT323, monospace'; ctx.globalAlpha = 1;
      }
      // fallback bubble when FX is absent
      if ((typeof FX === 'undefined' || !FX || typeof FX.bubble !== 'function') && a.bubbleText && frameClock < a.bubbleUntil) {
        const bw = ctx.measureText(a.bubbleText).width + 12 * k, bh = 16 * k, by = py - 18 * k;
        ctx.fillStyle = a.bubbleKind === 'blocked' ? 'rgba(90,20,20,0.9)' : a.bubbleKind === 'ask' ? 'rgba(110,70,10,0.9)' : 'rgba(20,30,50,0.9)';
        roundRect(ctx, px - bw / 2, by - bh / 2, bw, bh, 4 * k); ctx.fill();
        ctx.fillStyle = CONFIG.PALETTE.text; ctx.fillText(a.bubbleText, px, by + 1);
      }
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function hitTest(wx, wy) {
    const sorted = agents.slice().sort((a, b) => ISO.depth(b.x, b.y, 0) - ISO.depth(a.x, a.y, 0));
    for (const a of sorted) {
      const s = ISO.toScreen(a.x, a.y), sc = figureScale(a);
      let hw = 18 * sc, hh = 60 * sc, pad = 2;
      const z = (typeof CAMERA !== 'undefined' && CAMERA && CAMERA.state) ? (CAMERA.state().zoom || 1) : 1;
      if (z < 0.8) { const m = 44 / z; hw = Math.max(hw, m / 2); if (hh < m) { pad = (m - hh) / 2; hh = m - pad; } }   // a 44 CSS px thumb rect around the body's center
      if (wx >= s.sx - hw && wx <= s.sx + hw && wy >= s.sy - hh && wy <= s.sy + pad) return a;
    }
    return null;
  }
  function captionFor(a, model) {
    const m = model && model.members && model.members[a.key];
    const room = roomOf(a.member.room);
    const role = (m && m.role) || (room ? room.name : '');
    if (a.isDrone) {
      const l = ['short-lived helpers for a busy queue'];
      if (a.helpFor && byKey[a.helpFor]) l.push('helping ' + byKey[a.helpFor].name + ' right now');
      else l.push(a.charging ? 'charging' : 'between jobs, wandering the halls');
      return { title: 'Drone (helper)', lines: l };
    }
    const lines = [];
    const stateText = { working: 'Working', queued: 'Queued', 'waiting-on-you': 'Waiting on you', blocked: 'Blocked', 'done-today': 'Done today', sleeping: a.charging ? 'Charging' : 'Idle' };
    lines.push(stateText[a.state] || a.state);
    if (m && m.task) lines.push(m.task);
    if (m && m.card) lines.push('card: ' + m.card);
    if (m && m.since) lines.push('since ' + m.since);
    if (m && m.helpersRunning) lines.push(m.helpersRunning + ' helper' + (m.helpersRunning === 1 ? '' : 's') + ' running');
    if (m && m.waitingOn && m.waitingOn.length) lines.push('waiting on: ' + m.waitingOn.slice(0, 3).join(', '));
    if (m && m.blockedOn && m.blockedOn.length) lines.push('blocked on: ' + m.blockedOn[0]);
    if (m && m.minutesSinceRun != null) lines.push('last run ' + m.minutesSinceRun + ' min ago');
    return { title: a.name + ' (' + role + ')', lines, member: a.key };
  }
  function litRooms(model) {
    const out = new Set();
    if (model && model.members) for (const m of Object.values(model.members)) {
      if (m.state === 'working' || m.activeRecently) { const c = CONFIG.MEMBERS[m.key]; if (c && c.room) out.add(c.room); }
    }
    for (const a of agents) if (a.act === 'type') out.add(a.member.room);
    return Array.from(out);
  }

  return { init, onModel, tick, drawables, drawOverlay, hitTest, captionFor, litRooms,
           _ix: { goTo, sitDown, figureScale, snapPoint }, _accomplishments: accomplishments, _accomplishmentChat: accomplishmentChat,   // Interactions: the movement helpers INTERACTIONS drives figures with
           get list() { return agents; }, get byKey() { return byKey; } };
})();
