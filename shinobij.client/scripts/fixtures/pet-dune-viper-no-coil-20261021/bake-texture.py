import bpy,json,math,zlib,struct,binascii
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
root=Path(__file__).parent
print('BAKE load',flush=True)
g=json.loads((root/'geometry-slim-v7.json').read_text())
source=json.loads((root/'original-slim.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('Lean body UV');mesh.from_pydata(g['vertices'],[],g['faces']);mesh.update()
obj=bpy.data.objects.new('Lean body UV',mesh);bpy.context.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
uv=mesh.uv_layers.new(name='UVMap')
print('BAKE mesh',flush=True)
for face in mesh.polygons:
    face.select=face.center.y < -.08
    for k,li in enumerate(face.loop_indices):uv.data[li].uv=g['uv'][face.index][k]
print('BAKE unwrap',flush=True)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012,area_weight=.3);bpy.ops.object.mode_set(mode='OBJECT')
uv=mesh.uv_layers.active
print('BAKE image',flush=True)
print('BAKE topology',sum(tuple(p.vertices)!=tuple(g['faces'][p.index]) for p in mesh.polygons),flush=True)
pixels=np.frombuffer((root/'original-texture.rgba').read_bytes(),dtype=np.uint8).reshape(2048,2048,4).astype(np.float32)/255
print('BAKE pixels',flush=True)
def sample(u,v):
    x=max(0,min(2047,u*2048-.5));y=max(0,min(2047,v*2048-.5))
    x0=int(x);y0=int(y);x1=min(x0+1,2047);y1=min(y0+1,2047);a=x-x0;b=y-y0
    return (pixels[y0,x0,:3]*(1-a)+pixels[y0,x1,:3]*a)*(1-b)+(pixels[y1,x0,:3]*(1-a)+pixels[y1,x1,:3]*a)*b
bvh=BVHTree.FromPolygons([Vector(p) for p in source['vertices']],source['faces'],all_triangles=True)
print('BAKE bvh',flush=True)
def smooth(a,b,x):
    u=max(0,min(1,(x-a)/(b-a)));return u*u*(3-2*u)
def color(p):
    x,y,z=p
    original_weight=max(smooth(-.30,-.12,y),1-smooth(-.44,-.39,y))
    gold=sample(.49+.06*math.sin((z+.1)*9),.3525+.0125*math.cos(x*18+(y+.29)*22))
    if original_weight<=0:return gold
    hit,normal,fi,distance=bvh.find_nearest(p);tri=source['faces'][fi];a,b,c=[Vector(source['vertices'][i]) for i in tri]
    weights=barycentric_transform(hit,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
    coord=sum((Vector(source['uv'][tri[k]])*weights[k] for k in range(3)),Vector((0,0)))
    return gold*(1-original_weight)+sample(*coord)*original_weight
size=1024;atlas=np.zeros((size,size,3),dtype=np.float32);mask=np.zeros((size,size),dtype=bool)
count=0
print('BAKE raster',flush=True)
for face in mesh.polygons:
    if face.center.y>=-.08:
        for k,li in enumerate(face.loop_indices):g['uv'][face.index][k][0]*=.5
        continue
    points=[Vector(g['vertices'][v]) for v in face.vertices]
    coords=[np.array(uv.data[li].uv[:])*size for li in face.loop_indices]
    a,b,c=coords;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)>1e-9:
        for py in range(max(0,int(min(p[1] for p in coords))),min(size,int(max(p[1] for p in coords))+1)):
            for px in range(max(0,int(min(p[0] for p in coords))),min(size,int(max(p[0] for p in coords))+1)):
                x=px+.5;y=py+.5
                w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
                w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w2=1-w0-w1
                if min(w0,w1,w2)<-.00001:continue
                atlas[py,px]=color(points[0]*w0+points[1]*w1+points[2]*w2);mask[py,px]=True;count+=1
    g['uv'][face.index]=[[float(coord[0]/size*.5+.5),float(coord[1]/size)] for coord in coords]
for iteration in range(10):
    values=np.zeros_like(atlas);weights=np.zeros_like(mask,dtype=np.float32)
    for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
        valid=np.roll(mask,(dy,dx),(0,1));values+=np.roll(atlas,(dy,dx),(0,1))*valid[:,:,None];weights+=valid
    add=(~mask)&(weights>0);atlas[add]=values[add]/weights[add,None];mask[add]=True
raw=(np.clip(atlas,0,1)*255+.5).astype(np.uint8)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+row.tobytes() for row in raw),6))+chunk(b'IEND',b'')
(root/'baked-lean-body.png').write_bytes(png)
(root/'geometry-slim-v9.json').write_text(json.dumps(g))
print(json.dumps({'status':'UNAPPROVED-TEXTURE-BAKE','samples':count,'bodyTile':size}))
