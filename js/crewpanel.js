/* Crew station: CREWPANEL. The crew list beside the station.
   Sections: Needs attention (waiting on you + blocked), Working now, then queued / done today / sleeping folded into
   one "N more crew" row; every row a <details> with points, streaks and runs. Below the rows, a "Numbers: use, points,
   trophies" disclosure: inline SVG, collapsed by default, open/closed kept in sessionStorage. Data: the raw crew block's
   usage_48h, days, members[].points_7d, spent_vs_earned and trophies. Bar colours are per member (--m-<key> in
   station.css).

   Data: the board file only. Rows are the raw `crew.members` (BOARD.raw: role, art, points_cycle, points_7d, best_streak,
   closed_7d, runs_7d, counts, helpers, last_run) with the live StationModel member laid over them (BOARD.model:
   state, task, card, since, waitingOn, blockedOn, runsToday, streak), so ?demo=1 state changes show here too.

   Desktop (>= 900 px): a fixed left column; CAMERA.setInsets(width, 0) keeps the station centred right of it.
   Phone: a one-line bar at the bottom (CAMERA.setInsets(0, barHeight)); tapping it opens the panel over the station;
   open/closed is remembered in sessionStorage. A row's "Show on the station" (or a desktop row click) glides the camera
   to the member's figure, opens its HUD caption and rings it for a moment. Silent. No network calls. */
'use strict';

