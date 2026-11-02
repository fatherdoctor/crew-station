# Crew Station: guide for coding agents

This guide assumes you have this repository and nothing else.

## What this is

A single page: an isometric pixel-art space station drawn on a 2D canvas, with robot crew figures that act out
the contents of one JSON file (the "board"). Beside it, a DOM panel lists the crew. It is plain HTML, CSS and
classic `<script>` files: no modules, bundler, framework, backend or dependencies. Every script exposes one
global. The page only reads data; it never writes anywhere.

Truth rule: a figure's room, desk, blocked chain, "needs you" bubble and charging pad follow its board state.
Parcels carry real card codes from real events. Everything else (walking, chatting, fidgeting, lamps, sparks) is
ambient and claims nothing.

## Run and check

```sh
node tools/check.js                       # exits 0 when the tree is consistent; needs only node
node tools/check.js --board my-board.json # validates your board file instead of the default
# The check always validates the tree that holds this tools/ folder, so run it from your own copy.
python3 -m http.server 8000               # from the repository root; any static server works
```

Open http://localhost:8000/. It must be HTTP: the page fetches JSON, which browsers refuse from `file://`.

In a browser, a good start looks like this:

- The text "loading the station... n/m" counts up, then disappears.
- The console shows `station: started in <n> ms, <n> files`. If optional files failed, the line ends with
  `missing: ...`. It should not end that way on this tree.
- The header reads CREW STATION. The panel says `13 crew`.
- `http://localhost:8000/?demo=1` shows a "demo" pill and the states rotate every 20 s.
- `BACKDROP._debug.blankCanvases()` in the console clears the baked canvases: hall floors, hull, wall strips and stars
  go, while room floors stay because they are plain images. Then `STATION_RECOVERY.rebuildAll('test')` brings them
  back and logs `station: canvases rebuilt (test) in <n> ms`. The 5 s probe may rebuild first and log
  `station: canvases rebuilt (probe: ...)`.

A failed start replaces the loading line with `Could not load <file>. Reload to try again.` or `Could not start
the station: ...`. The stack is in the console.

### Console warnings on a healthy start

These appear on this tree and are the baseline, measured with a stub that reads real image alpha, not in a browser. Look for anything new.

| Prefix | What it says |
|---|---|
| `objects:` | 4 footprints differ from the measured sprite base, twice each (planning storage cabinet, bench testing section, lounge planter row south, pad service crane); `records door N tile (30,11) under north archive shelves` |
| `floors: ... placed by hand but off the floor` | 13 hand-placed objects slightly over a polygon edge |
| `placements: basalt seat 3,4 has no object beside it`, `placements: garnet seat 7,3 has no object beside it` | Each followed by its `floors: DESK CHECK FAILED` line. Both stand clear of the desk on purpose and look right |
| `floors: DESK CHECK FAILED obsidian` | The couch seat sits behind its couch |
| `floors: base audit` | The observatory astronomy desk and workshop work desk cover walkable tiles. No seat is on them; a walking figure could clip them |
| `fx: <n> painted hall lamps found` | A count, not a problem. It reads 0 under a stubbed canvas |
| Chrome: `Canvas2D: Multiple readback operations ... willReadFrequently` | Reported by a browser test under `?demo=1` or after a board refresh; harmless |

### What cannot be verified without a browser

`tools/check.js` and `node --check` prove files and data agree, not that anything looks right. Without a browser
you cannot verify rendering, alignment of art, depth sorting, animation, the panel layout, input, or the canvas
recovery. Layout code also measures real image pixels (seat rejection, desk checks, painted lamps), so a stubbed
DOM without real alpha produces different warnings. Treat layout warnings as real only in a browser.

## File map and load order

`index.html` loads these in this order. The order matters.

