/* Crew station: BOARD. Reads the board file (the only input the station has) and derives the StationModel that
   AGENTS, FX and HUD consume. See docs/ARCHITECTURE.md "StationModel". Every window/document use is guarded, so it
   also runs in node with a fetch shim. */
'use strict';

const BOARD = (() => {
  const T = CONFIG.TIMING, ROLES = CONFIG.ROLES, CODES = CONFIG.CODES;
  const QUEUE_TO_MEMBER = { basalt: 'basalt', onyx: 'onyx', topaz: 'topaz', quartz: 'quartz', cobalt: 'cobalt', zircon: 'zircon',
    mica: 'mica', garnet: 'garnet', agate: 'agate', pyrite: 'pyrite', olivine: 'olivine', obsidian: 'obsidian', owner: null };
  const STATE_KEYS = ['working', 'queued', 'waiting-on-you', 'blocked', 'done-today', 'sleeping'];
  const VERDICT_RE = /\b(APPROVED WITH NOTES|APPROVED|REJECTED)\b/;
  const RFR_RE = /^READY FOR REVIEW (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/;
  const MERGED_RE = /\bMERGED\b[^0-9]*(\d{4}-\d{2}-\d{2})?(?: (\d{2}:\d{2}))?/;

  let model = null, raw = null, fetchedAt = 0, fetchedReal = 0, listeners = [], url = null, opts = {};
  let timer = null, demoTimer = null, demoStep = 0;
  const perf = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  /* ---- time: board times are wall-clock times in the board's zone (CONFIG.BOARD_TIME_ZONE, null = the viewer's zone).
     Dates are built as "clock-local" Dates so that getHours() etc. give board numbers whatever the viewer's zone is.
     Only `stale` compares against the real time. ---- */
  function parseClock(s) {   // "2000-01-15 14:25" | "2000-01-15" -> Date (clock-local)
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
  }
  function clockNow() {   // the real time in the board's zone as a clock-local Date
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.BOARD_TIME_ZONE || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
      const g = t => +p.find(x => x.type === t).value;
      return new Date(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    } catch (e) { return new Date(); }
  }
  function now() {
    if (!model) return clockNow();
    return new Date(model.generated.getTime() + (perf() - fetchedAt));
  }
  const minutesBetween = (a, b) => Math.round((a.getTime() - b.getTime()) / 60000);
  const isNightAt = d => { const h = d.getHours(); return T.nightStart > T.nightEnd ? (h >= T.nightStart || h < T.nightEnd) : (h >= T.nightStart && h < T.nightEnd); };
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const fmt = d => d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : null;

  /* ---- derivation ---- */
  let rowQueues = {};   // crew.members[].queue -> member key, from the current board
  function queueMember(queue) { if (Object.prototype.hasOwnProperty.call(rowQueues, queue)) return rowQueues[queue]; return Object.prototype.hasOwnProperty.call(QUEUE_TO_MEMBER, queue) ? QUEUE_TO_MEMBER[queue] : null; }
  function otherBuildQueue(from) { return ROLES.builders.includes(from) ? ROLES.reviewer : ROLES.builders[0]; }
  const cut = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function deriveMembers(b, generated) {
    const out = {};
    for (const m of (b.crew && b.crew.members) || []) {
      const state = STATE_KEYS.includes(m.state_key) ? m.state_key : 'sleeping';
      const last = parseClock(m.last_run);
      const minutesSinceRun = last ? Math.max(0, minutesBetween(generated, last)) : null;
      const p7 = Array.isArray(m.points_7d) && m.points_7d.length ? m.points_7d[m.points_7d.length - 1] : null;
      out[m.key] = {
        key: m.key, name: m.name, role: m.role || '', queue: m.queue || m.key, state,
        activeRecently: state === 'working' || (minutesSinceRun != null && minutesSinceRun <= T.activeMinutes),
        minutesSinceRun, card: m.card || null, task: m.task || null, since: m.since || null,
        waitingOn: Array.isArray(m.waiting_on) ? m.waiting_on.slice() : [],
        blockedOn: Array.isArray(m.blocked_on) ? m.blocked_on.slice() : [],
        helpersRunning: +m.helpers_running || 0, runsToday: +m.runs_today || 0,
        pointsToday: p7 && p7.date === b.today ? +p7.points || 0 : 0, streak: +m.streak || 0, lastRun: m.last_run || null,
      };
    }
    return out;
  }

  function deriveInbox(members) {
    const seen = new Set(), out = [];
    for (const m of Object.values(members)) for (const w of m.waitingOn) {
      if (!w.startsWith(CODES.ask) || seen.has(w)) continue;
      seen.add(w); out.push({ card: w, for: m.key });
    }
    return out;
  }

  function deriveEvents(b, members, generated) {
    const today = b.today || fmt(generated).slice(0, 10);
    const cards = b.cards || [], byCode = new Map();
    for (const c of cards) byCode.set(c.code, c);
    const runsToday = (b.runs || []).filter(r => r.date === today && !r.skipped);
    const ev = [];
    const push = (kind, when, from, to, card, label, verdict, proof) => {
      if (!when) return;
      ev.push({ when, kind, from: from || null, to: to || null, card: card || null, label, verdict: verdict || null,
        proof: cut(proof, 160), ageMinutes: Math.max(0, minutesBetween(generated, when)) });
    };
    const parentOf = code => code.endsWith(CODES.closure) ? code.slice(0, -CODES.closure.length) : code.endsWith(CODES.review) ? code.slice(0, -CODES.review.length) : null;
    const runWhen = r => parseClock(today + ' ' + (r.end || r.start || '00:00'));

    // hand-offs: a card now READY FOR REVIEW with today's date
    for (const c of cards) {
      const m = RFR_RE.exec(c.status || '');
      if (!m || m[1] !== today) continue;
      const from = queueMember(c.queue);
      const review = byCode.get(c.code + CODES.review);
      const to = review ? queueMember(review.queue) : otherBuildQueue(from);
      push('handoff', parseClock(m[1] + ' ' + m[2]), from, to, c.code, c.code + ' to review', null, c.status);
    }
    // verdicts (review rows) and closures (closure rows) from today's runs
    for (const r of runsToday) {
      if (!r.item) continue;
      const parent = parentOf(r.item);
      if (!parent || !byCode.has(parent)) continue;
      const rc = byCode.get(r.item), pcv = byCode.get(parent);
      const vm = rc ? VERDICT_RE.exec(rc.status || '') : null;
      const verdict = vm ? vm[1] : null;
      const from = queueMember(r.queue), to = queueMember(pcv.queue);
      if (r.item.endsWith(CODES.closure)) push('closure', runWhen(r), from, ROLES.merger, parent, parent + ' closed' + (verdict ? ' ' + verdict : ''), verdict, (rc && rc.status) || (r.queue + ' ' + r.item + ' ' + r.start + '-' + r.end));
      else push('verdict', runWhen(r), from, to, parent, r.item + ' ' + (verdict || 'reviewed'), verdict, (rc && rc.status) || (r.queue + ' ' + r.item + ' ' + r.start + '-' + r.end));
    }
    // merges: a merger run today on a card, or a card marked MERGED today
    for (const r of runsToday) {
      if (r.queue !== ROLES.merger || !r.item) continue;
      const c = byCode.get(r.item);
      if (c) { if (/\bmerged?\b/i.test(c.status || '')) push('merge', runWhen(r), ROLES.merger, queueMember(c.queue) || ROLES.merger, c.code, c.code + ' merged', null, ROLES.merger + ' ' + r.start + ' ' + r.item + ': ' + c.status); }
    }
    for (const c of cards) {
      const m = MERGED_RE.exec(c.status || '');
      if (!m) continue;
      const d = m[1] || c.status_date;
      if (d !== today) continue;
      push('merge', parseClock(today + ' ' + (m[2] || '00:00')), ROLES.merger, queueMember(c.queue), c.code, c.code + ' merged', null, c.status);
    }
    // the plan: the planner's newest run today
    const planner = members[ROLES.planner];
    if (planner && planner.lastRun && planner.lastRun.slice(0, 10) === today) push('plan', parseClock(planner.lastRun), ROLES.planner, ROLES.merger, null, 'Plan posted ' + planner.lastRun.slice(11, 16), null, ROLES.planner + ' ' + planner.lastRun + (planner.task ? ' ' + planner.task : ''));
    // helpers running now
    for (const m of Object.values(members)) if (m.helpersRunning > 0) push('helpers', generated, ROLES.pool, m.key, m.card, m.helpersRunning + ' helper' + (m.helpersRunning === 1 ? '' : 's') + ' with ' + m.name, null, m.name + ': helpers running ' + m.helpersRunning + (m.task ? ' - ' + m.task : ''));
    // skipped runs today
    const skips = (b.queue_skips && b.queue_skips[today]) || {};
    for (const queue of Object.keys(skips)) {
      const k = queueMember(queue); const mm = k && members[k];
      push('skip', mm && mm.state === 'sleeping' && mm.since ? parseClock(mm.since) || generated : generated, k, null, null, (mm ? mm.name : queue) + ' skipped ' + skips[queue] + ' run' + (skips[queue] === 1 ? '' : 's'), null, 'queue_skips ' + today + ' ' + queue + ': ' + skips[queue]);
    }
    ev.sort((a, c) => c.when - a.when);
    const seen = new Set();   // one event per kind+card (the cobalt touches a card several times an hour)
    return ev.filter(e => { const k = e.kind + '|' + (e.card || e.from || ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  }

  function deriveEpics(b) {
    const byCode = new Map(); for (const c of b.cards || []) byCode.set(c.code, c);
    return ((b.epics && b.epics.list) || []).map(e => {
      const codes = e.cards || []; let done = 0;
      for (const code of codes) { const c = byCode.get(code); if (c && c.column === 'Done') done++; }
      const st = e.state || {};
      // epic caption: done_when, the card codes and a tally of their board columns
      const columns = {}; for (const code of codes) { const c = byCode.get(code); const col = (c && c.column) || 'Missing'; columns[col] = (columns[col] || 0) + 1; }
      return { code: e.code, name: e.name, goal: e.goal || '', target: e.target || null, targetText: e.target_text || e.target || null, owner: e.owner || null,
        doneWhen: e.done_when || '', cards: codes.slice(), columns,
        done, total: codes.length, pct: codes.length ? done / codes.length : 0, note: st.note || st.value || '', state: st.value || '' };
    });
  }

  /* Drops rows the derivations cannot use; the board's other fields stay as they are. */
  function sanitize(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('the board file is not an object');
    const rows = (list, ok) => (Array.isArray(list) ? list.filter(r => r && typeof r === 'object' && ok(r)) : []);
    const out = Object.assign({}, b);
    if (b.crew && typeof b.crew === 'object') {
      const members = rows(b.crew.members, r => typeof r.key === 'string' && r.key).map(m => Object.assign({}, m, {
        last_run: typeof m.last_run === 'string' ? m.last_run : null,
        points_7d: rows(m.points_7d, () => true),
      }));
      out.crew = Object.assign({}, b.crew, { members,
        days: Array.isArray(b.crew.days) ? b.crew.days.filter(d => typeof d === 'string') : [],
        usage_48h: rows(b.crew.usage_48h, r => typeof r.t === 'string' && !isNaN(Date.parse(r.t.replace(' ', 'T'))) && isFinite(parseFloat(r.used_pct))),
        spent_vs_earned: rows(b.crew.spent_vs_earned, r => typeof r.date === 'string'),
      });
    }
    out.cards = rows(b.cards, r => typeof r.code === 'string' && r.code);
    out.runs = rows(b.runs, r => typeof r.queue === 'string' && (r.item == null || typeof r.item === 'string'));
    if (b.epics && typeof b.epics === 'object') out.epics = Object.assign({}, b.epics, { list: rows(b.epics.list, r => typeof r.code === 'string' && r.code).map(e => Object.assign({}, e, { cards: Array.isArray(e.cards) ? e.cards.filter(c => typeof c === 'string') : [] })) });
    if (b.cycle && !Array.isArray(b.cycle.cycles)) out.cycle = Object.assign({}, b.cycle, { cycles: [] });
    return out;
  }

  function build(b, forceNight) {
    rowQueues = {};
    for (const m of (b.crew && b.crew.members) || []) if (typeof m.queue === 'string' && m.queue && CONFIG.MEMBERS[m.key]) rowQueues[m.queue] = m.key;
    const generated = parseClock(b.generated) || clockNow();
    const real = clockNow();
    // a sample board ("sample": true) is a frozen snapshot: never stale, so the crew keeps acting it out
    const ageMinutes = b.sample ? 0 : Math.max(0, minutesBetween(real, generated));
    const members = deriveMembers(b, generated);
    const m = {
      generated, generatedText: b.generated || fmt(generated), today: b.today || fmt(generated).slice(0, 10),
      ageMinutes, stale: ageMinutes > T.staleMinutes, isNight: forceNight ? true : isNightAt(generated),
      members, inbox: deriveInbox(members), events: deriveEvents(b, members, generated), epics: deriveEpics(b),
      load: b.load && isFinite(parseFloat(b.load.used_pct)) ? { usedPct: parseFloat(b.load.used_pct) } : null,
      cycle: (() => { const s = b.cycle || {}; const cur = (s.cycles || []).find(x => x.n === s.current); return { n: s.current || null, name: cur ? cur.name : '' }; })(),
      demo: false, sample: !!b.sample,
    };
    return m;
  }

  function refreshNight() {   // isNight follows the advancing clock between fetches (unless forced)
    if (model && !opts.night && !model.demo) model.isNight = isNightAt(now());
  }

  // through LOADQ (js/loadq.js): timed out and retried once; a miss rejects "Could not load board.json. Reload to try again."
  function fetchJson(u) {
    return LOADQ.json(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { fetch: { cache: 'no-store' }, essential: true });
  }

  function emit(prev) { for (const fn of listeners) { try { fn(model, prev); } catch (e) { console.error('BOARD listener', e); } } }

  async function load(u, o) {
    url = u || url; opts = o || opts || {};
    const next = sanitize(await fetchJson(url));
    const built = build(next, !!opts.night);   // throws before anything changes
    raw = next;
    fetchedAt = perf(); fetchedReal = Date.now();
    const prev = model;
    model = built;
    if (opts.demo) { model.demo = true; startDemo(); }
    if (prev) emit(prev);
    if (!timer && typeof setInterval === 'function') {
      timer = setInterval(() => reload(), T.refreshMs);
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - fetchedReal > 60000) reload(); });
      }
      setInterval(refreshNight, 30000);
    }
    return model;
  }
  async function reload() {
    try { await load(url, opts); } catch (e) { console.warn('board refresh failed', e); if (model && !(raw && raw.sample)) { model.ageMinutes = Math.max(0, minutesBetween(clockNow(), model.generated)); model.stale = model.ageMinutes > T.staleMinutes; } }
  }

  /* ---- demo: rotate states so every behavior shows ---- */
  function startDemo() {
    if (demoTimer || typeof setInterval !== 'function') return;
    model.demo = true;
    const step = () => {
      if (!model) return;
      const prev = model; demoStep++;
      const keys = Object.keys(model.members);
      keys.forEach((k, i) => {
        const mm = model.members[k];
        mm.state = STATE_KEYS[(i + demoStep) % STATE_KEYS.length];
        mm.activeRecently = mm.state === 'working' || ((i + demoStep) % 3 === 0);
        mm.helpersRunning = mm.state === 'working' && (i + demoStep) % 2 === 0 ? 2 : 0;
        if (mm.state === 'blocked' && !mm.blockedOn.length) mm.blockedOn = [CODES.ask + 'DEMO'];
        if (mm.state === 'waiting-on-you' && !mm.waitingOn.length) mm.waitingOn = [CODES.ask + 'DEMO'];
      });
      const g = model.generated, mk = (kind, from, to, card, label, verdict) => ({ when: new Date(g.getTime() - 2 * 60000), kind, from, to, card, label, verdict, proof: 'demo: invented event', ageMinutes: 2 });
      const pick = n => keys[(demoStep + n) % keys.length];
      model.events = [mk('handoff', ROLES.builders[0], ROLES.reviewer, 'DEMO-1', 'DEMO-1 to review', null), mk('verdict', ROLES.reviewer, pick(1), 'DEMO-2', 'DEMO-2r APPROVED', 'APPROVED'),
        mk('closure', ROLES.reviewer, ROLES.merger, 'DEMO-3', 'DEMO-3 closed', 'APPROVED'), mk('merge', ROLES.merger, pick(2), 'DEMO-4', 'DEMO-4 merged', null), mk('plan', ROLES.planner, ROLES.merger, null, 'Plan posted', null)].concat(model.events.slice(0, 10));
      model.inbox = model.inbox.length ? model.inbox : [{ card: CODES.ask + 'DEMO', for: ROLES.merger }];
      if (demoStep % 3 === 0 && !opts.night) model.isNight = !model.isNight;
      model.demo = true;
      emit(prev);
    };
    demoTimer = setInterval(step, 20000);
  }

  return {
    load, reload, now, clockNow, parseClock, fmt, build,
    get model() { return model; }, get raw() { return raw; },
    onChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; },
  };
})();
