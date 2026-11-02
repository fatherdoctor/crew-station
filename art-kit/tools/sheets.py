#!/usr/bin/env python3
"""Sprite sheet helper, standard library only.

  sheets.py template [outdir]          write blank A, B, C grids and sheet-layouts.json (default: ../templates)
  sheets.py check a|b|c FILE [FILE...] check a production sheet against its layout
  sheets.py atlas ATLAS.json           check an atlas and its images (assets/sprites/atlas.json)
  sheets.py strip FILE [FILE...]       remove every PNG chunk the page does not need, in place

Handles 8-bit, non-interlaced PNG. Exit code is 1 when a check fails.
"""
import json, struct, sys, zlib
from pathlib import Path

CELL, FEET, SIG = 92, 68, b'\x89PNG\r\n\x1a\n'
KEEP = {b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND'}


def track(name, n=1):
    return [f'{name} {i + 1}' if n > 1 else name for i in range(n)]


def layout_a():
    cells = [f'rot_{d}' for d in 'south south-west west north-west north north-east east south-east'.split()]
    for d in 'south west north east'.split():
        cells += track(f'walk_{d}', 4)
    cells += [f'sit_{d}' for d in 'south west north east'.split()]
    cells += track('type_north', 2) + track('gesture_south', 2)
    cells += ['blink_south', 'charging_north', 'waiting_south', 'blocked_south', None, None, 'head_south', 'head_east']
    return cells


def layout_b():
    cells = []
    for d in 'north-east north-west south-east south-west'.split():
        cells += track(f'walk_{d}', 4)
    for d in 'south east west'.split():
        cells += track(f'type_{d}', 2)
    return cells + [None, None]


def layout_c():
    cells = [f'carry_{d}' for d in 'south west north east'.split()]
    cells += ['drink_south', 'drink_east'] + track('read_south', 2)
    cells += track('bench_east', 4) + track('bench_west', 4)
    for t in 'reach_south lean_north point_north stretch_south'.split():
        cells += track(t, 2)
    cells += [f'sit_{d}' for d in 'north-east north-west south-east south-west'.split()]
    cells += track('read_south-east', 2) + track('type_south-east', 2)
    for d in 'north-east north-west south-west'.split():
        cells += track(f'type_{d}', 2)
    cells += [f'carry_{d}' for d in 'south-east south-west north-east north-west'.split()]
    cells += ['drink_north-east', 'drink_south-west'] + track('read_south-west', 2)
    return cells + [None, None]


LAYOUTS = {'a': layout_a(), 'b': layout_b(), 'c': layout_c()}


def chunks(data):
    if data[:8] != SIG:
        raise ValueError('not a PNG')
    i = 8
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]
        yield data[i + 4:i + 8], data[i + 8:i + 8 + n]
        i += 12 + n


def make_chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)


def read_alpha(path):
    """Return width, height, alpha rows, and the names of any extra chunks."""
    idat, plte_alpha, extra = [], None, []
    for kind, body in chunks(Path(path).read_bytes()):
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'tRNS':
            plte_alpha = body
        elif kind not in KEEP:
            extra.append(kind.decode('latin-1'))
    if depth != 8 or interlace:
        raise ValueError(f'{path}: only 8-bit non-interlaced PNG is handled')
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw, stride, pos = zlib.decompress(b''.join(idat)), w * ch, 0
    prev, rows = bytearray(stride), []
    for _ in range(h):
        f, line = raw[pos], bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if ctype == 6:
            rows.append(bytes(line[3::4]))
        elif ctype == 4:
            rows.append(bytes(line[1::2]))
        elif ctype == 3 and plte_alpha:
            rows.append(bytes(plte_alpha[k] if k < len(plte_alpha) else 255 for k in line))
        else:
            rows.append(bytes([255]) * w)
    return w, h, rows, extra


def cell_bottom(rows, x0, y0):
    bottom = None
    for y in range(CELL):
        if any(rows[y0 + y][x0:x0 + CELL]):
            bottom = y
    return bottom


