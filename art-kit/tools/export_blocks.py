"""Register generated block artwork to a shared tiny pixel silhouette."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,numpy as np
HERE=Path(__file__).resolve().parent;OUT=HERE.parent/'out/blocks';OUT.mkdir(parents=True,exist_ok=True)
# Put your generated image for each block at tools/sources/<name>.png. None ship with the kit.
records=json.loads((HERE/'blocks-prompts.json').read_text())
top=[(32,0),(64,16),(32,32),(0,16)]
left=[(0,16),(32,32),(32,48),(0,32)]
right=[(32,32),(64,16),(64,32),(32,48)]
def line(d,pts,color,width=1):d.line(pts,fill=color,width=width)
def edge(im):
 d=ImageDraw.Draw(im)
 line(d,[(0,16),(32,0),(63,16)],(116,112,93,255))
 line(d,[(0,16),(32,32),(63,16)],(92,90,77,255))
 line(d,[(0,17),(0,31),(32,47),(63,32),(63,17)],(19,24,27,255))
 line(d,[(32,32),(32,46)],(35,40,43,255))
def norm(path,size,name):
 im=Image.open(path).convert('RGBA');a=np.array(im);a[:,:,3]=np.where(a[:,:,3]>127,255,0);im=Image.fromarray(a)
 im=im.crop(im.getbbox())
 if name not in ('hook','block-ghost','block-roof-done'):
  depth={'block-hull':32,'block-hull-window':26,'block-girder':24,'block-vent':27,'block-roof':32,'block-crate':26}[name]
  src=np.array(im);dest=np.zeros((48,64,4),dtype=np.uint8)
  faces=[([(32,0),(64,16),(0,16)],[(32,0),(64,depth/2),(0,depth/2)]),
         ([(0,16),(32,32),(0,32)],[(0,depth/2),(32,depth),(0,48-depth/2)]),
         ([(32,32),(64,16),(32,48)],[(32,depth),(64,depth/2),(32,48)])]
  for target,source in faces:
   a,b,c=np.array(target,float);sa,sb,sc=np.array(source,float)
   inv=np.linalg.inv(np.column_stack((b-a,c-a)))
   for yy in range(48):
    for xx in range(64):
     u,v=inv@([xx,yy]-a)
     if 0<=u<=1 and 0<=v<=1:
      q=sa+u*(sb-sa)+v*(sc-sa)
      sx=min(im.width-1,max(0,round(q[0]*(im.width-1)/64)))
      sy=min(im.height-1,max(0,round(q[1]*(im.height-1)/48)))
      dest[yy,xx]=src[sy,sx]
  im=Image.fromarray(dest)
 else:im=im.resize(size,Image.Resampling.NEAREST)
 rgb=im.convert('RGB').quantize(colors=28,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGBA');rgb.putalpha(im.getchannel('A'))
 original=np.array(im);result=np.array(rgb)
 amber=(original[:,:,0]>150)&(original[:,:,1]>80)&(original[:,:,2]<original[:,:,1]*.65)&(original[:,:,3]>0)
 result[amber,:3]=(239,155,28)
 bright=amber&(original[:,:,0]>225)&(original[:,:,1]>165)
 result[bright,:3]=(255,215,91)
 return Image.fromarray(result)
for record in records:
 name=record['name'];size=(16,48) if name=='hook' else (64,48)
 im=norm(HERE/'sources'/f'{name}.png',size,name)
 if name not in ('hook','block-girder','block-ghost'):
  mask=Image.new('L',size);md=ImageDraw.Draw(mask)
  for face in (top,left,right):md.polygon(face,fill=255)
  base=Image.new('RGBA',size);bd=ImageDraw.Draw(base)
  for face,c in zip((top,left,right),((65,68,67),(42,46,47),(29,34,37))):bd.polygon(face,fill=c+(255,))
  base.alpha_composite(im);base.putalpha(mask);im=base;edge(im)
 if name=='block-ghost':
  im=Image.new('RGBA',size);d=ImageDraw.Draw(im)
  for pts in (top+[top[0]],[(0,16),(0,32),(32,48),(64,32),(64,16)],[(32,32),(32,48)]):
   line(d,[(min(63,x),min(47,y)) for x,y in pts],(78,182,246,128))
 if name=='block-hull-window':
  d=ImageDraw.Draw(im)
  for pts in ([(10,24),(22,30),(22,36),(10,30)],[(42,29),(54,23),(54,29),(42,35)]):
   d.polygon(pts,fill=(21,25,25,255))
  d.polygon([(12,26),(20,30),(20,33),(12,29)],fill=(235,143,21,255))
  d.line([(13,27),(19,30)],fill=(255,216,88,255))
  d.polygon([(44,29),(52,25),(52,28),(44,32)],fill=(235,143,21,255))
  d.line([(45,29),(51,26)],fill=(255,216,88,255))
 if name=='block-roof':
  d=ImageDraw.Draw(im)
  for pts in ([(29,6),(32,4),(35,6)],[(11,14),(7,16),(11,18)],[(53,14),(57,16),(53,18)],[(29,26),(32,28),(35,26)]):
   d.line(pts,fill=(237,155,31,255),width=1)
  for xy in ((32,5),(8,16),(56,16),(32,27)):d.point(xy,fill=(255,217,100,255))
 if name=='block-roof-done':
  # Identical underlying roof, with a compact beacon inside the same silhouette.
  roof=OUT/'block-roof.png'
  if roof.exists():im=Image.open(roof).convert('RGBA')
  d=ImageDraw.Draw(im);d.polygon([(27,14),(32,12),(37,14),(32,17)],fill=(20,27,28,255))
  d.rectangle((30,9,34,14),fill=(26,84,52,255));d.rectangle((31,9,33,12),fill=(66,203,109,255));d.point((31,9),fill=(159,241,165,255))
 im.save(OUT/f'{name}.png')
checks=[]
for r in records:
 im=Image.open(OUT/(r['name']+'.png')).convert('RGBA');a=np.array(im.getchannel('A'))
 expected=(16,48) if r['name']=='hook' else (64,48)
 assert im.size==expected
 assert set(np.unique(a)).issubset({0,128} if r['name']=='block-ghost' else {0,255})
 assert (a==0).any()
 checks.append({'file':r['name']+'.png','size':im.size,'alphaValues':[int(v) for v in np.unique(a)]})
(OUT/'validation.json').write_text(json.dumps(checks,indent=2))
sheet=Image.new('RGB',(840,690),(25,30,36));d=ImageDraw.Draw(sheet)
for i,r in enumerate(records):
 x=(i%3)*280;y=(i//3)*230
 im=Image.open(OUT/(r['name']+'.png')).convert('RGBA');im=im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST)
 sheet.paste(im,(x+(280-im.width)//2,y+10),im);d.text((x+12,y+210),r['name'],fill=(212,219,222))
sheet.save(OUT/'blocks-review.png')
print('Saved and validated nine assets.')