| File | Global | Job |
|---|---|---|
| `js/loadq.js` | `LOADQ` | Capped, timed, retrying loader; the loading line |
| `js/config.js` | `CONFIG` | Rooms, doors, members, roles, palette, timing, URLs |
| `js/iso.js` | `ISO` | Tile to screen math |
| `js/world.js` | `WORLD` | Tile grid, walls, doors, pathfinding |
| `js/floors.js` | `FLOORS` | Floor polygons and hand placements |
| `js/backdrop.js` | `BACKDROP` | Draws the station from painted pieces; the night light; canvas rebuilds |
| `js/objects.js` | `OBJECTS` | Floor-standing object sprites and animated hero pieces |
| `js/sprites.js` | `SPRITES` | Crew sprite atlases |
| `js/props.js` | `PROPS` | Inbox tray and room name plates |
| `js/board.js` | `BOARD` | Reads the board file, derives the model |
| `js/fx.js` | `FX` | Parcels, bubbles, dock block stacks, ambient light and particles |
| `js/agents.js` | `AGENTS` | Crew behavior, plans and walking |
| `js/interactions.js` | `INTERACTIONS` | Ambient actions on objects, drone jobs, the shuttle |
| `js/camera.js` | `CAMERA` | Pan, zoom, tour, framing |
| `js/hud.js` | `HUD` | Header, captions, legend, toasts |
| `js/crewpanel.js` | `CREWPANEL` | The crew panel |
| `js/main.js` | none | Boot and the frame loop |

Other paths:

| Path | Contents |
|---|---|
| `css/station.css` | All styles. Per-member chart colors are `--m-<key>` on `#crew-panel` |
| `data/sample-board.json` | The default board, invented |
| `assets/rooms/<room>.png` | Room shells: floor, walls, wall-mounted things |
| `assets/objects/<room>.{json,png}` | Per-room object sheet and its data |
| `assets/heroes/<name>.{json,png}` | Animated centerpieces: reactor, globe, telescope |
| `assets/corridors/` | Hall pieces and hull skirts |
| `assets/blocks/` | Dock block sprites and the crane hook |
| `assets/backdrop/planet.png` | The planet |
| `assets/props/` | `items` (held items, effects) and `shuttle` sheets, each `.json` + `.png`; `parcel-crate.png`, `parcel-crate-flagged.png` (rejected) and `parcel-crate-notes.png` (approved with notes), 48 x 48 with the foot at (24, 44) |
| `assets/furniture/inbox_tray_iso.png` | The inbox tray |
| `assets/sprites/` | One atlas PNG per crew member and `atlas.json` |
| `assets/crew/` | Panel portraits |
| `assets/floors.json`, `assets/placements.json` | Floor polygons, hand placements |
| `assets/fonts/` | VT323 and its license |
| `tools/check.js` | The tree check |
| `art-kit/` | For making new art: see `art-kit/ART-GUIDE.md`. The page loads nothing from it |

## Using it in another project

1. **Place the files.** Copy `index.html`, `css/`, `js/`, `assets/` and `data/` into one folder served by your
   project, for example `public/station/`. All URLs are relative to the page, so any subpath works. Keep the folder
   layout. `art-kit/` and the docs are optional. Keep `tools/` if you want to check your copy. Keep `LICENSE`, `NOTICE.md` and `assets/fonts/OFL.txt`
   with the files.
2. **Serve them.** Any static host. It must serve `.png`, `.webp`, `.woff2` and `.json` with normal content types.
   There is no server code to run and no install step.
3. **Show it.** The page expects the whole window, and `index.html`'s element ids (`stage`, `hud`, `hud-*`,
   `crew-panel`) are looked up by name. The simplest embed is a link, or an `<iframe src="station/index.html">`.
   Scripts are classic globals (`CONFIG`, `BOARD`, ...), so an iframe also avoids name clashes with your own page.
4. **Feed it your data.** Generate a board file (schema below) from your project's data and point the page at it,
   in one of these ways, strongest first:
   - URL: `index.html?board=/api/board.json`
   - Page: `<meta name="crew-board-url" content="/api/board.json">` in `index.html`
   - Default: the `return 'data/sample-board.json'` line in `boardUrl()` in `js/config.js`

   A relative URL resolves against the page; a leading `/` against the site root. The header's Board link in `index.html` points at the sample, so change it too.

   Validate with `node tools/check.js --board your-file.json`.
5. **Decide your names.** The crew and rooms are data in `js/config.js`; see the sections below.

### Live data rules

- The page refetches the board every `CONFIG.TIMING.refreshMs` (10 minutes), and when a hidden tab returns after more
  than 60 s. It adds `?t=<now>` and asks for `no-store`. A cross-origin URL needs CORS headers.
- Remove `"sample": true` for a live board. A sample is a frozen snapshot that never goes stale. A live board whose
  `generated` is older than `CONFIG.TIMING.staleMinutes` (40) shows a stale notice.
