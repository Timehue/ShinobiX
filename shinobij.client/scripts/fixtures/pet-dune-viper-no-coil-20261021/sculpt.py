import bpy,bmesh,json,math,sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
from pathlib import Path
root=Path(__file__).parent
data=json.loads((root/'original-slim.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def object_mesh(name,vertices,faces):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);return obj
original=object_mesh('Original-preserved-reference',data['vertices'],data['faces'])
original.hide_viewport=True;original.hide_render=True
body=object_mesh('Viper-new-continuous-tail',data['vertices'],data['faces'])
layer=body.data.uv_layers.new(name='UVMap')
for poly in body.data.polygons:
    for li,vi in zip(poly.loop_indices,poly.vertices):layer.data[li].uv=data['uv'][vi]
bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000002);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free()
def boolean(target,operand,op):
    bpy.context.view_layer.objects.active=target;mod=target.modifiers.new('Anatomical-'+op,'BOOLEAN');mod.operation=op;mod.solver='EXACT';mod.object=operand;bpy.ops.object.modifier_apply(modifier=mod.name)
def cube(name,lo,hi):
    bpy.ops.mesh.primitive_cube_add(size=1,location=tuple((a+b)/2 for a,b in zip(lo,hi)));obj=bpy.context.object;obj.name=name;obj.dimensions=tuple(b-a for a,b in zip(lo,hi));bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return obj
cut=cube('Remove malformed rear coil',(-.6,-.60,-.65),(.6,-.045,.65))
bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.21,depth=.40,location=(0,-.08,.25),rotation=(math.pi/2,0,0))
neck=bpy.context.object;bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);neck.scale.x=.75;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);boolean(cut,neck,'DIFFERENCE');bpy.data.objects.remove(neck,do_unlink=True)
for x,z,r,top in [(-.18,-.215,.15,-.39),(.185,-.205,.15,-.39),(-.175,.35,.12,-.34),(.165,.35,.12,-.34)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=top+.62,location=(x,(top-.62)/2,z),rotation=(math.pi/2,0,0))
    keep=bpy.context.object
    # Blender cylinders run along local Z; rotate to the vertical Y axis.
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    boolean(cut,keep,'DIFFERENCE');bpy.data.objects.remove(keep,do_unlink=True)
layer=cut.data.uv_layers.get('UVMap') or cut.data.uv_layers.new(name='UVMap')
for poly in cut.data.polygons:
    for li,vi in zip(poly.loop_indices,poly.vertices):
        p=cut.data.vertices[vi].co;wave=lambda x:1-abs((x%2)-1)
        layer.data[li].uv=(.43+.12*wave(p.x*10),.34+.035*wave(p.z*10))
boolean(body,cut,'DIFFERENCE');bpy.data.objects.remove(cut,do_unlink=True)
residue=cube('Remove obsolete central coil underside',(-.13,-.62,-.55),(.13,-.31,.18))
boolean(body,residue,'DIFFERENCE');bpy.data.objects.remove(residue,do_unlink=True)
controls=[(0,-.29,.24),(0,-.29,.08),(0,-.29,-.12),(0,-.29,-.30),(.005,-.295,-.41),(.02,-.30,-.53),(.04,-.30,-.66),(.04,-.285,-.76)]
radii=[.17,.145,.145,.145,.10,.06,.025,.0015]
vertical=[.65,.65,.65,.65,.7,.85,1,1]
def interp(values,t):
    i=min(len(values)-2,int(t*(len(values)-1)));u=t*(len(values)-1)-i
    p0=values[max(0,i-1)];p1=values[i];p2=values[i+1];p3=values[min(len(values)-1,i+2)]
    return .5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u)
cp=[Vector(p) for p in controls];vertices=[];faces=[];rings=128;sides=32
for i in range(rings+1):
    t=i/rings;p=interp(cp,t);tangent=(interp(cp,min(1,t+.0001))-interp(cp,max(0,t-.0001))).normalized();up=Vector((0,1,0));side=tangent.cross(up).normalized();up=side.cross(tangent).normalized()
    u=max(0,min(1,(-p.z-.20)/.58));s=6*u**5-15*u**4+10*u**3
    front=max(0,min(1,(p.z-.05)/.19));front=6*front**5-15*front**4+10*front**3
    r=(.145+.025*front)*(1-s)+.002*s;vertical_ratio=.65+.35*s
    for j in range(sides):
        angle=j/sides*2*math.pi;vertices.append(tuple(p+r*(math.cos(angle)*vertical_ratio*up+math.sin(angle)*side)))
for i in range(rings):
    for j in range(sides):
        a=i*sides+j;b=i*sides+(j+1)%sides;c=(i+1)*sides+(j+1)%sides;d=(i+1)*sides+j;faces.append((a,b,c,d))