const CREWPANEL = (() => {
  const DESKTOP = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px)') : { matches: true, addEventListener() {} };
  const KEY_OPEN = 'crewstation.panel.open', KEY_NUMS = 'crewstation.panel.numbers';
  // board state label <-> state key (the board's CREW_ST); the art files are named by the key
  const CREW_ST = { 'Waiting on you': 'waiting-on-you', Blocked: 'blocked', Working: 'working', Queued: 'queued',
    'Done today': 'done-today', Sleeping: 'sleeping' };
  const LABEL = {}; for (const k of Object.keys(CREW_ST)) LABEL[CREW_ST[k]] = k;
  const CREW_SECS = [['Needs attention', ['Waiting on you', 'Blocked']], ['Working now', ['Working']]];
  const CREW_REST = [['Queued', 'queued'], ['Done today', 'done'], ['Sleeping', 'sleeping']];   // [state, word in the summary]

  const el = {};
  let generated = '', openRows = new Set(), restOpen = false, numsOpen = false, ring = null, lastSig = '';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => n == null ? '–' : (Math.round(n * 10) / 10).toString();
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  /* ---- row helpers ---- */
  function crewAgo(t) {
    if (!t) return '';
    // board times are the board's wall clock, so measure from the board's own generated time, not the viewer's clock
    const g = String(generated || '').slice(0, 16);
    const m = Math.round((Date.parse(g.replace(' ', 'T')) - Date.parse(String(t).replace(' ', 'T'))) / 60000);
    if (!isFinite(m)) return '';
    return m < 1 ? 'just now' : m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : String(t).slice(5);
  }
  function crewWhen(m) {
    const a = crewAgo(m.since);
    if (!a) return '';
    return m.state === 'Working' ? 'Started ' + a + (a === 'just now' ? '' : ' ago') : m.state === 'Done today' ? 'Finished ' +
      a + (a === 'just now' ? '' : ' ago') : m.state === 'Sleeping' ? 'Skipped ' + a + (a === 'just now' ? '' : ' ago') : a;
  }
  function crewArt(m) {
    const k = CREW_ST[m.state] || 'sleeping';
    if (!m.art) return '<div class="art none" aria-hidden="true">' + esc(String(m.name || '?').slice(0, 1)) + '</div>';
    const base = (typeof CONFIG !== 'undefined' && CONFIG.ART_URL) || 'assets/crew/';
    const u = (n) => base + esc(m.art) + '-' + k + '-' + n + 'x.webp';
    return '<div class="art"><img src="' + u(1) + '" srcset="' + u(1) + ' 1x, ' + u(2) + ' 2x" width="96" ' +
      'alt="' + esc(m.name + ', ' + m.state) + '" loading="lazy" decoding="async"></div>';
  }
  function crewDetails(m) {
    const pts7 = (m.points_7d || []).reduce((a, p) => a + (+p.points || 0), 0), d = [];
    if (m.waiting_on && m.waiting_on.length) d.push(['Waiting on you', m.waiting_on.join(', ')]);
    if (m.blocked_on && m.blocked_on.length) d.push(['Waits on', m.blocked_on.join('; ')]);
    if (m.card) d.push(['Card', m.card]);
    if (m.key === CONFIG.ROLES.pool && m.helpers) {
      const n = m.helpers, by = Object.entries(n.by_queue || {}).sort((x, y) => y[1] - x[1]).map(([k, c]) => k + ' ' + c);
      const cnt = +n.count || 0;
      d.push([n.hours ? 'Last ' + n.hours + ' h' : 'Recent', cnt + ' helper' + (cnt === 1 ? '' : 's') + (by.length ? ' (' + by.join(', ') + ')' : '')]);
    } else if (m.counts === 'runs') {
      d.push(['Runs', (+m.runs_today || 0) + ' today, ' + (+m.runs_7d || 0) + ' in 7 days (overhead: earns no points by design)']);
    } else {
      d.push(['Points', fmt(m.points_cycle) + ' this cycle, ' + fmt(pts7) + ' in 7 days']);
      if (m.streak != null) d.push(['Clean streak', m.streak + (m.best_streak != null ? ' (best ' + m.best_streak + ')' : '')]);
      if (m.queue) d.push(['Closed', (+m.closed_7d || 0) + ' cards in 7 days']);
    }
    if (m.last_run) d.push(['Last run', m.last_run]);
    return '<div class="more"><dl>' + d.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
      '<button type="button" class="cp-find" data-key="' + esc(m.key) + '">Show on the station</button></div>';
  }
  function crewRow(m) {
    const k = CREW_ST[m.state] || 'sleeping', when = crewWhen(m);
    return '<details class="crow st-' + k + '" data-key="' + esc(m.key) + '"' + (openRows.has(m.key) ? ' open' : '') + '><summary>' + crewArt(m) +
      '<div class="txt"><span class="name">' + esc(m.name || m.key) + '</span><span class="role">' + esc(m.role || '') +
      '</span><span class="task">' + esc(m.task || 'No current task') +
      '</span><span class="meta"><span class="chip-st st-' + k + '">' + esc(m.state) + '</span>' + (when ? '<span>' + esc(when) +
      '</span>' : '') + '</span></div></summary>' + crewDetails(m) + '</details>';
  }
  function crewSection(title, ms) {
    return ms.length ? '<section class="crewsec"><h3><span>' + esc(title) + '</span><small>' + ms.length + ' crew</small></h3>' +
      ms.map(crewRow).join('') + '</section>' : '';
  }

  /* ---- Numbers: charts (crewUsage, crewBars, crewSpent, trophies) ---- */
  function crewUsage(u) {
    if (!u.length) return '<p class="notes">No load readings in the last 48 hours.</p>';
    const W = 360, H = 130, L = 28, R = 8, T = 8, B = 18;
    const ts = u.map((p) => Date.parse(p.t.replace(' ', 'T'))), t1 = Math.max(...ts), t0 = t1 - 48 * 3600000;
    const yMax = Math.min(100, Math.max(10, Math.ceil(Math.max(...u.map((p) => p.used_pct)) / 10) * 10));
    const X = (t) => L + (W - L - R) * (t - t0) / (t1 - t0 || 1), Y = (v) => T + (H - T - B) * (1 - v / yMax);
    let g = '';
    for (let v = 0; v <= yMax; v += yMax / 2) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) +
      '"/><text x="' + (L - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v + '%</text>';
    g += '<text x="' + L + '" y="' + (H - 4) + '">48 h ago</text><text x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' +
      esc(u[u.length - 1].t.slice(5)) + '</text>';
    const pts = u.map((p, i) => X(ts[i]).toFixed(1) + ',' + Y(p.used_pct).toFixed(1)).join(' ');
    const last = u[u.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Load, last 48 hours, now ' + fmt(last.used_pct) + '%">' + g +
      '<polyline points="' + pts + '" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + X(ts[ts.length - 1]) + '" cy="' + Y(last.used_pct) + '" r="3" fill="var(--blue)"/></svg>';
  }
  const memberFill = (key) => 'var(--m-' + String(key).replace(/[^a-z0-9_-]/gi, '') + ', var(--dim))';
  function crewBars(c) {
    const days = c.days || [];
    const ms = (c.members || []).filter((m) => (m.points_7d || []).some((p) => p.points > 0));
    if (!ms.length || !days.length) return '<p class="notes">No points logged in the last 7 days.</p>';
    const W = 360, H = 130, L = 28, R = 8, T = 8, B = 18, n = days.length, bw = (W - L - R) / n;
    const pt = (m, i) => (m.points_7d[i] && +m.points_7d[i].points) || 0;
    const tot = days.map((d, i) => ms.reduce((a, m) => a + pt(m, i), 0));
    const yMax = Math.max(10, Math.ceil(Math.max(...tot) / 10) * 10), Y = (v) => (H - T - B) * v / yMax;
    let g = '';
    for (let v = 0; v <= yMax; v += yMax / 2) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B - Y(v)) +
      '" y2="' + (H - B - Y(v)) + '"/><text x="' + (L - 4) + '" y="' + (H - B - Y(v) + 3) + '" text-anchor="end">' + v + '</text>';
    days.forEach((d, i) => {
      let y = H - B;
      ms.forEach((m) => {
        const p = pt(m, i);
        if (!p) return;
        y -= Y(p);
        g += '<rect x="' + (L + i * bw + 3).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 6).toFixed(1) + '" height="' +
          Y(p).toFixed(1) + '" fill="' + memberFill(m.key) + '"><title>' + esc((m.name || m.key) + ' ' + d.slice(5) + ': ' + fmt(p) + ' pts') + '</title></rect>';
      });
      g += '<text x="' + (L + (i + 0.5) * bw).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(d.slice(8)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Points per day by crew member, last 7 days">' + g + '</svg>' +
      '<div class="crewkey">' + ms.map((m) => '<span><i style="background:' + memberFill(m.key) + '"></i>' + esc(m.name || m.key) + '</span>').join('') + '</div>';
  }
  // load spent per day, in points, beside the points logged
  function crewSpent(rows) {
    const r = (rows || []).filter((x) => x.spent != null || x.earned);
    if (!r.length) return '<p class="notes">No load readings or logged points in the last 7 days.</p>';
    const withS = r.filter((x) => x.spent != null);
    const n = (v) => (v == null ? '–' : fmt(v));
    const body = r.map((x) => '<tr><td>' + esc(x.date.slice(5)) + '</td><td>' + n(x.spent) + '</td><td>' + n(x.earned) + '</td><td>' +
      n(x.gap) + '</td><td>' + n(x.other_work) + '</td></tr>').join('');
    const sp = withS.reduce((a, x) => a + x.spent, 0), ea = withS.reduce((a, x) => a + (x.earned || 0), 0);
    return '<table class="spent"><thead><tr><th>Day</th><th title="Load that day, in points">Spent</th>' +
      '<th title="Points in the run log, every queue, plus cards finished by outside reviewers">Earned</th>' +
      '<th title="Spent minus earned: other work, overhead runs and skips">Gap</th>' +
      '<th title="Work not in the run log">Other work</th></tr></thead><tbody>' +
      body + '</tbody></table><p class="notes">Days with readings: spent ' + fmt(Math.round(sp)) + ', earned ' + fmt(Math.round(ea)) +
      ' (' + (sp ? Math.round(100 * ea / sp) : 0) + ' %). The gap is other work and overhead. Work not in the run log, ' +
      'overhead runs and queue skips earn no points by design.</p>';
  }
  function crewNumbers(c) {
    if (!c) return '';
    const tr = c.trophies || {}, TR = [['busiest', 'Busiest (7d points)'], ['most_closed', 'Most cards closed (7d)'],
      ['longest_streak', 'Longest clean streak']];
    const trophies = TR.filter(([k]) => tr[k]).map(([k, l]) => '<div class="trophy"><b>' + esc(tr[k].name) + ' · ' + fmt(tr[k].value) +
      '</b><span>' + l + '</span></div>').join('') + (tr.peak_parallel_queues ? '<div class="trophy"><b>' +
      esc(tr.peak_parallel_queues.value) + '</b><span>Peak build queues at once (7d)</span></div>' : '');
    return '<details class="crewnums"' + (numsOpen ? ' open' : '') + '><summary>Numbers: load, points, trophies</summary>' +
      '<div class="crewcharts"><div class="panel"><h3><span>Last 48 hours</span><small>load</small></h3>' + crewUsage(c.usage_48h || []) +
      '</div><div class="panel"><h3><span>Last 7 days</span><small>points per day</small></h3>' + crewBars(c) + '</div></div>' +
      '<div class="panel spentpanel"><h3><span>Spent vs earned</span><small>points per day, last 7 days</small></h3>' +
      crewSpent(c.spent_vs_earned) + '</div>' +
      (trophies ? '<section class="tier"><h3>Trophies</h3><div class="trophies">' + trophies + '</div></section>' : '') + '</details>';
  }

  /* ---- rows: raw board member + the live model member ---- */
  function members(model) {
    const raw = typeof BOARD !== 'undefined' ? BOARD.raw : null;
    const list = (raw && raw.crew && Array.isArray(raw.crew.members)) ? raw.crew.members : [];
    const live = (model && model.members) || {};
    return list.map((r) => {
      const l = live[r.key];
      if (!l) return Object.assign({}, r);
      return Object.assign({}, r, {
        state: LABEL[l.state] || r.state, task: l.task, card: l.card, since: l.since,
        waiting_on: l.waitingOn, blocked_on: l.blockedOn, runs_today: l.runsToday, streak: r.streak == null ? null : l.streak,
      });
    });
  }

  function counts(ms) {
    const n = (st) => ms.filter((m) => m.state === st).length;
    const att = n('Waiting on you') + n('Blocked'), work = n('Working');
    return { n, att, work, rest: ms.length - att - work };
  }

  /* ---- render ---- */
  function render(model) {
    const raw = typeof BOARD !== 'undefined' ? BOARD.raw : null;
    generated = (raw && raw.generated) || (model && model.generatedText) || '';
    const ms = members(model);
    const sig = JSON.stringify([generated, ms.map((m) => [m.key, m.state, m.task, m.since, m.card, m.waiting_on, m.blocked_on])]);
    if (sig === lastSig) return;
    lastSig = sig;
    if (!ms.length) {
      el.body.innerHTML = '<div class="cp-err">No crew data in the board file' + (raw && raw.crew && raw.crew.error ? ' (' + esc(raw.crew.error) + ')' : '') + '.</div>';
      el.barText.textContent = 'Crew';
      return;
    }
    const c = counts(ms), of = (sts) => ms.filter((m) => sts.includes(m.state)), n = c.n;
    const cnt = [['working', n('Working') + ' working'], ['waiting-on-you', n('Waiting on you') + ' need' + (n('Waiting on you') === 1 ? 's' : '') + ' you'],
      ['blocked', n('Blocked') + ' blocked']];
    const rest = of(['Queued', 'Done today', 'Sleeping']);
    const restSum = CREW_REST.map(([st, w]) => n(st) + ' ' + w).join(' · ');
    el.sub.textContent = ms.length + ' crew · board ' + generated;
    el.counts.innerHTML = cnt.map(([k, t]) => '<span class="st-' + k + '">' + esc(t) + '</span>').join('');
    const scroll = el.panel.scrollTop;
    el.body.innerHTML = CREW_SECS.map(([t, sts]) => crewSection(t, of(sts))).join('') +
      (rest.length ? '<details class="crewrest"' + (restOpen ? ' open' : '') + '><summary><span><b>' + rest.length + ' more crew</b><small>' +
        esc(restSum) + '</small></span></summary>' + CREW_REST.map(([st]) => crewSection(st, of([st]))).join('') + '</details>' : '') +
      crewNumbers(raw && raw.crew);
    el.panel.scrollTop = scroll;
    el.barText.innerHTML = '<span class="st-waiting-on-you">' + c.att + ' need' + (c.att === 1 ? 's' : '') + ' attention</span> · ' +
      '<span class="st-working">' + c.work + ' working</span> · <span class="st-sleeping">' + c.rest + ' more</span>';
  }

  /* ---- find a member on the station ---- */
  function agentFor(key) {
    if (typeof AGENTS === 'undefined') return null;
    if (AGENTS.byKey && AGENTS.byKey[key]) return AGENTS.byKey[key];
    if (key === CONFIG.ROLES.pool) return (AGENTS.list || []).find((a) => a.isDrone) || null;
    return null;
  }
  function locate(key) {
    const a = agentFor(key);
    if (!a || typeof ISO === 'undefined' || typeof CAMERA === 'undefined') return false;
    if (!DESKTOP.matches) setOpen(false);
    const p = ISO.toScreen(a.x, a.y);
    const z = Math.max(CAMERA.state().zoom, 1.6);
    if (CAMERA.glideTo) CAMERA.glideTo(p.sx, p.sy - 36, z, 0.7); else CAMERA.centerOn(p.sx, p.sy - 36, z);
    // the HUD's own highlight for a picked figure is its caption; open it the same way a click on the figure does
    if (typeof HUD !== 'undefined' && HUD.caption && AGENTS.captionFor) HUD.caption(AGENTS.captionFor(a, BOARD.model));
    startRing(a);
    return true;
  }
  /* a thin amber ring under the figure for ~2.4 s (DOM, follows the figure while the camera glides) */
  function startRing(a) {
    ring = { a, t0: performance.now(), dur: 2400 };
    el.ring.hidden = false;
    requestAnimationFrame(stepRing);
  }
  function stepRing(now) {
    if (!ring) return;
    const k = (now - ring.t0) / ring.dur;
    if (k >= 1 || document.hidden) { ring = null; el.ring.hidden = true; return; }
    const p = ISO.toScreen(ring.a.x, ring.a.y), c = CAMERA.toClient(p.sx, p.sy), z = CAMERA.state().zoom;
    const w = 46 * z, h = 23 * z;
    el.ring.style.cssText = 'left:' + (c.x - w / 2).toFixed(1) + 'px;top:' + (c.y - h / 2).toFixed(1) + 'px;width:' + w.toFixed(1) +
      'px;height:' + h.toFixed(1) + 'px;opacity:' + (k < 0.75 ? 1 : (1 - k) / 0.25).toFixed(2);
    requestAnimationFrame(stepRing);
  }

  /* ---- layout: desktop column vs phone bar ---- */
  function setOpen(open) {
    el.root.classList.toggle('open', !!open);
    el.bar.setAttribute('aria-expanded', String(!!open));
    ss.set(KEY_OPEN, open ? '1' : '0');
    if (open) el.close.focus({ preventScroll: true });
  }
  function layout() {
    const desk = DESKTOP.matches;
    el.root.classList.toggle('desk', desk);
    el.root.classList.toggle('phone', !desk);
    if (typeof CAMERA !== 'undefined' && CAMERA.setInsets) {
      if (desk) CAMERA.setInsets(el.panel.getBoundingClientRect().width || 360, 0);
      else CAMERA.setInsets(0, el.bar.getBoundingClientRect().height || 44);
    }
  }

  function init(model) {
    document.body.classList.add('crewpanel-on');
    el.root = document.getElementById('crew-panel');
    if (!el.root) { el.root = document.createElement('aside'); el.root.id = 'crew-panel'; document.body.appendChild(el.root); }
    el.root.setAttribute('aria-label', 'Crew');
    el.root.innerHTML =
      '<button type="button" class="cp-bar" aria-expanded="false" aria-controls="cp-panel"><span class="cp-bar-text">Crew</span><span class="cp-bar-up" aria-hidden="true">&#x2303;</span></button>' +
      '<div class="cp-panel" id="cp-panel"><div class="crewhead"><h2>Crew</h2><button type="button" class="cp-close" aria-label="Close the crew panel">&times;</button>' +
      '<div class="sub"></div><div class="crewcounts"></div></div><div class="crew"></div>' +
      '<p class="cp-foot">read-only view of the board file</p></div>';
    el.bar = el.root.querySelector('.cp-bar'); el.barText = el.root.querySelector('.cp-bar-text');
    el.panel = el.root.querySelector('.cp-panel'); el.close = el.root.querySelector('.cp-close');
    el.sub = el.root.querySelector('.crewhead .sub'); el.counts = el.root.querySelector('.crewcounts'); el.body = el.root.querySelector('.crew');
    el.ring = document.createElement('div'); el.ring.id = 'crew-ring'; el.ring.hidden = true; document.body.appendChild(el.ring);

    el.bar.addEventListener('click', () => setOpen(true));
    el.close.addEventListener('click', () => setOpen(false));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !DESKTOP.matches && el.root.classList.contains('open')) setOpen(false); });
    // remember which rows are open across live re-renders
    el.body.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.classList.contains('crewrest')) restOpen = d.open;
      else if (d.classList.contains('crewnums')) { numsOpen = d.open; ss.set(KEY_NUMS, d.open ? '1' : '0'); }
      else if (d.dataset && d.dataset.key) { if (d.open) openRows.add(d.dataset.key); else openRows.delete(d.dataset.key); }
    }, true);
    el.body.addEventListener('click', (e) => {
      const find = e.target.closest('.cp-find');
      if (find) { e.preventDefault(); locate(find.dataset.key); return; }
      // desktop: a row click also takes the camera there (the row still opens/closes)
      const sum = e.target.closest('.crow > summary');
      if (sum && DESKTOP.matches) locate(sum.parentElement.dataset.key);
    });
    const onMq = () => layout();
    if (DESKTOP.addEventListener) DESKTOP.addEventListener('change', onMq); else if (DESKTOP.addListener) DESKTOP.addListener(onMq);
    addEventListener('resize', layout);

    numsOpen = ss.get(KEY_NUMS) === '1';
    if (ss.get(KEY_OPEN) === '1') setOpen(true);
    render(model);
    layout();
    if (typeof BOARD !== 'undefined' && BOARD.onChange) BOARD.onChange((m) => update(m));   // live: every board refresh (and demo step)
  }

  function update(model) { if (el.body) render(model || (typeof BOARD !== 'undefined' ? BOARD.model : null)); }

  return { init, update, locate };
})();