- Board times are wall-clock strings, `YYYY-MM-DD HH:MM`. Set `BOARD_TIME_ZONE` in `js/config.js` (for example
  `'Europe/Paris'`) to the zone they are written in. `null` means the viewer's zone.
- Events are derived from the data; you send no event list. An event under
  `CONFIG.TIMING.handoffWindowMinutes` (15) old is acted out as a parcel.
- A missing or malformed board stops the first start with the readable error. A failed refresh keeps the last good board.
- Rows missing their required field are dropped silently, so check your file.

## Board schema

Only `crew.members` matters for a basic page. Everything else is optional and its feature simply stays quiet. See
`data/sample-board.json` for a complete example.

Required fields per row (rows without them are dropped):

| Row | Required | Used if present |
|---|---|---|
| `crew.members[]` | `key` | Everything below. `state_key` defaults to `sleeping`. A non-string `last_run` is ignored; a non-array `points_7d` is treated as empty |
| `crew.usage_48h[]` | `t`, a parseable time, and a numeric `used_pct` | |
| `crew.spent_vs_earned[]` | `date` | `spent`, `earned`, `gap`, `other_work` |
| `cards[]` | `code` | `title`, `plain`, `queue`, `column`, `points`, `status`, `status_date` |
| `runs[]` | `queue` (a string); `item`, when present, a string | `date`, `start`, `end`, `skipped` |
| `epics.list[]` | `code` | `name`, `goal`, `owner`, `done_when`, `target`, `target_text`, `cards`, `state` |

```jsonc
{
  "sample": true,                  // frozen snapshot, never stale; omit for live data
  "generated": "2000-01-15 12:00", // the board clock; day and night follow it
  "today": "2000-01-15",
  "load": { "used_pct": 42 },      // header "load n%"; omit to hide it
  "cycle": { "current": 7, "cycles": [{ "n": 7, "name": "Sample cycle" }] },  // header "cycle 7"
  "queue_skips": { "2000-01-15": { "garnet": 1 } },   // date -> queue -> runs skipped
  "crew": {
    "members": [{
      "key": "basalt",             // must be a key of CONFIG.MEMBERS to get a figure
      "name": "Basalt", "role": "Builder",
      "queue": "basalt",           // queue this member's cards and runs use; adds to QUEUE_TO_MEMBER for this board
      "art": "basalt",             // portrait file prefix in assets/crew/; omit for a letter
      "state": "Working",          // a readable copy; the page shows the label for state_key
      "state_key": "working",      // drives the figure and the panel: waiting-on-you | blocked | working | queued | done-today | sleeping
      "card": "TASK-104", "task": "Building the new status view",
      "since": "2000-01-15 11:15", "last_run": "2000-01-15 11:15",
      "waiting_on": [],            // codes starting with CONFIG.CODES.ask (ASK-) go to the inbox tray
      "blocked_on": [],
      "helpers_running": 1,        // sends drones to help
      "runs_today": 3, "runs_7d": 22,
      "points_cycle": 34, "points_7d": [{ "date": "2000-01-15", "points": 3 }], // one per crew.days entry
      "streak": 4, "best_streak": 7, "closed_7d": 6,
      "counts": "runs",            // optional: show runs instead of points in the row details
      "helpers": { "hours": 24, "count": 6, "by_queue": { "basalt": 4 } } // only on the pool member
    }],
    "days": ["2000-01-09"],        // the 7 days of the points chart
    "usage_48h": [{ "t": "2000-01-15 08:00", "used_pct": 40 }],
    "spent_vs_earned": [{ "date": "2000-01-15", "spent": 42, "earned": 28, "gap": 14, "other_work": 3 }],
    "trophies": { "busiest": { "name": "Basalt", "value": 30 }, "most_closed": { "name": "Basalt", "value": 6 },
                  "longest_streak": { "name": "Onyx", "value": 11 }, "peak_parallel_queues": { "value": 4 } }
  },
  "cards": [{
    "code": "TASK-102", "title": "Speed up the search index", "plain": "Optional longer title for captions",
    "queue": "garnet",             // "owner" marks a decision card that is not crew news
    "column": "In review",         // Done | In review | Next 24h | Blocked/Waiting | Backlog
    "points": 5, "status_date": "2000-01-15",
    "status": "READY FOR REVIEW 2000-01-15 11:48"
  }],
  "runs": [{ "date": "2000-01-15", "queue": "onyx", "item": "TASK-100r", "start": "10:30", "end": "10:50", "skipped": false }],
  "epics": { "list": [{
    "code": "EPIC-1", "name": "Search", "goal": "...", "owner": "onyx", "done_when": "...",
    "target": "2000-02-01", "target_text": "early February",
    "cards": ["TASK-101", "TASK-102"], // the dock stack fills with the share of these in column Done
    "state": { "value": "on track", "note": "Review under way" }
  }] }
}
```

