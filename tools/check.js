#!/usr/bin/env node
/* Tree check, no dependencies.
     node tools/check.js                  checks the tree and the default board
     node tools/check.js --board FILE     also validates FILE as the board, instead of the default
   JSON parses; files are not empty; everything index.html, the JS and the JSON refer to exists; atlas skins and tracks
   match CONFIG; the crew has portraits, seats and queue map entries; rooms have their art; data keys agree with CONFIG;
   nothing under assets/ is left unreferenced. art-kit/ is not checked. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const errors = [], notes = [], refs = new Set();
const err = (m) => errors.push(m);
const abs = (p) => path.join(ROOT, p);
const has = (p) => fs.existsSync(abs(p));
const ref = (p, why) => { p = path.normalize(p); refs.add(p); if (!has(p)) err('missing ' + p + ' (' + why + ')'); };
function walk(d, out = []) { for (const e of fs.readdirSync(abs(d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['.git', 'node_modules', 'art-kit'].includes(e.name)) walk(p, out); } else out.push(p); } return out; }
const all = walk('.');
const boardArg = (() => { const i = process.argv.indexOf('--board'); if (i < 0) return null; const f = process.argv[i + 1]; if (!f) { console.error('--board needs a file'); process.exit(2); } return f; })();

for (const f of all) if (fs.statSync(abs(f)).size === 0) err('empty file ' + f);

// JSON parses
const json = {};
for (const f of all.filter((f) => f.endsWith('.json'))) { try { json[f] = JSON.parse(fs.readFileSync(abs(f), 'utf8')); } catch (e) { err('bad JSON ' + f + ': ' + e.message); } }
const J = (f) => { const x = json[path.normalize(f)]; if (x === undefined) err('missing or bad ' + f); return x; };

// index.html
const html = fs.readFileSync(abs('index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const BOARD_LINK = /^data\//;   // the header link: any board file, checked below
for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!BOARD_LINK.test(m[1])) ref(m[1], 'index.html');
for (const f of all.filter((f) => f.startsWith('js' + path.sep) && f.endsWith('.js'))) if (!scripts.includes(f.split(path.sep).join('/'))) err('script not loaded by index.html: ' + f);

// CONFIG
const sb = { document: undefined, location: undefined };
vm.createContext(sb);
const CONFIG = vm.runInContext(fs.readFileSync(abs('js/config.js'), 'utf8') + '\nCONFIG', sb);
const memberKeys = Object.keys(CONFIG.MEMBERS);
const roles = CONFIG.ROLES || {};
for (const [role, v] of Object.entries(roles)) for (const k of [].concat(v)) if (!memberKeys.includes(k)) err('role ' + role + ': unknown member ' + k);
const poolKeys = memberKeys.filter((k) => CONFIG.MEMBERS[k].pool);

// queue map
const boardJs = fs.readFileSync(abs('js/board.js'), 'utf8');
const qm = /QUEUE_TO_MEMBER = \{([\s\S]*?)\}/.exec(boardJs);
const queueKeys = qm ? [...qm[1].matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]) : [];
for (const k of memberKeys) if (!poolKeys.includes(k) && !queueKeys.includes(k)) err('no QUEUE_TO_MEMBER entry for ' + k);

// sprites
const NEEDED = ['rot_south', 'rot_north', 'rot_east', 'rot_west', 'walk_north', 'walk_south', 'walk_east', 'walk_west', 'sit_south', 'sit_north', 'sit_east', 'sit_west', 'type_north'];
const atlas = J('assets/sprites/atlas.json');
if (atlas) {
  const skins = Object.keys(atlas.skins), want = CONFIG.SKINS;
  for (const s of want) if (!skins.includes(s)) err('atlas has no skin ' + s);
  for (const s of skins) if (!want.includes(s)) err('atlas skin not in CONFIG: ' + s);
  for (const s of skins) {
    const a = atlas.skins[s], p = CONFIG.SPRITE_URL + a.image; ref(p, 'atlas.json');
    for (const t of NEEDED) if (!a.tracks[t] || !a.tracks[t].length) err('atlas ' + s + ' lacks track ' + t);
    if (!has(p)) continue;
    const b = fs.readFileSync(abs(p));
    if (b.length < 24) continue;
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    for (const [t, cells] of Object.entries(a.tracks)) for (const c of cells) if (c.x + atlas.frame > w || c.y + atlas.frame > h) err('atlas ' + s + ' ' + t + ' cell outside the image');
  }
}
// portraits
const STATES = ['working', 'queued', 'waiting-on-you', 'blocked', 'done-today', 'sleeping'];
for (const m of Object.values(CONFIG.MEMBERS)) for (const st of STATES) for (const n of [1, 2]) ref(CONFIG.ART_URL + m.art + '-' + st + '-' + n + 'x.webp', 'member ' + m.key);

// rooms
const objectsJs = fs.readFileSync(abs('js/objects.js'), 'utf8');
const roomKeys = JSON.parse((/ROOM_KEYS = (\[[^\]]*\])/.exec(objectsJs)[1]).replace(/'/g, '"'));
const rooms = CONFIG.ROOMS.filter((r) => r.kind !== 'corridor').map((r) => r.key);
for (const k of rooms) if (!roomKeys.includes(k)) err('room not in ROOM_KEYS: ' + k);
for (const k of roomKeys) {
  if (!rooms.includes(k)) err('ROOM_KEYS entry not in CONFIG: ' + k);
  ref('assets/rooms/' + k + '.png', 'room'); ref('assets/objects/' + k + '.png', 'room'); ref('assets/objects/' + k + '.json', 'room');
  const o = json[path.normalize('assets/objects/' + k + '.json')];
  if (o) {
    for (const field of ['shell', 'sheet']) { if (typeof o[field] === 'string' && o[field]) ref(path.join('assets/objects', o[field]), k + ' ' + field); else err('assets/objects/' + k + '.json has no ' + field); }
    if (!Array.isArray(o.objects)) err('assets/objects/' + k + '.json has no objects list');
  }
}
for (const d of CONFIG.DOORS) if (!rooms.includes(d.room)) err('door on unknown room ' + d.room);
const configSeats = {};
for (const r of CONFIG.ROOMS) for (const [s, seat] of Object.entries(r.seats || {})) {
  configSeats[s] = r.key;
  if (!memberKeys.includes(s)) { err('seat for unknown member ' + s + ' in ' + r.key); continue; }
  if (CONFIG.MEMBERS[s].room !== r.key) err('seat for ' + s + ' is in ' + r.key + ', its room is ' + CONFIG.MEMBERS[s].room);
  if (seat.x < r.x || seat.x >= r.x + r.w || seat.y < r.y || seat.y >= r.y + r.h) err('seat for ' + s + ' is outside ' + r.key);
  if (seat.x < 0 || seat.y < 0 || seat.x >= CONFIG.GRID.w || seat.y >= CONFIG.GRID.h) err('seat for ' + s + ' is off the grid');
}
for (const k of memberKeys) if (!poolKeys.includes(k) && !configSeats[k] && CONFIG.MEMBERS[k].room) err('member ' + k + ' has no seat');
for (const m of Object.values(CONFIG.MEMBERS)) { if (!rooms.includes(m.room)) err('member ' + m.key + ' in unknown room'); for (const l of m.leisure || []) if (!rooms.includes(l)) err('member ' + m.key + ' leisure room unknown: ' + l); }

// floors, placements
const floors = J('assets/floors.json'); ref('assets/floors.json', 'js/floors.js');
if (floors) for (const k of Object.keys(floors)) if (!rooms.includes(k)) err('floors.json: unknown room ' + k);
const pl = J('assets/placements.json'); ref('assets/placements.json', 'js/floors.js');
if (pl) for (const [k, v] of Object.entries(pl)) { if (!rooms.includes(k)) err('placements.json: unknown room ' + k); for (const s of Object.keys(v.seats || {})) { if (!memberKeys.includes(s)) err('placements.json: unknown member ' + s); else if (configSeats[s] !== k) err('placements.json: seat for ' + s + ' in ' + k + ' has no config seat there'); } }

// heroes, atlases with an image field
for (const n of (/const HEROES = \{/.test(objectsJs) ? ['reactor', 'globe', 'telescope'] : [])) { ref('assets/heroes/' + n + '.json', 'HEROES'); const j = json[path.normalize('assets/heroes/' + n + '.json')]; if (j) ref('assets/heroes/' + j.image, n); }
for (const n of ['items', 'shuttle']) { ref('assets/props/' + n + '.json', 'js/interactions.js'); const j = json[path.normalize('assets/props/' + n + '.json')]; if (j) ref('assets/props/' + j.image, n); }

// file names quoted in the JS
const byBase = {}; for (const f of all) (byBase[path.basename(f)] = byBase[path.basename(f)] || []).push(f);
const PIECE = new Set(['x.webp']);   // js/crewpanel.js: the tail of a portrait name, checked above
for (const f of scripts) {
  const src = fs.readFileSync(abs(f), 'utf8');
  for (const m of src.matchAll(/['"`]([\w./-]+\.(?:png|webp|json|woff2))['"`]/g)) {
    const base = path.basename(m[1]);
    if (PIECE.has(base) || m[1].startsWith('data/')) continue;
    if (byBase[base]) { for (const p of byBase[base]) if (p.startsWith('assets') || p.startsWith('data')) refs.add(p); }
    else err('missing ' + m[1] + ' (' + f + ')');
  }
  for (const m of src.matchAll(/['"`](assets\/[\w./-]*\/)['"`]/g)) if (!has(m[1])) err('missing folder ' + m[1] + ' (' + f + ')');
}
const css = fs.readFileSync(abs('css/station.css'), 'utf8');
for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) ref(path.join('css', m[1]), 'station.css');
for (const k of memberKeys) if (!css.includes('--m-' + k + ':')) err('no --m-' + k + ' in station.css');

// the board
const COLUMNS = ['Done', 'In review', 'Next 24h', 'Blocked/Waiting', 'Backlog'];
function checkBoard(file, board, strict) {
  const e = (m) => err(file + ': ' + m);
  if (!board || typeof board !== 'object' || Array.isArray(board)) return e('not an object');
  const ms = (board.crew && board.crew.members) || [];
  if (!Array.isArray(ms) || !ms.length) e('no crew.members');
  (Array.isArray(ms) ? ms : []).forEach((m, i) => {
    if (!m || !m.key) return e('crew.members[' + i + '] has no key');
    if (!memberKeys.includes(m.key)) notes.push(file + ': member ' + m.key + ' has no figure (not in CONFIG.MEMBERS)');
    if (m.state_key !== undefined && !STATES.includes(m.state_key)) e('bad state_key on ' + m.key);
    if (m.last_run != null && typeof m.last_run !== 'string') e('last_run on ' + m.key + ' is not a string');
    if (m.points_7d !== undefined && !Array.isArray(m.points_7d)) e('points_7d on ' + m.key + ' is not an array');
    if (m.art && !has(CONFIG.ART_URL + m.art + '-sleeping-1x.webp')) e('no portrait for art ' + m.art);
  });
  if (strict) for (const k of memberKeys) if (!ms.some((m) => m && m.key === k)) e('no entry for ' + k);
  const cards = Array.isArray(board.cards) ? board.cards : [], codes = new Set();
  cards.forEach((c, i) => { if (!c || !c.code) return e('cards[' + i + '] has no code'); codes.add(c.code); if (c.column !== undefined && !COLUMNS.includes(c.column)) e('card ' + c.code + ': unknown column ' + c.column); });
  (Array.isArray(board.runs) ? board.runs : []).forEach((r, i) => { if (!r || typeof r.queue !== 'string') e('runs[' + i + '] has no queue'); else if (r.item != null && typeof r.item !== 'string') e('runs[' + i + '].item is not a string'); else if (r.item && !codes.has(r.item)) notes.push(file + ': run names unknown card ' + r.item); });
  for (const x of (board.epics && board.epics.list) || []) { if (!x || !x.code) { e('an epic has no code'); continue; } for (const c of x.cards || []) if (!codes.has(c)) e(x.code + ' names unknown card ' + c); }
  const gen = String(board.generated || '').slice(0, 16);
  for (const u of (board.crew && board.crew.usage_48h) || []) if (!u || typeof u.t !== 'string') e('a usage_48h row has no t');
  for (const r of (board.crew && board.crew.spent_vs_earned) || []) if (!r || typeof r.date !== 'string') e('a spent_vs_earned row has no date');
  for (const u of (board.crew && board.crew.usage_48h) || []) if (u && gen && String(u.t) > gen) e('usage_48h entry ' + u.t + ' is after generated');
}
if (boardArg) {
  let b = null; try { b = JSON.parse(fs.readFileSync(path.resolve(boardArg), 'utf8')); } catch (e) { err('board ' + boardArg + ': ' + e.message); }
  if (b) checkBoard(boardArg, b, false);
} else if (/^[a-z]+:|^\//i.test(CONFIG.BOARD_URL) || !has(CONFIG.BOARD_URL)) {
  notes.push('default board ' + CONFIG.BOARD_URL + ' is not a file in this tree; not validated (use --board)');
} else checkBoard(CONFIG.BOARD_URL, JSON.parse(fs.readFileSync(abs(CONFIG.BOARD_URL), 'utf8')), true);

// nothing unreferenced under assets/; data/ holds board files, whatever their names
refs.add(path.normalize('assets/fonts/OFL.txt'));
for (const f of all) if (f.startsWith('assets' + path.sep) && !refs.has(f)) err('unreferenced file ' + f);

for (const n of [...new Set(notes)]) console.log('note: ' + n);
if (errors.length) { for (const e of errors) console.error('FAIL ' + e); console.error(errors.length + ' problem(s).'); process.exit(1); }
console.log('OK: ' + all.length + ' files, ' + scripts.length + ' scripts, ' + memberKeys.length + ' crew, ' + roomKeys.length + ' rooms.');
