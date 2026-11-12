"""Stage a lossless idle strip with one ground anchor for the entire loop."""
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

integration = Path(__file__).resolve().parents[1]
here = integration / '.ci-evidence/hollow-hound-frames'
client = integration / 'shinobij.client'
record = json.loads((here / 'encounter-idle.json').read_bytes())
digest = lambda data: hashlib.sha256(data).hexdigest()
expected_sources = {'pet-models/roster/mythic-4.glb','hollow-gate/hollow-hound-idle.webp'}
assert set(record['sources']) == expected_sources
for path, expected in record['sources'].items():
    assert digest((client / 'public' / path).read_bytes()) == expected
raw = (here / 'encounter-idle.png').read_bytes()
assert digest(raw) == record['sha256']
count, cols, size = (record[k] for k in ('count', 'cols', 'cell'))
assert (count, cols, size) == (24, 8, 144)
with Image.open(io.BytesIO(raw)) as atlas:
    cells = []
    for i in range(count):
        x, y = i % cols * size, i // cols * size
        cells.append(atlas.crop((x, y, x+size, y+size)).convert('RGBA'))
assert len(set(c.tobytes() for c in cells)) == count
# Shade under the four paws, projected through the south-east camera.
shadow = Image.new('RGBA',(size,size))
ImageDraw.Draw(shadow).ellipse((43,91,98,105),fill=(18,11,25,95))
shadow = shadow.rotate(-18,center=tuple(record['origin']),resample=Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(2))
cells = [Image.alpha_composite(shadow,c) for c in cells]
dest = integration / '.ci-evidence/sector-models/hollow-hound'
dest.mkdir(parents=True, exist_ok=True)
pin = {}
for mode,frames in [('still',cells[:1]),('idle',cells)]:
    stream = io.BytesIO()
    durations=[round((i+1)*record['period']*1000/count)-round(i*record['period']*1000/count) for i in range(count)]
    frames[0].save(stream, format='WEBP',save_all=len(frames)>1,append_images=frames[1:],
                   duration=durations,loop=0,lossless=True,method=6,exact=True)
    payload=stream.getvalue()
    assert len(payload)<256*1024
    with Image.open(io.BytesIO(payload)) as stored:
        assert stored.n_frames==len(frames)
        for i,frame in enumerate(frames):
            stored.seek(i)
            # Fully transparent RGB is immaterial to browser compositing.
            assert stored.convert('RGBa').tobytes()==frame.convert('RGBa').tobytes()
    filename=digest(payload)+'.webp'
    (dest/filename).write_bytes(payload)
    pin[mode]=filename
assert abs(record['origin'][0]/size-.5)<.0001 and abs(record['origin'][1]/size-.69)<.001
(client / 'src/data/hollow-hound-encounter.json').write_text(json.dumps(pin, indent=2)+'\n',encoding='utf-8')
print(f'{count} distinct verified poses, {len(payload)} animation bytes, {pin}')
