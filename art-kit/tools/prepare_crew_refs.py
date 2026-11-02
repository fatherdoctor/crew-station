"""Contact sheets of each member's portrait stills, to attach as an identity reference. Needs Pillow."""
from pathlib import Path
from PIL import Image

KIT = Path(__file__).resolve().parent.parent
OUT = KIT / 'out' / 'crew-ref-sheets'
OUT.mkdir(parents=True, exist_ok=True)
members = sorted(p.name for p in (KIT / 'crew-refs').iterdir() if p.is_dir())
for member in members:
    refs = sorted((KIT / 'crew-refs' / member).glob('*.png'))
    sheet = Image.new('RGBA', (936, 678))
    for i, p in enumerate(refs):
        im = Image.open(p).convert('RGBA')
        im.thumbnail((312, 339), Image.Resampling.LANCZOS)
        sheet.alpha_composite(im, ((i % 3) * 312, (i // 3) * 339))
    sheet.save(OUT / f'{member}-references.png')
print('Prepared reference sheets for', ', '.join(members))
