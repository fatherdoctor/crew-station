# Crew Station art guide

How to make new art that matches Crew Station: a crew member, a room, an object, a hall piece, a block or a prop.
Read this next to the page's own repository. "The page" means that tree; its `docs/AGENT-REFERENCE.md` covers how art is wired in.

What is here:

| Path | Contents |
|---|---|
| `crew-refs/<member>/<state>.png` | Portrait stills that define each member's look |
| `guides/` | Wireframes at the exact canvas of each room, hall and hull piece; paint on these |
| `templates/` | Empty sheet grids and `sheet-layouts.json`, the cell list of each sprite sheet |
| `style/set-pieces.png` | Finished isometric objects, for matching style and scale |
| `tools/` | Scripts, see [TOOLS.md](TOOLS.md) |

The finished art that the page uses is in the page's `assets/` folder. It is the best reference for matching: look at
`assets/rooms/`, `assets/objects/` and `assets/sprites/` before you start.

Use only art you have the right to use, as an input or as a style reference.

## The look

Gritty, worn, industrial pixel art. Riveted steel decks with grime in the seams and rust streaks, exposed pipes and
bundled cables along walls, dented panels, hazard stripes, dirt in corners, ordered dither.

- Chunky pixels, hard edges, no anti-aliasing, no soft gradients.
- Limited dark palette: charcoal, gunmetal, rust, with small amber lamps and cold blue screens.
- Everything is bolted to the structure: machines on plinths, pipes to the walls, nothing floating.
- No text, numbers, labels, logos or watermarks in any art.
- Paint fixtures, not their light. The page adds glow, sparks and smoke, so do not bake in bloom, light pools, steam or
  sparks. Lit lamp lenses and screens are fine.

## Geometry

- True 2:1 isometric, one camera for everything. A floor tile is a diamond 64 px wide and 32 px tall.
- Every floor edge and floor line slopes exactly 0.500: one pixel down per two across. Verticals stay vertical.
- Grid east runs screen down-right. Grid south runs screen down-left. Grid north is up-right, grid west is up-left.
- Projection for a standard room canvas: `screen = (480 + 32(x - y), 260 + 16(x + y))`, with `(x, y)` in room tiles.

## Sprites

### Cells

A cell is 92 x 92 px. The lowest pixel of the figure's feet is on row 68 (rows count from 0), and the figure is centered
on column 46. Figures are 40 to 44 px tall and slender: the head takes the top quarter, with long narrow legs. They are
not chibi. One dark outline, at most 32 opaque colors per sheet, alpha only 0 or 255, no ground shadow, no props unless
the pose calls for one.

### Sheets

Each sheet is eight columns wide. `templates/sheet-a.png`, `sheet-b.png` and `sheet-c.png` are empty grids: a red line on
the feet row, a blue line on the center column, a diagonal across spare cells. `templates/sheet-layouts.json` names every
cell.

**Sheet A, 736 x 460, 40 cells**

| Cells | Contents |
|---|---|
| 0-7 | Standing: `rot` south, south-west, west, north-west, north, north-east, east, south-east |
| 8-11, 12-15 | `walk_south` 1-4, `walk_west` 1-4 |
| 16-19, 20-23 | `walk_north` 1-4, `walk_east` 1-4 |
| 24-27 | `sit` south, west, north, east |
| 28-29, 30-31 | `type_north` 1-2 (seated from behind), `gesture_south` 1-2 (hand up, talking) |
| 32-35 | `blink_south`, `charging_north` (straight, eyes dim, a small cyan dot), `waiting_south` (arms crossed), `blocked_south` (raised stop hand) |
| 36-37 | Empty |
| 38-39 | `head_south`, `head_east`: the head only at 2x, about 24 x 26 px, for name plates |

**Sheet B, 736 x 276, 24 cells**

