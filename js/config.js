/* Crew station: shared configuration. Other modules read, never write. */
'use strict';

const CONFIG = (() => {
  const TILE_W = 64, TILE_H = 32;
  const GRID = { w: 50, h: 42 };

  // Room floor rects in tiles (x..x+w-1, y..y+h-1). Walls sit on the outer edge. See docs/ARCHITECTURE.md.
  // Columns A x0-9, B x13-22, C x26-35; rows 0 y0-7, 1 y11-18, 2 y22-29, 3 y33-40. Corridors between.
  const ROOMS = [
    { key: 'observatory', name: 'Observatory', x: 0,  y: 0,  w: 10, h: 8, kind: 'room', floor: 'deck_blue',  wall: '#2a3340', accent: '#7fd4ff',
      desc: 'Where Onyx designs and reviews, with a view of the planet.',
      seats: { onyx: { x: 4, y: 2, face: 'north' } },
      spots: { leisure: [{ x: 2, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 2 }] } },
    { key: 'bridge', name: 'Bridge', x: 13, y: 0,  w: 10, h: 8, kind: 'room', floor: 'deck_steel', wall: '#3a3a44', accent: '#f5a623',
      desc: 'Cobalt directs from here. The inbox tray is by the door.',
      seats: { cobalt: { x: 17, y: 2, face: 'north' } },
      spots: { inbox: { x: 20, y: 3 }, stand: [{ x: 19, y: 4 }, { x: 21, y: 4 }, { x: 20, y: 5 }], meet: { x: 17, y: 5 } } },
    { key: 'watch', name: 'Watch', x: 26, y: 0,  w: 10, h: 8, kind: 'room', floor: 'deck_steel', wall: '#3b3238', accent: '#ff5e5e',
      desc: 'Pyrite watches the station\'s health on a wall of screens.',
      seats: { pyrite: { x: 30, y: 2, face: 'north' } },
      spots: {} },
    { key: 'library', name: 'Library', x: 0,  y: 11, w: 10, h: 8, kind: 'room', floor: 'deck_wood',  wall: '#3d3324', accent: '#ffcc80',
      desc: 'Zircon writes the docs; Mica keeps the archive.',
      seats: { zircon: { x: 3, y: 13, face: 'north' }, mica: { x: 6, y: 13, face: 'north' } },
      spots: { leisure: [{ x: 1, y: 16 }, { x: 4, y: 17 }, { x: 8, y: 16 }] } },
    { key: 'planning', name: 'Planning', x: 13, y: 11, w: 10, h: 8, kind: 'room', floor: 'deck_steel', wall: '#33383a', accent: '#9be7a1',
      desc: 'Agate lays out the coming work here.',
      seats: { agate: { x: 17, y: 13, face: 'north' } },
      spots: {} },
    { key: 'records', name: 'Records', x: 26, y: 11, w: 10, h: 8, kind: 'room', floor: 'deck_wood',  wall: '#3a3330', accent: '#d7c3a1',
      desc: 'Olivine files the station records.',
      seats: { olivine: { x: 30, y: 13, face: 'north' } },
      spots: {} },
    { key: 'lounge', name: 'Garden', x: 0,  y: 22, w: 10, h: 8, kind: 'room', floor: 'deck_green', wall: '#2c3a2e', accent: '#8ef58a',
      desc: 'The visitor\'s garden. Obsidian rests here between reviews.',
      seats: { obsidian: { x: 4, y: 25, face: 'south' } },
      spots: { leisure: [{ x: 2, y: 27 }, { x: 7, y: 24 }, { x: 7, y: 28 }] } },
    { key: 'workshop', name: 'Workshop', x: 13, y: 22, w: 10, h: 8, kind: 'room', floor: 'deck_rust',  wall: '#3f2f24', accent: '#ff9f43',
      desc: 'The builders. Basalt and Garnet share a workshop; the Drones bunk here.',
      seats: { basalt: { x: 15, y: 24, face: 'north' }, garnet: { x: 20, y: 24, face: 'north' } },
      spots: { bunks: [{ x: 14, y: 28 }, { x: 16, y: 28 }, { x: 18, y: 28 }, { x: 20, y: 28 }] } },
    { key: 'bench', name: 'Bench', x: 26, y: 22, w: 10, h: 8, kind: 'room', floor: 'deck_steel', wall: '#2f3a3a', accent: '#7ef0d8',
      desc: 'Topaz\'s bench for the mechanical work.',
      seats: { topaz: { x: 30, y: 24, face: 'north' } },
      spots: {} },
    { key: 'charging', name: 'Charging bay', x: 0,  y: 33, w: 10, h: 8, kind: 'room', floor: 'deck_dark',  wall: '#26303a', accent: '#5ff0ff',
      desc: 'Robots do not sleep. At night the idle crew docks here and charges.',
      seats: {},
      spots: { pads: [{ x: 1, y: 35 }, { x: 3, y: 35 }, { x: 5, y: 35 }, { x: 7, y: 35 }, { x: 9, y: 35 },
                      { x: 1, y: 38 }, { x: 3, y: 38 }, { x: 5, y: 38 }, { x: 7, y: 38 }, { x: 9, y: 38 }] } },
    { key: 'reactor', name: 'Core room', x: 13, y: 33, w: 10, h: 8, kind: 'room', floor: 'deck_dark',  wall: '#2a2f3a', accent: '#6ad1ff',
      desc: 'Quartz tends the core.',
      seats: { quartz: { x: 15, y: 35, face: 'north' } },
      spots: { core: { x: 18, y: 37 } } },
    { key: 'pad', name: 'Landing pad', x: 26, y: 33, w: 10, h: 8, kind: 'pad', floor: 'pad', wall: '#3a3a2a', accent: '#f5e663',
      desc: 'Where Obsidian arrives and merged work ships out.',
      seats: {},
      spots: { shuttle: { x: 30, y: 36 } } },
    { key: 'dock', name: 'Construction dock', x: 39, y: 11, w: 10, h: 30, kind: 'dock', floor: 'dock', wall: '#2a2a2a', accent: '#f5a623',
      desc: 'The epics, as sections of the station still being built. Panels light as cards close.',
      seats: {},
      spots: {} },
    // corridors (no walls between corridors; walls against space)
    { key: 'corr_va', name: 'Hall', x: 10, y: 0,  w: 3,  h: 41, kind: 'corridor', floor: 'corridor', wall: '#2a2a2e', accent: '#f5a623' },
    { key: 'corr_vb', name: 'Hall', x: 23, y: 0,  w: 3,  h: 41, kind: 'corridor', floor: 'corridor', wall: '#2a2a2e', accent: '#f5a623' },
    { key: 'corr_h0', name: 'Hall', x: 0,  y: 8,  w: 36, h: 3,  kind: 'corridor', floor: 'corridor', wall: '#2a2a2e', accent: '#f5a623' },
    { key: 'corr_h1', name: 'Hall', x: 0,  y: 19, w: 39, h: 3,  kind: 'corridor', floor: 'corridor', wall: '#2a2a2e', accent: '#f5a623' },
    { key: 'corr_h2', name: 'Hall', x: 0,  y: 30, w: 36, h: 3,  kind: 'corridor', floor: 'corridor', wall: '#2a2a2e', accent: '#f5a623' },
  ];

  // Doors: side N|S|E|W of the room, `at` = tile index along that wall from its west/north end, width in tiles.
  const DOORS = [
    { room: 'observatory', side: 'E', at: 3, width: 2 }, { room: 'observatory', side: 'S', at: 4, width: 2 },
    { room: 'bridge', side: 'W', at: 3, width: 2 }, { room: 'bridge', side: 'E', at: 3, width: 2 }, { room: 'bridge', side: 'S', at: 4, width: 2 },
    { room: 'watch', side: 'W', at: 3, width: 2 }, { room: 'watch', side: 'S', at: 4, width: 2 },
    { room: 'library', side: 'E', at: 3, width: 2 }, { room: 'library', side: 'N', at: 4, width: 2 }, { room: 'library', side: 'S', at: 4, width: 2 },
    { room: 'planning', side: 'W', at: 3, width: 2 }, { room: 'planning', side: 'E', at: 3, width: 2 },
    { room: 'records', side: 'W', at: 3, width: 2 }, { room: 'records', side: 'N', at: 4, width: 2 },
    { room: 'lounge', side: 'E', at: 3, width: 2 }, { room: 'lounge', side: 'N', at: 4, width: 2 },
    { room: 'workshop', side: 'W', at: 3, width: 2 }, { room: 'workshop', side: 'E', at: 3, width: 2 }, { room: 'workshop', side: 'N', at: 4, width: 2 }, { room: 'workshop', side: 'S', at: 4, width: 2 },
    { room: 'bench', side: 'W', at: 3, width: 2 }, { room: 'bench', side: 'S', at: 4, width: 2 },
    { room: 'charging', side: 'E', at: 3, width: 2 }, { room: 'charging', side: 'N', at: 4, width: 2 },
    { room: 'reactor', side: 'W', at: 3, width: 2 }, { room: 'reactor', side: 'E', at: 3, width: 2 }, { room: 'reactor', side: 'N', at: 4, width: 2 },
    { room: 'pad', side: 'W', at: 3, width: 2 }, { room: 'pad', side: 'N', at: 4, width: 2 },
    { room: 'dock', side: 'W', at: 8, width: 3 },
  ];

  // Members keyed by board.json crew.members[].key. `art` = portrait file prefix in assets/crew/; `skin` = sprite sheet in assets/sprites.
  const MEMBERS = {
    cobalt:      { key: 'cobalt',      name: 'Cobalt',    art: 'cobalt',  skin: 'cobalt', room: 'bridge',      leisure: ['observatory', 'library'] },
    agate:     { key: 'agate',     name: 'Agate',      art: 'agate',    skin: 'agate', room: 'planning',    leisure: ['library', 'lounge'] },
    basalt:      { key: 'basalt',      name: 'Basalt',      art: 'basalt',    skin: 'basalt', room: 'workshop',    leisure: ['lounge', 'library'] },
    garnet:     { key: 'garnet',     name: 'Garnet',      art: 'garnet',    skin: 'garnet', room: 'workshop',    leisure: ['lounge', 'observatory'] },
    onyx:     { key: 'onyx',     name: 'Onyx',       art: 'onyx',     skin: 'onyx', room: 'observatory', leisure: ['library', 'lounge'] },
    topaz:    { key: 'topaz',    name: 'Topaz',    art: 'topaz',  skin: 'topaz', room: 'bench',       leisure: ['lounge', 'observatory'] },
    zircon:      { key: 'zircon',      name: 'Zircon',      art: 'zircon',    skin: 'zircon', room: 'library',     leisure: ['observatory', 'lounge'] },
    mica: { key: 'mica', name: 'Mica',     art: 'mica',   skin: 'mica', room: 'library',     leisure: ['observatory', 'lounge'] },
    quartz:    { key: 'quartz',       name: 'Quartz',      art: 'quartz',    skin: 'quartz', room: 'reactor',     leisure: ['lounge', 'library'] },
    pyrite:    { key: 'pyrite',    name: 'Pyrite',     art: 'pyrite',   skin: 'pyrite', room: 'watch',       leisure: ['observatory'] },
    olivine:     { key: 'olivine',     name: 'Olivine', art: 'olivine',    skin: 'olivine', room: 'records',     leisure: ['library', 'lounge'] },
    obsidian:  { key: 'obsidian',  name: 'Obsidian',   art: 'obsidian', skin: 'obsidian', room: 'lounge',      leisure: ['observatory', 'library'] },
    drones:   { key: 'drones',   name: 'Drones',    art: 'drones',  skin: 'drones', room: 'workshop',    leisure: ['lounge', 'library', 'observatory'], pool: true, minCount: 2, maxCount: 6, scale: 0.8 },
  };

  // Who does what in the board logic: every hard-coded member reference goes through these.
  const ROLES = { merger: 'cobalt', planner: 'agate', visitor: 'obsidian', reviewer: 'onyx', builders: ['basalt', 'garnet'], pool: 'drones' };

  // Card code conventions: inbox prefix on waiting_on codes; suffixes of review and closure rows.
  const CODES = { ask: 'ASK-', review: 'r', closure: '.fc' };

  const SKINS = Array.from(new Set(Object.values(MEMBERS).map(m => m.skin)));

  const PALETTE = {
    space: '#05060c', star: '#cfd8ff', planet: '#2a4a7a', planetLit: '#6aa3d8',
    hull: '#191712', hullEdge: '#3a342a', hullLit: '#5a5040',
    amber: '#f5a623', amberDim: '#8a5a12', blue: '#4fc3f7', cyan: '#5ff0ff', red: '#ff5e5e', green: '#8ef58a',
    text: '#e8e2d0', textDim: '#9a948a',
    deck_steel: '#3b3f47', deck_blue: '#2e3b52', deck_wood: '#4a3a2a', deck_green: '#2f4a33', deck_rust: '#4a3426',
    deck_dark: '#262a33', corridor: '#2d2d33', pad: '#33332a', dock: '#202020',
  };

  const TIMING = {
    refreshMs: 10 * 60 * 1000,   // board.json re-fetch
    staleMinutes: 40,            // header turns amber, hand-off walks stop
    activeMinutes: 60,           // "worked within the last hour" lights the room
    handoffWindowMinutes: 15,    // an event younger than this is acted out
    walkTilesPerSec: 1.0,
    wanderEverySec: [8, 25],     // idle pause between wanders (min, max)
    talkSec: 8,
    tourAfterSec: 60,
    nightStart: 22, nightEnd: 6, // board clock hours
    bubbleTtlSec: 6,
  };

  // the board file: a <meta name="crew-board-url"> wins; otherwise the sample board
  function boardUrl() {
    const meta = typeof document !== 'undefined' && document.querySelector && document.querySelector('meta[name="crew-board-url"]');
    if (meta && meta.content) return meta.content;
    return 'data/sample-board.json';
  }

  return { TILE_W, TILE_H, GRID, ROOMS, DOORS, MEMBERS, ROLES, CODES, SKINS, PALETTE, TIMING,
           BOARD_URL: boardUrl(), BOARD_TIME_ZONE: null, ART_URL: 'assets/crew/', SPRITE_URL: 'assets/sprites/', FURNITURE_URL: 'assets/furniture/' };
})();