`status` text drives events, by these patterns in `js/board.js` and `js/agents.js`:

| Status text | Effect |
|---|---|
| `READY FOR REVIEW YYYY-MM-DD HH:MM`, dated today | Hand-off parcel from the card's queue to the queue of card `<code>r`, or a default reviewer |
| `MERGED YYYY-MM-DD HH:MM`, dated today; or the merger's run today on a card whose status says merged | Merge parcel |
| `DONE YYYY-MM-DD ...`, in column Done, today or yesterday | Chance-meeting chat about the card |
| `APPROVED`, `APPROVED WITH NOTES` or `REJECTED` | Verdict on review rows, with code ending `r` or `.fc`, when a run today names them |

Suffixes, in `CONFIG.CODES`: a code ending `r` is a review of the code before it; one ending `.fc` is its closure check. A rejected verdict is red on the parcel; approved with notes has an amber tag.

## Hard-coded names

Member keys used by logic go through `CONFIG.ROLES` in `js/config.js`:

| Role | Member | What it does |
|---|---|---|
| `merger` | `cobalt` | Receives plans and closures, merges, amber nameplate |
| `planner` | `agate` | Its newest run today is the plan event |
| `visitor` | `obsidian` | Its recent run or events light the shuttle's thrusters; flights come from cargo |
| `reviewer` | `onyx` | Default reviewer for builder hand-offs |
| `builders` | `basalt`, `garnet` | The first is the default reviewer for anyone else |
| `pool` | `drones` | Several figures, no seat, `helpers` panel row |

Keys in `CONFIG.MEMBERS`, `QUEUE_TO_MEMBER` in `js/board.js`, `--m-<key>` in the stylesheet, `seats` in
`assets/placements.json` and the seat keys in `ROOM_TABLE` and `OBJECT_TABLE` in `js/backdrop.js` must agree.

Room keys are hard-coded in these files. Keep these rooms, or edit the listed file:

| File | Room keys |
|---|---|
| `js/objects.js` | All 13 in `ROOM_KEYS`; `reactor`, `watch`, `observatory` in `HEROES`; `FIXES`, `SKIP` |
| `js/backdrop.js` | `pad`, `reactor`, `workshop`, and every key in the two tables |
| `js/agents.js` | `bridge`, `charging`, `workshop` |
| `js/fx.js` | `bridge`, `charging`, `dock`, `lounge`, `pad`, `reactor`, `watch`, `workshop`, `corr_h0`, `corr_va` |
| `js/hud.js` | `dock` |
| `js/interactions.js` | `bench`, `bridge`, `library`, `lounge`, `pad`, `planning`, `reactor`, `records`, `watch`, `workshop` |
| `js/props.js` | `bridge` (the tray) |
| `js/world.js` | Room `kind` `pad`, not a key |

## How the art fits together

World model: a tile grid (`CONFIG.GRID`, 50 x 42) with 64 x 32 px diamonds. `(x, y)` is a tile's north corner; grid
east is screen down-right, grid south is screen down-left. `CONFIG.ROOMS` gives each room a rect in tiles.

- **Sprites.** `assets/sprites/atlas.json` is `{frame: 92, skins: {<skin>: {image, cols, rows, tracks: {<track>:
  [{x, y}, ...]}}}}`. Each cell is 92 x 92 px, with the figure's feet at row 68. Track names are `<action>_<dir>`, for
  example `walk_south-east`. A track a skin lacks falls back through `resolve()` in `js/sprites.js`. The figure's skin
  is `CONFIG.MEMBERS[key].skin`.
- **Rooms.** `assets/rooms/<room>.png` is a shell on a 1024 x 768 canvas (`dock`: 1280 x 900), placed on the grid by
  translation only, never scaled. Its floor must line up with the room's rect: `BACKDROP.fits` and the console flag a
  piece out of tolerance.
