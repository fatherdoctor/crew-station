/* Crew station: HUD. Header, captions, legend, toast, stale banner. DOM over the canvas. */
'use strict';

const HUD = (() => {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const el = {};
  let model = null, toastTimer = null, onPick = null;

  const $ = id => document.getElementById(id);
  function mk(tag, id, cls, parent) { const n = document.createElement(tag); if (id) n.id = id; if (cls) n.className = cls; (parent || el.hud).appendChild(n); return n; }
  const pad2 = n => (n < 10 ? '0' : '') + n;

  function init(opts) {
    onPick = opts && opts.onPick;
    el.hud = $('hud'); el.top = $('hud-top'); el.title = $('hud-title'); el.clock = $('hud-clock'); el.right = $('hud-right');
    el.board = $('hud-board'); if (el.board) el.board.href = new URLSearchParams(location.search).get('board') || CONFIG.BOARD_URL; el.stale = $('hud-stale'); el.caption = $('hud-caption'); el.toast = $('hud-toast');

    // clock pieces
    el.clock.innerHTML = '';
    el.clockMain = mk('span', 'hud-clock-main', null, el.clock);
    el.clockAge = mk('span', 'hud-clock-age', null, el.clock);
    el.meta = mk('span', 'hud-meta', null, el.clock);

    // legend button + demo pill in the header's right side
    el.legendBtn = mk('button', 'hud-legend-btn', null, el.right);
    el.legendBtn.type = 'button'; el.legendBtn.textContent = '?'; el.legendBtn.title = 'How to read it'; el.legendBtn.setAttribute('aria-expanded', 'false');
    el.right.insertBefore(el.legendBtn, el.board);
    el.demo = mk('span', 'hud-demo', null, el.right); el.demo.textContent = 'demo'; el.demo.hidden = true;
    el.right.insertBefore(el.demo, el.legendBtn);

    // legend panel
    el.legend = mk('div', 'hud-legend'); el.legend.hidden = true;
    el.legend.innerHTML = '<h3>How to read it</h3><ul>' +
      '<li><i class="lg lg-lit"></i>A lit room: someone worked there within the hour</li>' +
      '<li><i class="lg lg-room">A</i>Click a room floor: what it is and who works there</li>' +
      '<li><i class="lg lg-ask">?</i>An amber ? on a nameplate: waiting on you</li>' +
      '<li><i class="lg lg-chain"></i>A red chain at the desk: blocked, and on what</li>' +
      '<li><i class="lg lg-pad"></i>Charging pads glow at night: idle crew docks there</li>' +
      '<li><i class="lg lg-parcel"></i>A parcel in the hall: a real hand-off, with its card code</li>' +
      '<li><i class="lg lg-dock"></i>The dock on the east edge: the epics, lit as cards close</li>' +
      '</ul><p>Drag to pan, wheel or pinch to zoom, double-click a room to frame it, 0 fits, T tours.</p>' +
      '<button type="button" class="hud-close" aria-label="Close">&times;</button>';
    el.legend.querySelector('.hud-close').addEventListener('click', () => toggleLegend(false));
    el.legendBtn.addEventListener('click', () => toggleLegend());

    // footer
    el.footer = mk('div', 'hud-footer'); el.footer.textContent = 'read-only view of the board file';

    addEventListener('keydown', e => { if (e.key === 'Escape') { caption(null); toggleLegend(false); } });
    if (typeof CAMERA !== 'undefined' && CAMERA.onPick) CAMERA.onPick((cx, cy) => { if (onPick) onPick(cx, cy); });
  }

  function toggleLegend(force) {
    const show = force === undefined ? el.legend.hidden : force;
    el.legend.hidden = !show; el.legendBtn.setAttribute('aria-expanded', String(show));
  }

  function setModel(m) {
    model = m;
    el.demo.hidden = !(m && m.demo);
    const bits = [];
    if (m && m.cycle && m.cycle.n != null) bits.push('cycle ' + m.cycle.n + (m.cycle.name ? ' · ' + m.cycle.name : ''));
    if (m && m.load) bits.push('load ' + Math.round(m.load.usedPct) + '%');
    el.meta.textContent = bits.join(' · ');
    el.meta.hidden = !bits.length;
    refreshAge();
  }

  function genTime() {
    const t = model && model.generatedText && /(\d{1,2}:\d{2})/.exec(model.generatedText);
    if (t) return t[1];
    if (model && model.generated instanceof Date && !isNaN(model.generated)) return pad2(model.generated.getHours()) + ':' + pad2(model.generated.getMinutes());
    return '';
  }

  function refreshAge() {
    if (!model) return;
    const age = Math.max(0, Math.round(model.ageMinutes || 0));
    if (model.stale) {
      el.clockAge.textContent = 'board is ' + age + ' min old';
      el.clockAge.classList.add('stale');
      el.stale.textContent = 'the board file is ' + age + ' minutes old · new events are not acted out';
      el.stale.hidden = false;
    } else {
      el.clockAge.textContent = 'board ' + genTime();
      el.clockAge.classList.remove('stale');
      el.stale.hidden = true;
    }
  }

  let lastClockText = '';
  function tick(dt, m, clock) {
    if (m && m !== model) setModel(m);
    const d = clock instanceof Date ? clock : new Date();
    const text = DAYS[d.getDay()] + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (model && model.isNight ? ' ☽' : '');
    if (text !== lastClockText) { el.clockMain.textContent = text; lastClockText = text; }
    if (model && model.ageMinutes != null) {
      const ageNow = Math.round(model.ageMinutes);
      if (ageNow !== refreshAge._last) { refreshAge._last = ageNow; refreshAge(); }
    }
  }

  function caption(c) {
    if (!c) { el.caption.hidden = true; el.caption.innerHTML = ''; return; }
    el.caption.innerHTML = '';
    const h = mk('h3', null, null, el.caption); h.textContent = c.title || '';
    if (c.subtitle) { const s = mk('div', null, 'hud-sub', el.caption); s.textContent = c.subtitle; }
    const body = mk('div', null, 'hud-lines', el.caption);
    for (const line of (c.lines || [])) {
      if (line == null || line === '') continue;
      const p = mk('div', null, 'hud-line', body);
      if (typeof line === 'object' && line.label != null) { const b = mk('b', null, null, p); b.textContent = line.label + ' '; p.appendChild(document.createTextNode(String(line.text != null ? line.text : ''))); }
      else p.textContent = String(line);
    }
    if (c.link) {
      const a = mk('a', null, 'hud-link', el.caption);
      a.href = typeof c.link === 'string' ? c.link : c.link.href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = (typeof c.link === 'object' && c.link.text) || 'Open on the board ↗';
    }
    const x = mk('button', null, 'hud-close', el.caption); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
    x.addEventListener('click', () => caption(null));
    el.caption.hidden = false;
  }

  /* A room click: the room's description, everyone seated there (CONFIG seats: name, role, current state from
     BOARD.model), then anyone else standing in it right now (AGENTS.list positions), crew first, drones counted. */
  function roomCaption(roomKey, m) {
    const room = CONFIG.ROOMS.find(r => r.key === roomKey);
    if (!room) return { title: roomKey, lines: [] };
    const lines = [];
    const mm = (m || model || {}).members || {};
    const who = (key) => { const mem = mm[key], cfg = CONFIG.MEMBERS[key] || {}; return { mem, name: (mem && mem.name) || cfg.name || key, role: (mem && mem.role) || cfg.role || '' }; };
    const seated = Object.keys(room.seats || {});
    for (const key of seated) {
      const w = who(key);
      if (!w.mem) { lines.push({ label: w.name + (w.role ? ', ' + w.role : '') + ':', text: 'not on the board' }); continue; }
      let t = stateLabel(w.mem.state);
      if (w.mem.task) t += ' · ' + w.mem.task;
      lines.push({ label: w.name + (w.role ? ', ' + w.role : '') + ':', text: t });
    }
    if (!seated.length && room.kind !== 'dock') lines.push('No desks here.');
    // standing in the room now (not at their own seat in it)
    const list = (typeof AGENTS !== 'undefined' && AGENTS.list) || [];
    const here = list.filter(a => typeof a.x === 'number' && typeof WORLD !== 'undefined' && WORLD.roomAt && WORLD.roomAt(Math.floor(a.x), Math.floor(a.y)) === roomKey);
    const visitors = here.filter(a => !a.isDrone && !seated.includes(a.key));
    const drones = here.filter(a => a.isDrone).length;
    if (visitors.length || drones) {
      const bits = visitors.map(a => { const w = who(a.key); return w.name + (w.mem ? ' (' + stateLabel(w.mem.state).toLowerCase() + ')' : ''); });
      if (drones) bits.push(drones + (drones === 1 ? ' drone' : ' drones'));
      lines.push({ label: 'Here now:', text: bits.join(', ') });
    }
    if (room.kind === 'dock' && m && m.epics) for (const e of m.epics.slice(0, 8)) lines.push({ label: e.code, text: (e.name || 'Unnamed') + (e.pct != null ? ' · ' + Math.round(e.pct * 100) + '%' : '') });
    return { title: room.name, subtitle: room.desc || '', lines };
  }

  function stateLabel(s) {
    return { 'working': 'Working', 'queued': 'Queued', 'waiting-on-you': 'Waiting on you', 'blocked': 'Blocked', 'done-today': 'Done today', 'sleeping': 'Idle' }[s] || (s || '');
  }

  function toast(text) {
    el.toast.textContent = text; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3000);
  }

  return { init, setModel, tick, caption, roomCaption, toast, stateLabel, toggleLegend };
})();
