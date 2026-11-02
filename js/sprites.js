/* Crew station: sprite sheets. Contract: docs/ARCHITECTURE.md.
   assets/sprites/atlas.json + one PNG per skin (assets/sprites/<skin>.png, 92x92 cells in a grid).
   A frame is a key "track#i" with a cell {x,y} in the skin's atlas. */
'use strict';

const SPRITES = (() => {
  const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const CARDINALS = ['north', 'east', 'south', 'west'];
  const FRAME = 92;
  let manifest = null;               // skin -> track -> [frame key], filled per loaded skin
  let atlas = null; // atlas.json skins
  const images = {};                 // images[skin][key] = HTMLImageElement (per-frame: one each; atlas: the skin's sheet)
  const cells = {};                  // cells[skin][key] = {x,y} for an atlas skin
  let frameSize = FRAME, sourceKind = null;

  // loads go through LOADQ (js/loadq.js): capped, timed out, retried once; essential ones reject with a readable error
  function getJson(name, essential) { return LOADQ.json(CONFIG.SPRITE_URL + name, { fetch: { cache: 'no-store' }, essential }); }

  async function index() {
    const a = await getJson('atlas.json', true);
    if (!a || !a.skins) throw LOADQ.loadError(CONFIG.SPRITE_URL + 'atlas.json');
    atlas = a.skins; frameSize = a.frame || FRAME; sourceKind = 'atlas';
    manifest = {};
  }

  /* Resolves once every skin has its atlas sheet. */
  async function load(skins) {
    if (!manifest) await index();
    const jobs = [];
    for (const skin of skins) {
      if (manifest[skin]) continue;
      const at = atlas && atlas[skin];
      if (!at) { console.warn('sprites: unknown skin ' + skin); continue; }
      const tracks = {}, cs = {};
      for (const [k, list] of Object.entries(at.tracks)) tracks[k] = list.map((c, i) => { const key = k + '#' + i; cs[key] = c; return key; });
      jobs.push(LOADQ.image(CONFIG.SPRITE_URL + at.image, { essential: true }).then(im => {
        const set = images[skin] = {}; for (const key of Object.keys(cs)) set[key] = im;
        cells[skin] = cs; manifest[skin] = tracks;
      }));
    }
    await Promise.all(jobs);
  }

  /* ---- track / dir resolution ---- */
  function nearestCardinal(dir) {
    if (CARDINALS.includes(dir)) return dir;
    // diagonals: pick the vertical-ish cardinal first (north/south read better when seated/typing), else the horizontal
    const [a, b] = dir.split('-');
    return a || 'south';
  }
  function resolve(skin, track, dir) {
    const tracks = manifest && manifest[skin];
    if (!tracks) return null;
    const tryKeys = [];
    tryKeys.push(track + '_' + dir);
    if (track === 'type') tryKeys.push('sit_' + dir);          // a skin without this type track: the seated pose that way
    const card = nearestCardinal(dir), alt = dir.includes('-') ? dir.split('-')[1] : null;
    tryKeys.push(track + '_' + card);
    if (alt) tryKeys.push(track + '_' + alt);
    if (track === 'type') tryKeys.push('type_north');
    if (track === 'talk') tryKeys.push('talk_south', 'gesture_' + card);
    if (track === 'type') tryKeys.push('gesture_north', 'sit_north');
    // single-frame state poses (cobalt/onyx sheets); skins without them fall back to the nearest classic pose
    if (track === 'charging') tryKeys.push('charging_north', 'sit_north');
    if (track === 'waiting') tryKeys.push('waiting_south', 'rot_south');
    if (track === 'blocked') tryKeys.push('blocked_south', 'gesture_south');
    tryKeys.push('rot_' + dir, 'rot_' + card, 'rot_south');
    for (const k of tryKeys) if (tracks[k] && tracks[k].length) return tracks[k];
    return null;
  }
  function frames(skin, track, dir) { const t = resolve(skin, track, dir); return t ? t.length : 0; }
  function frame(skin, track, dir, i) {
    const t = resolve(skin, track, dir);
    if (!t) return null;
    const n = t.length, idx = ((Math.floor(i || 0) % n) + n) % n;
    return t[idx];
  }

  const FEET_ROW = 68;   // every sheet puts the feet at y=68 of the 92 px cell
  function draw(ctx, skin, track, dir, frameIndex, sx, sy, scale) {
    const f = frame(skin, track, dir, frameIndex);
    const im = f && images[skin] && images[skin][f];
    if (!im) return;
    const s = scale == null ? 1 : scale;
    const w = frameSize * s, h = frameSize * s;
    const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    const c = cells[skin][f], dx = Math.round(sx - w / 2), dy = Math.round(sy - FEET_ROW * s);   // feet at row 68 of 92 sit on the floor point
    ctx.drawImage(im, c.x, c.y, frameSize, frameSize, dx, dy, w, h);
    ctx.imageSmoothingEnabled = prev;
  }

  /* ---- grid heading -> sprite dir (screen terms). Grid north (0,-1) = screen up-right = 'north-east'. ---- */
  /* With a skin: a screen-diagonal dir is returned only when that skin has the walk track for it (walk_north-east/north-west/
     south-east/south-west); otherwise the nearest cardinal. */
  function hasTrack(skin, key) { const t = manifest && manifest[skin]; return !!(t && t[key] && t[key].length); }
  function headingToDir(dx, dy, skin) {
    const d = headingToDir8(dx, dy);
    if (skin && d.includes('-') && !hasTrack(skin, 'walk_' + d)) return nearestCardinal(d);
    return d;
  }
  function headingToDir8(dx, dy) {
    if (!dx && !dy) return 'south';
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    // use dominant axis when far from diagonal
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let gx = sx, gy = sy;
    if (ax > ay * 2.4) gy = 0; else if (ay > ax * 2.4) gx = 0;
    const map = {
      '1,0': 'south-east', '-1,0': 'north-west', '0,-1': 'north-east', '0,1': 'south-west',
      '1,-1': 'east', '-1,1': 'west', '1,1': 'south', '-1,-1': 'north',
    };
    return map[gx + ',' + gy] || 'south';
  }
  const FACE = { north: 'north-east', south: 'south-west', east: 'south-east', west: 'north-west' };
  function faceDir(face) { return FACE[face] || face || 'south'; }

  function tracksOf(skin) { return manifest && manifest[skin] ? Object.keys(manifest[skin]) : []; }

  return { load, frame, frames, draw, headingToDir, faceDir, tracksOf, hasTrack, DIRS, CARDINALS, get frameSize() { return frameSize; }, get source() { return sourceKind; } };
})();