- **Objects.** `assets/objects/<room>.json` lists sprites cut from the room's sheet: `{name, cell: [x, y, w, h],
  origin: [px, py] (top-left on the room canvas), footprint: [tx, ty, tw, th] (room-local tiles), kind:
  desk|seatless|lowprofile}`, inside `{room, shell, sheet, objects}`, where `shell` and `sheet` are paths relative to the JSON. Footprints block walking and sort depth.
- **Heroes.** Reactor, globe and telescope, defined in `HEROES` in `js/objects.js`, with frames in `assets/heroes/`.
- **Floors.** `assets/floors.json`: `{<room>: {points: [{px, tile}]}}`, the walkable polygon on the shell. Tiles outside
  it are blocked, except doors. `?floors=0` ignores it.
- **Placements.** `assets/placements.json` is the highest-priority layout: `{<room>: {objects: [{name, fp: [x, y, w,
  h], keep}], heroes: [{name, fp, keep}], seats: {<member>: {tile: [x, y], face}}}}`, room-local. Objects are matched
  in the order the room lists them. `keep` lists tiles relative to the footprint origin that block walking in its
  place. `?placements=0` ignores it.
- **Layout tables.** `ROOM_TABLE` and `OBJECT_TABLE` in `js/backdrop.js` hold door, seat, desk, spot and FX anchor
  overrides per room; `FIXES` in `js/objects.js` holds footprint corrections.

Precedence for a seat: placements, then floor fitting, then `OBJECT_TABLE` and `ROOM_TABLE`, then `CONFIG`.

## Change the crew

The 13 members are keys of `CONFIG.MEMBERS`. To rename one, change `name`, or the key everywhere listed under Hard-coded names.

To add a member `newkey`:

1. `js/config.js`: add `MEMBERS.newkey` (`key`, `name`, `art`, `skin`, `room`, `leisure: [rooms]`), and a seat in that room:
   `seats: { newkey: { x, y, face } }` (absolute tiles, inside the room's rect).
2. `js/board.js`: add it to `QUEUE_TO_MEMBER`, so its queue's events reach it.
3. `assets/sprites/`: add `<skin>.png` and a `skins.<skin>` entry in `atlas.json`. Provide at least `rot_*`, `walk_*`,
   `sit_*` and `type_*` tracks. `SPRITES.load` stops the start if the atlas image is missing.
4. `assets/crew/`: add 12 portraits, `<art>-<state>-1x.webp` and `-2x.webp`, 96 px wide at 1x, for the six state
   keys `working queued waiting-on-you blocked done-today sleeping`.
5. `assets/placements.json`: add a seat if the room needs an exact spot; `css/station.css`: add `--m-newkey`.
6. Give the seat a desk: see Add a desk.
7. Board: add a `crew.members` entry with its `queue`, or map the queue in `QUEUE_TO_MEMBER` in `js/board.js`. Run `node tools/check.js`.

The check does not catch a missing queue mapping, a missing `--m-newkey`, or a board member with an unknown key (a note only).

A member without a board entry shows in captions as "not on the board". A pool member (`pool: true`, `minCount`,
`maxCount`) gets several figures and no seat.

## Add a desk

1. Add the object to `assets/objects/<room>.json` with `kind: "desk"`, or use an existing one, and its sprite to the sheet.
2. Put the seat on a free floor tile directly in front of it, on the larger `x + y` side, so the figure sorts in front.
   Set it in `CONFIG.ROOMS[].seats` or in `seats` in `assets/placements.json`.
3. If the desk is not one row north of the seat, add `desks: { <member>: { x, y } }` to `OBJECT_TABLE` in
   `js/backdrop.js`. The desk's screen glow follows that tile.
4. In a browser, check the console for `floors: desk check` and the `backdrop: reach check`.

## Add or change a room

To rename a room on screen, change only its `name` in `ROOMS`; `key` stays (the `lounge` room is named Garden).

1. `js/config.js`: add to `ROOMS` (`key`, `name`, rect, `kind`, `floor`, `wall`, `accent`, `desc`, `seats`, `spots`) and
   add its openings to `DOORS`. Halls are `kind: 'corridor'` rects; rooms must touch them through a door.
2. `js/objects.js`: add the key to `ROOM_KEYS`.
3. Art: `assets/rooms/<key>.png` and `assets/objects/<key>.{json,png}`. These are essential: a missing one stops the
   start, on purpose. `art-kit/guides/` has wireframes at the exact canvas.
4. Optional: a polygon in `assets/floors.json`, placements in `assets/placements.json`, overrides in
   `OBJECT_TABLE`. `INTERACTIONS` matches objects by room and name to offer actions (table in
   `js/interactions.js`); objects it does not know are just furniture.
5. The pad is fixed in code: `SHUTTLE` in `js/interactions.js` holds absolute tiles, so moving the `pad` room breaks the shuttle until you edit it.
6. Run `node tools/check.js`. Check the console in a browser for `backdrop:` and `floors:` warnings. `?bdgrid=1` overlays
   the grid: blocked tiles red, doors yellow, seats green, desks blue.

## Change art

Replace a file with one of the same name and pixel size, and nothing else changes. Room shells, object sheets, hall and hull pieces, heroes and the planet have partial alpha hardened at load (>= 128
opaque, otherwise clear). Sprite atlases, blocks, the `items` and `shuttle` sheets and the tray are drawn as they are, so paint with hard edges. If a sheet's layout changes, update its JSON. If a shell's
floor moves, update the polygon in `floors.json`. Keep PNG and WebP free of metadata. For new art, follow
`art-kit/ART-GUIDE.md`.

## URL switches

| Switch | Effect |
|---|---|
| `?board=<url>` | Read another board file |
| `?demo=1` | Rotate member states every 20 s with invented events, flip night |
| `?night=1` | Force night |
| `?floors=0` | Ignore floor polygons |
| `?placements=0` | Ignore hand placements |
| `?reducedmotion=1` | Half the ambient action rate, no particles; also follows the system setting |
| `?loadtimeout=<ms>`, `?loadmax=<n>` | Loader stall timeout (20000) and concurrency (8) |
| `?bdgrid=1` | Debug overlay of the tile grid |
| `?ixdebug=1` | Debug overlay for interactions |

## Input

Drag pans. Wheel or pinch zooms. Click or tap picks a figure, the tray, a dock stack or a room. Double-click frames a room.

| Key | Effect |
|---|---|
| Arrow keys | Pan |
| `+` `=`, `-` `_` | Zoom in, out |
| `0` | Fit the station |
| `T` | Start the tour |
| `Esc` | Close captions, the legend, and the panel on a phone |

Known issue: on a phone at low zoom, a tap's hit area can pick a neighboring figure.

## Behaviors that must hold

Keep these when you change the code.

- **Boot files load through `LOADQ`:** at most 8 at once, a 20 s *stall* timeout (no bytes), so a big file on a slow link
  is not cut off. Dock block sprites and panel portraits load on their own.
- **Retries:** a timeout, or HTTP 5xx, once. A network error once for JSON and essential images; a failed optional image
  is final. HTTP 4xx and bad JSON are final.
- **Essential files reject** and the loading line shows `Could not load <file>. Reload to try again.` Essential: the
  board, `atlas.json` and its images, room shells, room object JSON and sheets, hall pieces, hull skirts. Others are
  logged and skipped: heroes, hull corners, planet, placements, floors, the tray, the `items` and `shuttle` sheets and the
  three parcel crates, each on its own. A missing parcel crate falls back to a crate drawn in code.
- **The boot never hangs silently:** preloads, init and the first frame share one `try`, and uncaught errors during
  boot replace the loading text.
- **The frame loop survives:** one `requestAnimationFrame` pending at most, cancelled on hide. A frame error logs once
  and the loop continues.
- **Canvases can vanish.** Mobile browsers can drop an offscreen canvas's pixels while a tab is hidden. So every image
  the station draws from stays an `Image`, not a canvas (`BACKDROP.harden`), and every canvas baked from them can be
  rebuilt. `rebuildAll()` in `js/main.js` runs on `pageshow`, on `visibilitychange` to visible, on `resume`, on canvas
  context restore, and whenever the 5 s blank check finds one blank. A new long-lived canvas must join this:
  expose `bakedCanvases()` and `rebuild()` on the module and list it in `BAKERS`.
- **The truth rule above:** ambient code in `js/interactions.js` never claims work. Shuttle cargo comes only from real
  closures and merges today.
- **Read only:** the page's only data input is the board file. `sessionStorage` holds view state alone, under
  `crewstation.*` keys: panel open and closed, shuttle and dock state.
