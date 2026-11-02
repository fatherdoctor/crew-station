from pathlib import Path
import json
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent;O=HERE.parent/'out/props';O.mkdir(parents=True,exist_ok=True)
# Put your generated 5 x 5 atlas at tools/sources/items-source.png. None ships with the kit.
src=HERE/'sources/items-source.png';im=Image.open(src).convert('RGBA')
names=['mug-full','mug-empty','book-closed','book-open','folder','small-crate','watering-can','wrench','hammer','parcel','steam-puff-1','steam-puff-2','steam-puff-3','sparks-1','sparks-2','sparks-3','water-mist-1','water-mist-2','water-mist-3','page-flip-1','page-flip-2']
sprites=[]
for i in range(21):
    row,col=divmod(i,5);c=im.crop((round(col*im.width/5),round(row*im.height/5),round((col+1)*im.width/5),round((row+1)*im.height/5)))
    a=np.array(c);a[:,:,3]=np.where(a[:,:,3]>=128,255,0);a[a[:,:,3]==0,:3]=0;c=Image.fromarray(a);assert c.getbbox();sprites.append(c.crop(c.getbbox()))
out=Image.new('RGBA',(160,112));rects={}
effect_scale=30/max(max(s.size) for s in sprites[10:])
for i,(name,s) in enumerate(zip(names,sprites)):
    size=16 if i<10 else 32
    scale=14/max(s.size) if i<10 else effect_scale
    s=s.resize((max(1,round(s.width*scale)),max(1,round(s.height*scale))),Image.Resampling.NEAREST)
    x=i*16 if i<10 else ((i-10)%5)*32;y=0 if i<10 else 16+((i-10)//5)*32
    px=x+(size-s.width)//2;py=y+(size-s.height)//2
    out.paste(s,(px,py));rects[name]={'x':x,'y':y,'w':size,'h':size,'anchor':[size//2,size//2]}
rgb=out.convert('RGB').quantize(colors=32,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).convert('RGB');rgb.putalpha(out.getchannel('A'));a=np.array(rgb);a[a[:,:,3]==0,:3]=0;out=Image.fromarray(a)
out.save(O/'items.png');out.resize((800,560),Image.Resampling.NEAREST).save(O/'items-review.png')
(O/'items.json').write_text(json.dumps({'image':'items.png','size':[160,112],'frames':rects},indent=2))
for f in rects.values():assert out.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h'])).getbbox()
(O/'validation.json').write_text(json.dumps({'size':[160,112],'props16x16':10,'effects32x32':11,'allFramesNonempty':True,'alpha':np.unique(a[:,:,3]).tolist(),'source':src.name},indent=2))
print('21 frames exported; 10 props16x16 and11 effects32x32, atlas160x112')
