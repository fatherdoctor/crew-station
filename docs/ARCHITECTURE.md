# Architecture

Plain HTML plus classic `<script>` files, one global each, drawn with Canvas 2D at `image-rendering: pixelated`.
`AGENT-REFERENCE.md` has the file map, load order and data formats. This file describes how the code runs.

## Coordinate systems

- **Grid:** tiles, `x` east and `y` south. Integer `(x, y)` is a tile's north corner, `(x + 0.5, y + 0.5)` its center.
- **World px:** `ISO.toScreen(x, y)`: `sx = (x - y) * 32`, `sy = (x + y) * 16`, for 64 x 32 diamonds.
- **Screen:** `CAMERA` holds an origin and a zoom, and converts with `toWorld` and `toClient`.
- **Depth:** `ISO.depth`; larger draws later. Everything in the frame sorts as `{depth, draw(ctx)}`.

## Boot (`js/main.js`)

1. In parallel: `BOARD.load`, `SPRITES.load`, `PROPS.preload`, `BACKDROP.preload` (which loads `OBJECTS` and `FLOORS`), the font.
2. `WORLD.init`, `PROPS.init`, `WORLD.finalize` (BACKDROP hooks this to apply footprints and floor blocks before the nav grid is built).
3. `AGENTS.init`, `FX.init`, `CREWPANEL.init`, `CAMERA.init` and fit, `HUD.init`, then the first frame.

All of it is in one `try`: a failure replaces the loading line.

## Frame

`AGENTS.tick`, `FX.tick`, `CAMERA.tick`; `BACKDROP.draw` (stars, planet, hull, hall layer, room shells); depth-sorted
wall strips and object strips (`BACKDROP.coverDrawables`), props, figures, FX and interaction items; name plates;
`BACKDROP.drawLight`; overlays for nameplates and bubbles; `HUD.tick`. A hidden page stops the loop.

## StationModel (`BOARD.model`)

`BOARD.build(raw)` derives what `AGENTS`, `FX` and `HUD` read:

- `generated`, `today`, `ageMinutes`, `stale`, `isNight`, `demo`, `sample`
- `members[key]`: `state`, `activeRecently`, `minutesSinceRun`, `card`, `task`, `since`, `waitingOn`, `blockedOn`,
  `helpersRunning`, `runsToday`, `pointsToday`, `streak`, `lastRun`
- `inbox`: `CONFIG.CODES.ask` codes from `waitingOn`
- `events`: newest first, one per kind and card, at most 40: `handoff`, `verdict`, `closure`, `merge`, `plan`,
  `helpers`, `skip`
- `epics`: progress per epic for the dock
- `load`, `cycle`

`BOARD.raw` is the file as fetched; `CREWPANEL` and the accomplishment chats read it directly. `BOARD.onChange` fires on
each refresh and demo step.

## Modules

- **AGENTS:** one agent per member plus a drone pool. A member's state picks a plan: work, roam, charge, blocked, ask.
  Recent events become walks and conversations. Walking follows `WORLD.path`, in screen-straight legs.
- **WORLD:** tile grid and A* with turn costs. `setStepMode('diag')` uses diagonal grid steps, straight on screen.
- **BACKDROP:** fits painted pieces to the grid by translation, applies layout tables, cuts wall strips so figures pass
  behind walls, and builds the per-room night darkness from each room's own pixels.
- **OBJECTS:** cuts object and hero sprites into 32 px screen-column strips, each with the depth of the footprint tile
  in front of it.
- **FLOORS:** applies placements, shifts anything off the floor polygon, moves seats and spots to free tiles, blocks
  off-floor tiles, and logs desk and base audits.
- **FX:** a particle pool, bubbles, parcels from events, 20-block dock stacks per epic, ambient lights.
- **INTERACTIONS:** actions fill idle time inside a plan. It holds the registry of interactable objects, the drone job
  loops, and the shuttle's cycle. It keeps state in `sessionStorage`.
- **PROPS:** name plates and the inbox tray.
- **HUD and CREWPANEL:** DOM over the canvas. `CAMERA.setInsets` keeps the station centered in the area the panel leaves.

## Canvases

Sources stay as `Image`s. Baked canvases (hall layer, hull layer, wall strips, star tile, night cuts, FX block
stand-ins) are rebuilt by each module's `rebuild()`, run from `rebuildAll()` in
`js/main.js`. `BACKDROP.blankCheck()` reads one known-opaque pixel per canvas family.