faces.extend([tuple(reversed(range(sides))),tuple(rings*sides+j for j in range(sides))])
tube=object_mesh('Single tapering continuation',vertices,faces)
bvh=BVHTree.FromPolygons([Vector(p) for p in data['vertices']],data['faces'],all_triangles=True)
layer=tube.data.uv_layers.new(name='UVMap')
for poly in tube.data.polygons:
    for li,vi in zip(poly.loop_indices,poly.vertices):
        ring=vi//sides;around=vi%sides
        layer.data[li].uv=(.43+.12*ring/rings,.34+.025*(1-abs(2*around/sides-1)))
bm=bmesh.new();bm.from_mesh(tube.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(tube.data);bm.free()
diagnostic=tube.data.copy();bm=bmesh.new();bm.from_mesh(diagnostic);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(diagnostic);bm.free()
(root/'tube-only-diagnostic.json').write_text(json.dumps({'vertices':[tuple(v.co) for v in diagnostic.vertices],'faces':[tuple(p.vertices) for p in diagnostic.polygons],'uv':[[tuple(diagnostic.uv_layers.active.data[i].uv) for i in p.loop_indices] for p in diagnostic.polygons],'weights':[[[(1,1.0)] for v in p.vertices] for p in diagnostic.polygons]}))
boolean(body,tube,'UNION');bpy.data.objects.remove(tube,do_unlink=True)
for x,z in [(-.16,-.22),(.16,-.22),(-.145,.26),(.145,.26)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=(x,-.335,z))
    hip=bpy.context.object;hip.scale=(.055,.10,.06);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    layer=hip.data.uv_layers.get('UVMap') or hip.data.uv_layers.new(name='UVMap')
    for poly in hip.data.polygons:
        for li,vi in zip(poly.loop_indices,poly.vertices):
            p=hip.data.vertices[vi].co
            layer.data[li].uv=(.43+.12*(p.x/.2+.5),.34+.035*(p.y/.19+.5))
    boolean(body,hip,'UNION');bpy.data.objects.remove(hip,do_unlink=True)
bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
def smoothstep(lo,hi,x):
    u=max(0,min(1,(x-lo)/(hi-lo)));return u*u*(3-2*u)
for iteration in range(24):
    changes=[]
    for v in bm.verts:
        p=v.co;distance=min(math.hypot(p.x-x,p.z-z) for x,z in [(-.16,-.22),(.16,-.22),(-.145,.26),(.145,.26)])
        hip_strength=(1-smoothstep(.06,.17,distance))*smoothstep(-.45,-.40,p.y)*(1-smoothstep(-.20,-.15,p.y))
        trunk_strength=smoothstep(-.45,-.39,p.y)*(1-smoothstep(-.22,-.12,p.y))*(1-smoothstep(.20,.32,p.z))*smoothstep(-.75,-.60,p.z)
        strength=max(hip_strength,trunk_strength*.7)
        if strength>0 and v.link_edges:
            mean=sum((e.other_vert(v).co for e in v.link_edges),Vector())/len(v.link_edges);changes.append((v,p.lerp(mean,.45*strength)))
    for v,p in changes:v.co=p
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free();body.data.update()
bvh=BVHTree.FromPolygons([Vector(p) for p in data['vertices']],data['faces'],all_triangles=True)
out_vertices=[tuple(v.co) for v in body.data.vertices];out_faces=[];corner_uv=[];corner_weights=[]
for poly in body.data.polygons:
    out_faces.append(tuple(poly.vertices));uvs=[];weights=[]
    for li,vi in zip(poly.loop_indices,poly.vertices):
        p=body.data.vertices[vi].co;hit,normal,fi,distance=bvh.find_nearest(p);tri=data['faces'][fi];a,b,c=[Vector(data['vertices'][v]) for v in tri]
        bary=barycentric_transform(hit,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
        uvs.append(tuple(body.data.uv_layers.active.data[li].uv));values={}
        for k in range(3):
            for joint,w in data['weights'][tri[k]]:values[joint]=values.get(joint,0)+w*max(0,bary[k])
        top=sorted(values.items(),key=lambda x:x[1],reverse=True)[:4];total=sum(w for j,w in top);weights.append([(j,w/total) for j,w in top])
    corner_uv.append(uvs);corner_weights.append(weights)
(root/'geometry-slim-v7.json').write_text(json.dumps({'vertices':out_vertices,'faces':out_faces,'uv':corner_uv,'weights':corner_weights,'rigLegTranslations':data['rigLegTranslations']}))
bpy.ops.wm.save_as_mainfile(filepath=str(root/'sculpt-slim-v7.blend'))
print(json.dumps({'vertices':len(out_vertices),'triangles':len(out_faces),'status':'UNAPPROVED-REMESH-PROTOTYPE'}))