| Cells | Contents |
|---|---|
| 0-3 | `walk_north-east` 1-4: exact copy of `walk_east` |
| 4-7 | `walk_north-west` 1-4: exact copy of `walk_north` |
| 8-11 | `walk_south-east` 1-4: exact copy of `walk_south` |
| 12-15 | `walk_south-west` 1-4: exact copy of `walk_west` |
| 16-21 | `type_south`, `type_east`, `type_west`, two frames each |
| 22-23 | Empty |

**Sheet C, 736 x 552, 48 cells**

| Cells | Contents |
|---|---|
| 0-7 | `carry` south, west, north, east (arms forward, hands empty; the page draws the item); `drink` south, east; `read_south` 1-2 |
| 8-15 | `bench_east` 1-4, `bench_west` 1-4 (standing tool swing, no bench drawn) |
| 16-23 | `reach_south` 1-2 (fixing an overhead lamp), `lean_north` 1-2 (over a table), `point_north` 1-2, `stretch_south` 1-2 |
| 24-31 | `sit` north-east, north-west, south-east, south-west; `read_south-east` 1-2; `type_south-east` 1-2 |
| 32-39 | `type_north-east`, `type_north-west`, `type_south-west`, two frames each; `carry` south-east, south-west |
| 40-47 | `carry` north-east, north-west; `drink` north-east, south-west; `read_south-west` 1-2; two empty cells |

The page packs these into one atlas per member plus `assets/sprites/atlas.json`, with one list of cell positions per
track. A new member's minimum is `rot_*`, `walk_*`, `sit_*` and `type_*`. A missing track falls back to a nearby one,
in the order set by `resolve()` in `js/sprites.js`.

### Directions

Track names and screen directions are different things. This is the most common way to get sprites wrong.

- The plain walk tracks mean what they say on screen: `walk_south` walks toward the viewer, `walk_north` away,
  `walk_west` screen left, `walk_east` screen right.
- The diagonal walk names are what the page asks for when a figure follows a grid axis, but the art in them is one of
  the four screen directions above:

| Heading on the grid | Track the page plays | Art in that track |
|---|---|---|
| Grid north (screen up-right) | `walk_north-east` | Facing screen right |
| Grid west (screen up-left) | `walk_north-west` | Facing up, back to the viewer |
| Grid east (screen down-right) | `walk_south-east` | Facing down, toward the viewer |
| Grid south (screen down-left) | `walk_south-west` | Facing screen left |

- Do not draw new diagonal walks. New sprite work covers the four screen directions. Diagonal stills and action poses are kept
  as drawn.
- West and east walks are strict side profiles: one eye visible, nose or visor pointing the way of travel, all four frames
  the same way. Check each frame, as a mirrored frame is an easy mistake to miss at this size.

### Proportions

- Template cells set placement and pose. They do not set a character's width. Do not fit each cell to a target outline:
  the figure stretches and squeezes as its arms and legs move.
- Keep head and torso the same size through a walk cycle in one facing. The whole silhouette may change; the body may not.
- Compare the standing cell and all four walk frames side by side. Measure body landmarks, not the outer extent of the
  spread limbs.
- If a width has to be fixed, scale x only, by one factor for the whole pose, with nearest-neighbor sampling. Lost detail
  does not come back from widening a small raster, so fix this early.
- Do not build limbs by hand from parts unless you can match the drawn style. Assembled limbs read as a style change, even
  when every measurement passes.

### Sprite export order

1. Generate or draw A. Cut cells, set alpha at 128 to 0 or 255, remove stray specks under about 25 px, align feet to row 68.
2. Reduce to 32 colors without dithering. Fix any mirrored frames. Correct walk widths.
3. Build B: copy the four finished A walks into cells 0-15, in the order right, up, down, left. Add typing.
4. Build C from A's palette. Do not rebuild finished action art from A afterward; each sheet keeps its own finished cells.
5. Run `tools/sheets.py check`, then look at it animated in the page.

## Crew identity

