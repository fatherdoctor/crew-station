/* Crew station: the shared loader. Loaded first. Every boot-time image / JSON goes through one capped queue so a slow
   remote link (a phone over a tunnel) sees at most MAX requests in flight, each with a timeout and one retry.
   LOADQ.image(src, opts) -> Promise<Image|null>     LOADQ.json(src, opts) -> Promise<object|null>
   opts.essential: a failure (after the retry) rejects with "Could not load <file>. Reload to try again." instead of
     resolving null; main.js shows that in the HUD loading text. Non-essential failures resolve null and are logged.
   opts.fetch: fetch init for json (e.g. { cache: 'no-store' }).
   The timeout is a stall timeout (no response / no bytes for 20 s), so big files on a slow link still arrive.
   Retry: a timeout or network error is retried once; an HTTP 4xx is final; a non-essential image error (no way to
   tell a 404 from a dropped link) is final, an essential one is retried.
   ?loadtimeout=<ms> overrides the 20 s timeout, ?loadmax=<n> the 8-at-a-time cap. */
'use strict';

const LOADQ = (() => {
  const qp = (k) => { try { return new URLSearchParams(location.search).get(k); } catch (_) { return null; } };
  const cfg = { max: +qp('loadmax') || 8, timeoutMs: +qp('loadtimeout') || 20000, retries: 1 };
  const fg = [];
  let active = 0, total = 0, done = 0;
  const failed = [], progressFns = [];

  function short(src) { return String(src).split('?')[0].replace(/^.*?\/(?=assets\/|data\/|board\.json)/, '').replace(/^\.?\//, ''); }
  function loadError(src) { const e = new Error('Could not load ' + short(src) + '. Reload to try again.'); e.loadq = true; e.src = src; return e; }
  function emit() { for (const fn of progressFns) { try { fn(done, total); } catch (_) {} } }

  function pump() {
    while (fg.length && active < cfg.max) start(fg.shift());
  }
  function start(job) {
    active++;
    job.run().then(job.resolve, job.reject).finally(() => { active--; pump(); });
  }
  function enqueue(run) {
    return new Promise((resolve, reject) => { fg.push({ run, resolve, reject }); pump(); });
  }

  /* One attempt: resolves the value, rejects { kind: 'timeout' | 'error' | 'http', status }. The timeout is a STALL
     timeout: no response, or no bytes for timeoutMs, aborts. A big file trickling in over a slow link is not cut off
     (8 files share the link, so a 600 KB texture can take a minute and still be fine). */
  async function fetchBody(src, init) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let t = 0;
    const arm = () => { clearTimeout(t); t = setTimeout(() => { if (ac) ac.abort(); }, cfg.timeoutMs); };
    arm();
    try {
      const r = await fetch(src, Object.assign({}, init || {}, ac ? { signal: ac.signal } : {}));
      if (!r.ok) throw { kind: 'http', status: r.status };
      if (!r.body || !r.body.getReader) { const b = await r.blob(); return { blob: b, type: r.headers.get('content-type') }; }
      const reader = r.body.getReader(), parts = [];
      for (;;) { arm(); const { done: end, value } = await reader.read(); if (end) break; parts.push(value); }
      return { blob: new Blob(parts, { type: r.headers.get('content-type') || '' }) };
    } catch (e) {
      if (e && e.kind) throw e;
      throw { kind: (e && e.name === 'AbortError') ? 'timeout' : 'error', message: e && e.message };
    } finally { clearTimeout(t); }
  }
  const fileProto = typeof location !== 'undefined' && location.protocol === 'file:';   // file:// has no fetch: plain Image
  function imageOnce(src) {
    if (fileProto || typeof fetch === 'undefined') return new Promise((res, rej) => {
      const im = new Image();
      const t = setTimeout(() => { im.onload = im.onerror = null; im.src = ''; rej({ kind: 'timeout' }); }, cfg.timeoutMs * 3);
      im.onload = () => { clearTimeout(t); res(im); };
      im.onerror = () => { clearTimeout(t); rej({ kind: 'error' }); };
      im.src = src;
    });
    return fetchBody(src).then(({ blob }) => new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej({ kind: 'error', message: 'not an image' }); };
      im.src = url;
    }));
  }
  function jsonOnce(src, init) {
    return fetchBody(src, init).then(({ blob }) => blob.text()).then(txt => JSON.parse(txt))
      .catch(e => { if (e && e.kind) throw e; throw { kind: 'http', status: 422, message: 'bad JSON' }; });   // a bad body is final
  }

  function load(kind, src, opts) {
    opts = opts || {};
    const essential = !!opts.essential;
    total++; emit();
    const once = kind === 'image' ? () => imageOnce(src) : () => jsonOnce(src, opts.fetch);
    const retryable = (e) => e.kind === 'timeout' || (e.kind === 'error' && (kind === 'json' || essential)) || (e.kind === 'http' && e.status >= 500);
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await once(); }
        catch (e) {
          const why = e.kind === 'http' ? 'HTTP ' + e.status : e.kind;
          if (attempt < cfg.retries && retryable(e)) { console.warn('loader: ' + short(src) + ' ' + why + ', retrying'); continue; }
          throw Object.assign(new Error(why), { why });
        }
      }
    };
    return enqueue(run).then(v => { done++; emit(); return v; }, e => {
      done++; emit();
      failed.push({ src: short(src), why: e.why, essential });
      if (essential) { console.error('loader: essential ' + short(src) + ' failed (' + e.why + ')'); throw loadError(src); }
      if (!opts.quiet) console.warn('loader: ' + short(src) + ' not loaded (' + e.why + ')');
      return null;
    });
  }

  /* The HUD loading line: progress while booting, the error if the boot fails. */
  let failedBoot = false;
  function el() { return typeof document !== 'undefined' ? document.getElementById('hud-loading') : null; }
  function showProgress(d, t) { const n = el(); if (n && !failedBoot) n.textContent = 'loading the station… ' + d + '/' + t; }
  function showError(err) {
    if (failedBoot) return; failedBoot = true;
    const msg = (err && err.loadq) ? err.message : 'Could not start the station: ' + ((err && err.message) || String(err)) + '. Reload to try again.';
    console.error('station: boot failed', err && err.stack ? err.stack : err);
    const n = el(); if (n) { n.textContent = msg; n.classList.add('error'); n.hidden = false; }
  }

  return {
    image: (src, opts) => load('image', src, opts),
    json: (src, opts) => load('json', src, opts),
    onProgress(fn) { progressFns.push(fn); return () => { const i = progressFns.indexOf(fn); if (i >= 0) progressFns.splice(i, 1); }; },
    showProgress, showError, loadError, config: cfg,
    get failedBoot() { return failedBoot; },
    get stats() { return { total, done, active, queued: fg.length, failed: failed.slice() }; },
  };
})();