def check_common(path, rows, extra):
    problems = []
    levels = set(b''.join(rows))
    if not levels <= {0, 255}:
        problems.append(f'{path}: partial alpha values {sorted(levels - {0, 255})[:5]}')
    if extra:
        problems.append(f'{path}: extra chunks {extra}')
    return problems


def check_sheet(kind, path):
    cells = LAYOUTS[kind]
    want = (8 * CELL, (len(cells) // 8) * CELL)
    w, h, rows, extra = read_alpha(path)
    if (w, h) != want:
        return [f'{path}: canvas {w} x {h}, expected {want[0]} x {want[1]}']
    problems = check_common(path, rows, extra)
    for i, name in enumerate(cells):
        bottom = cell_bottom(rows, (i % 8) * CELL, (i // 8) * CELL)
        if name is None:
            if bottom is not None:
                problems.append(f'{path}: spare cell {i} is not empty')
        elif bottom is None:
            problems.append(f'{path}: cell {i} ({name}) is empty')
        elif not name.startswith('head_') and bottom != FEET:
            problems.append(f'{path}: cell {i} ({name}) has feet on row {bottom}')
    return problems


def check_atlas(path):
    atlas = json.loads(Path(path).read_text())
    problems = []
    if atlas.get('frame') != CELL:
        problems.append(f'{path}: frame is {atlas.get("frame")}, expected {CELL}')
    frames = 0
    for skin, data in sorted(atlas['skins'].items()):
        image = Path(path).parent / data['image']
        w, h, rows, extra = read_alpha(image)
        problems += check_common(image, rows, extra)
        for name, track_frames in data['tracks'].items():
            for f in track_frames:
                frames += 1
                bottom = cell_bottom(rows, f['x'], f['y'])
                if bottom is None:
                    problems.append(f'{skin}: {name} has an empty frame')
                elif not name.startswith('head_') and bottom != FEET:
                    problems.append(f'{skin}: {name} has feet on row {bottom}')
    print(f'{len(atlas["skins"])} skins, {frames} frames checked')
    return problems


def write_template(kind, outdir):
    """Grid lines, the feet row and the center column on a transparent canvas. No figures."""
    cells = LAYOUTS[kind]
    w, h = 8 * CELL, (len(cells) // 8) * CELL
    px = bytearray(w * h * 4)

    def put(x, y, rgba):
        px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(rgba)

    for i, name in enumerate(cells):
        x0, y0 = (i % 8) * CELL, (i // 8) * CELL
        for k in range(CELL):
            put(x0 + k, y0, (120, 120, 120, 255))
            put(x0, y0 + k, (120, 120, 120, 255))
            if name is None:
                put(x0 + k, y0 + k, (120, 120, 120, 255))
            elif not name.startswith('head_'):
                put(x0 + k, y0 + FEET, (255, 60, 60, 255))
                put(x0 + 46, y0 + k, (60, 200, 255, 255))
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * w * 4:(y + 1) * w * 4]
    data = SIG + make_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    data += make_chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + make_chunk(b'IEND', b'')
    (outdir / f'sheet-{kind}.png').write_bytes(data)


def main(argv):
    if len(argv) < 2 or argv[1] not in ('template', 'check', 'atlas', 'strip'):
        print(__doc__)
        return 2
    command = argv[1]
    if command == 'template':
        outdir = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parent.parent / 'templates'
        outdir.mkdir(parents=True, exist_ok=True)
        for kind in LAYOUTS:
            write_template(kind, outdir)
        table = {k: {'cell': CELL, 'feet_row': FEET, 'columns': 8, 'cells': v} for k, v in LAYOUTS.items()}
        (outdir / 'sheet-layouts.json').write_text(json.dumps(table, indent=1) + '\n')
        print('wrote', outdir)
        return 0
    if command == 'strip':
        for name in argv[2:]:
            data = Path(name).read_bytes()
            kept = SIG + b''.join(make_chunk(k, b) for k, b in chunks(data) if k in KEEP)
            Path(name).write_bytes(kept)
        return 0
    problems = check_atlas(argv[2]) if command == 'atlas' else [p for f in argv[3:] for p in check_sheet(argv[2], f)]
    for p in problems:
        print(p)
    print('FAIL' if problems else 'OK', f'({len(problems)} problems)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