Each member has up to six 312 x 339 stills, front-facing busts at a desk, in `crew-refs/`. They set head, colors,
markings and accessories. Sprites keep the character and drop the desk props.

| State | What the still shows |
|---|---|
| `working` | Doing the member's job with its tool |
| `queued` | Hands folded on a closed book |
| `waiting-on-you` | Holding something out, a question mark above |
| `blocked` | A broken or forbidden object, a red warning triangle |
| `done-today` | Thumbs up, a check mark, gold sparkles |
| `sleeping` | Head on folded arms, Z letters above |

| Member | Look |
|---|---|
| Cobalt | Gold-amber helmet, wide visor with green eyes, silver arms, amber vest with straps. Draws plans. The sprite wears an orange hard hat and work vest |
| Onyx | Rounded grey-blue helmet, brass goggles with one cyan lens, white beard, antenna, silver-blue armor. Draws geometric diagrams |
| Agate | White and silver armor, green helmet crest and shoulders, black visor with green pixel eyes. Slim limbs, cheerful. Brass stopwatch |
| Basalt | Dark iron, flat-topped riveted head, orange rectangular eyes, thick bronze and charcoal armor, orange chest furnace window. Hammer and anvil |
| Garnet | Charcoal steel, copper ear discs, round brass goggles on top of the head, amber square eyes, leather apron with tool pockets. Files and vise |
| Topaz | Silver-white and cobalt-blue android, sculpted face, cyan eyes and no visor, blue forehead crest, small swept metal fins behind the shoulders. Precision parts |
| Zircon | Warm tan and brass, steel-grey hair quiff, black rectangular glasses, shirt-like armor, brown suspenders, dark trousers. Feather pen and ink |
| Mica | Brass-gold, square safe-door head, green visor brow, amber eyes, silver dial on the face, dark green straps. Thick record books |
| Quartz | Olive-grey armor, wrap visor with amber eyes, hazard-striped forehead band and shoulders, grille face, red forearms and gloves. Equipment case and cables |
| Pyrite | Silver-white, cyan seam lines, wide black visor outlined in cyan with tiny marks that are not readable. Shield and circuit boards |
| Olivine | Silver face, black glasses, ice-blue eyes, black swept head cap, two thin antennae, navy waistcoat and tie, small red cape. Stamp and folders |
| Obsidian | Olive-brown hood and short scarf, dark metal face, one central round amber lens, dark limbs. Laptop. In profile, the lens sits at the front rim of the hood |
| Drones | The stills show three; the sprite is one small helper. Mustard and ochre armor, olive helmet, orange-red visor, silver jaw, two silver ear fins, two antenna pins. A machine, not a cartoon creature |

Panel portraits are made from the stills: `<art>-<state>-1x.webp` and `-2x.webp`, 96 px wide at 1x.

## Rooms

### Shell and objects

A room is two layers, so figures can walk behind and in front of furniture.

- **Shell** (`assets/rooms/<key>.png`): floor, the tall north and west walls, low south and east rails, door frames, and
  whatever is mounted flat on a wall. Floor charging coils stay in the shell too.
- **Objects** (`assets/objects/<key>.png` and `.json`): every floor-standing thing as its own cropped sprite, with its
  cast shadow, in cells with a 4 px gap.

Shell rules:

- Canvas 1024 x 768, dock 1280 x 900. The shell is placed by translation only and never scaled. Transparent outside the room.
- Standard room: 10 x 8 tiles. Floor corners N(480,260), E(800,420), S(544,548), W(224,388).
- Paint on the room's guide. Walls are at least 96 px on the north and west edges; the guide's wall outline is a minimum,
  and a wall may go taller to keep a good painting whole. Rails are about 14 px.
