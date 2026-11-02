/* Crew station: isometric projection math. See docs/ARCHITECTURE.md. */
'use strict';

const ISO = (() => {
  const HW = CONFIG.TILE_W / 2, HH = CONFIG.TILE_H / 2;   // 32, 16

  /* Grid (x east, y south) -> world px. Integer (x, y) is the tile's NORTH corner (top of the diamond). */
  function toScreen(x, y, z) {
    return { sx: (x - y) * HW, sy: (x + y) * HH - (z || 0) };
  }
  /* World px -> grid floats at z = 0. */
  function fromScreen(sx, sy) {
    return { x: (sx / HW + sy / HH) / 2, y: (sy / HH - sx / HW) / 2 };
  }
  /* Painter's key: larger draws later (closer to the viewer). */
  function depth(x, y, z) {
    return x + y + (z || 0) * 0.001;
  }
  /* The centre of tile (x, y) in world px. */
  function tileCenter(x, y) {
    return toScreen(x + 0.5, y + 0.5, 0);
  }
  /* Traces the diamond of tile (x, y) (floats allowed) as the current path. */
  function tilePath(ctx, x, y, w, h) {
    w = w || 1; h = h || 1;
    const a = toScreen(x, y), b = toScreen(x + w, y), c = toScreen(x + w, y + h), d = toScreen(x, y + h);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy);
    ctx.closePath();
  }
  /* Nearest of the 8 sprite directions for a grid heading (dx, dy), in SCREEN terms:
     grid north (-y) is screen up-right, grid east (+x) is screen down-right. */
  const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  function headingDir(dx, dy) {
    if (!dx && !dy) return 'south';
    const s = toScreen(dx, dy, 0);                       // screen vector
    const ang = Math.atan2(s.sy, s.sx);                  // 0 = screen right, +ve = screen down
    const i = Math.round(ang / (Math.PI / 4));
    return DIRS[((i % 8) + 8) % 8];
  }

  return { HW, HH, toScreen, fromScreen, depth, tileCenter, tilePath, headingDir, DIRS };
})();