- Doors are 2 tiles wide (the dock's is 3). A door gap is alpha 0: no black paint and no corridor painted in it. Keep
  the header and jambs. On a rail edge, a door is just a gap.
- The floor runs unbroken under everything, with no pits. Painted pixels are alpha 255.
- Nothing rises past the wall tops except roof ornaments above the north corner.
- No figures, parcels, mugs, loose crates or beds in the art, and no portrait frames on walls. The page draws those or
  does without them.
- Keep seat tiles empty, with the desk next to the seat as the guide shows. The guide's seat and desk tiles are a starting
  point. The page's `assets/placements.json` has the current ones.

Object JSON:

```json
{
  "room": "bridge",
  "shell": "../rooms/bridge.png",
  "sheet": "bridge.png",
  "objects": [
    { "name": "console desk", "cell": [0, 0, 80, 71], "origin": [534, 326], "footprint": [4, 1, 2, 2], "kind": "desk" }
  ]
}
```

- `cell`: rectangle in the sheet. `origin`: where the crop's top-left pixel sits on the room canvas.
- `footprint`: `[tx, ty, tw, th]` in room tiles, `(0,0)` being the room's north tile, `tx` along the north edge, `ty`
  along the west edge. Count on the guide.
- `kind`: `desk` for anything a member works at, `seatless` for the rest, `lowprofile` under 20 px tall (figures draw over it).
- One object per physical thing. Split anything over 4 tiles long into pieces of at most 3 tiles, each with its own footprint.

### Fitting a painting

- Move a painting onto the grid with one uniform transform and fit the floor beneath it. Do not warp walls and floor plane
  by plane: that shortens walls, shelves and door headers and loses what made the painting good.
- Floor slope and vertical wall posts are separate constraints. Check the north-west floor join, every wall post, the
  center seam and the rail openings at native pixels. Corner measurements alone do not prove the walls are right.
- A wall that drifted can be corrected on its own after the room's general export. Apply such corrections last, because
  rerunning the general export overwrites them.
- Crop neighboring objects' fragments before scaling an object. Keep its aspect ratio.
- Check by composing shell, sheet and JSON from the saved files, and overlay the guide at 100 %. Cyan should land on floor
  lines and red on open gaps, within 2 px.
- Then update the room's polygon in the page's `assets/floors.json` if the floor moved.

### The rooms

`guides/room-<key>.png` shows doors and seats for each. Two guides have no title line: `room-lounge` is the Garden and
`room-reactor` is the Core room. `guides/charging-pads-geometry.png` shows the ten pads in place.

| Key | Name, occupant | Floor | Signature and mood |
|---|---|---|---|
| `observatory` | Observatory, Onyx | Blue-grey with lit cyan seams | Telescope on a heavy mount, whiteboard of diagrams, window band with the planet. Quiet, lit by planet and screens |
| `bridge` | Bridge, Cobalt | Steel | Wall-wide main screen, console bank, inbox tray stand, dish mast above the roofline. Amber and blue, busiest light |
| `watch` | Watch, Pyrite | Steel | Wall of small screens with graphs, ticker display, red beacon on a post, coffee machine. Red and blue, a little paranoid |
| `library` | Library, Zircon and Mica | Worn wood planks | Tall shelves of boxes and binders on the west wall, reading sofa, green desk lamp, card catalog. Warm, the only soft light |
| `planning` | Planning, Agate | Steel | War table with a map, wall calendar and chart wall. Green status light, orderly |
| `records` | Records, Olivine | Worn wood | Vault door in the west wall, safe, archive boxes, brass lamp, filing cabinets. Dusty, amber |
| `lounge` | Garden, Obsidian | Soil beds and stone path | Raised planters under magenta grow lamps, small bar with coffee machine, couch facing south, drip pipes. The one living green place |
| `workshop` | Workshop, Basalt and Garnet; Drones | Rusted plate | Industrial machines the crew can use: drill bench, lathe, press, tool cabinet, parts shelves. Loud, dirty, crowded. Cover floor openings |
| `bench` | Bench, Topaz | Steel | One long workbench with vise and pegboard, small 3D printer rig, parts rack. Tidy, one bright work lamp |
| `charging` | Charging bay, none | Dark with a blue grid | Ten recessed rings with cyan coils and short cable posts at (1,2), (3,2), (5,2), (7,2), (9,2), (1,5), (3,5), (5,5), (7,5), (9,5); transformer on the west wall. Cold cyan |
| `reactor` | Core room, Quartz | Dark with a blue grid | Reactor column on a plinth squared to the grid, server racks with blinking lights, coolant tanks, warning stripes. Keep a 1-tile walkway around the core |
| `pad` | Landing pad, none | Plating with hazard stripes | No walls, low rail with gaps. Landing ring and markings, fuel reel, crane arm on the east edge. No shuttle in the art. Sodium orange |
| `dock` | Construction dock, none | Open girders over a dark pit | 10 x 30 tiles, canvas 1280 x 900, door in the west wall at y=8. Scaffold walls, gantry crane on the north edge. No modules or blocks in the art; the page stacks them |

Scale check for the dock: 10 x 30 at the native tile spans the full 1280 px, leaving no margin past the guide. Do not paint
it at a different tile size, as block positions must match.

## Halls and hull

Halls are 3 tiles wide. Draw from the guides, with the same materials as the rooms: low curb on both long edges, amber
post lamps every 2 tiles, worn yellow center stripe, grating and cable trays on one edge. No tall walls, figures or crates.

| File | Footprint | Canvas |
|---|---|---|
| `corridor-x`, `corridor-y` | 6 x 3 along x, 3 x 6 along y; repeats end to end | 640 x 400 |
| `corridor-cross` | 3 x 3, open on all sides, floor drain in the middle | 400 x 300 |
| `corridor-end-n/s/e/w` | 3 x 3, sealed bulkhead with a porthole on the named side | 400 x 300 |
| `hull-skirt-se`, `hull-skirt-sw` | 6 tiles long; the vertical face only, 48 px tall, below the floor edge | 640 x 300 |
| `hull-corner-n/s/e/w` | 1 tile. The south corner has a thruster nozzle; the north one is mostly hidden, a mast is enough | 200 x 200 |

Repeating pieces must have pixel-identical end profiles. A matching profile does not hide a texture change just inside
the join, so test several pieces placed together. T junctions are not used.

## Small pieces

**Blocks** (`assets/blocks/`). 64 x 48. Top face a diamond with corners (32,0), (64,16), (32,32), (0,16); two side faces 16 px
tall. One shared silhouette, one camera. Names: `block-hull`, `-hull-window`, `-girder` (holes transparent), `-vent`, `-roof`,
`-roof-done` (the same roof pixels plus a green beacon), `-crate`, `-ghost` (a wire outline at alpha 128, the one allowed
partial alpha). `hook.png` is 16 x 48: a cable with a side-view hook.

**Items** (`assets/props/items`). 160 x 112 atlas with a JSON of `{x, y, w, h, anchor}` frames. Ten 16 x 16 items on the top row:
`mug-full`, `mug-empty`, `book-closed`, `book-open`, `folder`, `small-crate`, `watering-can`, `wrench`, `hammer`, `parcel`.
Eleven 32 x 32 effects: `steam-puff-1..3`, `sparks-1..3`, `water-mist-1..3`, `page-flip-1..2`. Effects are hard pixel clusters too.

**Shuttle** (`assets/props/shuttle`). 1536 x 192, six 256 x 192 cells, contact point (128, 176), footprint 4 x 3 tiles: landed with
ramp down and door open, landed closed, engines lit, lifting with gear folded, in flight banked, in flight from behind at
about 70 %. Flames in frames 5 and 6 start from the same engine positions.

**Heroes** (`assets/heroes/`). Animated centerpieces: 16 frames in a 4 x 4 grid, with JSON frames and a shared floor anchor.

| Hero | Cell | Anchor |
|---|---|---|
| `reactor` | 448 x 608 | 224, 480 |
| `telescope` | 512 x 384 | 256, 316 |
| `globe` | 288 x 272 | 144, 216 |

Generating frames one at a time makes the fixed parts shimmer, and aligning them afterward does not cure it. Lock the
stationary pixels from one reference frame and animate only marked regions. Then check two things: zero changed stationary
pixels across frames, and static plus motion layers rebuild each frame exactly.

**Planet** (`assets/backdrop/planet.png`). 512 x 512, quarter-lit from the upper right, on transparent.

**Inbox tray** (`assets/furniture/`). 64 x 64: a parcel tray on a short stand with an amber lamp.

`style/set-pieces.png` shows objects at native size in this style. In reading order: holotable, console bank, fabricator,
reactor core, charging pad, bunk, planter bed, telescope, shuttle, dock module, finished dock module, inbox tray, crane
arm, planet. Bunks and dock modules are not used by the page. Its dock is built from the blocks in `assets/blocks/`.

## Objects the crew use

An idle figure may walk to a stand tile beside an object, face it and play an action. To make a new object usable, leave a
free tile beside it and add it to the table in `js/interactions.js`. Objects it does not know are furniture.

Ambient actions never claim real work. Keep props free of anything that looks like status or data.

## Prompt language

Prompts that gave good results, for an image model that accepts them. A prompt does not reproduce an image: keep the accepted
output itself, and record which script produced the final file.

Base for an isolated object:

> Gritty worn industrial pixel-art game sprite for a space station. Chunky square pixel clusters, hard stepped edges,
> limited dark charcoal, gunmetal and rust palette, amber lamps and cold blue screens, ordered dithering, no anti-aliasing,
> no soft gradients. True 2:1 isometric view: verticals vertical, floor-axis slope exactly 1:2, diamond floor footprint.
> Strong simple silhouette readable at small native size. Bolted built-in construction, worn seams, no large shadow blob.
> One object on real transparent alpha, no checkerboard, no background, no text, numerals, logos or watermark. Whole object
> visible, uncropped.

Painting a room on its guide:

> Paint image 1, a wireframe, in place. Keep its exact margins and canvas framing. Image 2 is a contents and style reference
> only; never copy its geometry. Floor corners N(480,260), E(800,420), S(544,548), W(224,388) on a 1024 x 768 canvas. 10 x 8
> tiles of 64 x 32, edge slopes +/-0.5. Walls 96 px, front rails 14 px. Red means open gaps. Green tiles stay empty; desks
> sit on the yellow tiles. No portraits, characters, parcels, text, guide markings, bloom, smoke or sparks. Gunmetal and rust,
> rivets and dither, amber fixtures, blue screens, hard edges, transparent outside the room. Remove the guide. [Room contents.]

A sprite sheet:

> Create a pixel-art character sprite sheet, exactly 8 columns by 5 rows of equal cells. Image 1 is the empty layout. Image 2
> shows the character's identity. Slender humanoid about 40 px tall in a 92 px cell, head only the top quarter of the figure,
> long narrow legs, not chibi. One dark outline, limited palette, hard edges. Feet end on row 68, centered on column 46, in
> every body cell. No shadow, labels, text or grid lines. Real transparent background. [Row list from this guide.] [Character
> description, naming props to leave out.] West and east walks are strict side profiles.

Say what to leave out by name. Props in the portraits, such as a hammer or a stopwatch, otherwise end up on the sprite.

## Rules for finishing work

- Replace a file with one of the same name and pixel size, and nothing else changes. If a sheet's layout changes, update its JSON.
- Keep PNG and WebP free of metadata: `tools/sheets.py strip` for PNG.
- A preview is not delivery. The page reads the saved file, so reopen what you saved and build previews from it.
- Keep source images and a record of how each output was made.
- A script named check, verify or validate may still write files. Run older scripts on a copy.
- A checker's result goes stale when files change. A report should say what was tested, on which files.
- Numbers are evidence, not taste. A sheet can pass every measurement and still look wrong. Look at it in the page, and do not
  call work finished because it measured well.
