"""New authored Pebble sculpt. Private work, never an acceptance receipt.

Raw coordinates are game Y-up. Unified skin is voxel sculpted; accessories
remain separate surfaces with explicit attachment groups. A real UV atlas is
baked from procedural clay/cloth/stone materials, not a sampled skin pixel.
"""
import bpy, math, json, pathlib, sys
from mathutils import Vector

out = pathlib.Path(sys.argv[sys.argv.index('--')+1]).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=12
scene.cycles.use_denoising=True
scene.render.bake.margin=8
parts=[]

def material(name, color, variation=.10):
    m=bpy.data.materials.new(name); m.use_nodes=True
    ns=m.node_tree.nodes; ns.clear(); ls=m.node_tree.links
    output=ns.new('ShaderNodeOutputMaterial'); emit=ns.new('ShaderNodeEmission')
    noise=ns.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=9
    noise.inputs['Detail'].default_value=2; noise.inputs['Roughness'].default_value=.6
    ramp=ns.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=tuple(c*(1-variation) for c in color)+(1,)
    ramp.color_ramp.elements[1].color=tuple(min(1,c*(1+variation)) for c in color)+(1,)
    ls.new(noise.outputs['Fac'],ramp.inputs[0])
    ao=ns.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value=.10
    ao.samples=16
    mix=ns.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=.48
    ls.new(ramp.outputs['Color'],mix.inputs[1]); ls.new(ao.outputs['Color'],mix.inputs[2])
    ls.new(mix.outputs[0],emit.inputs['Color']); ls.new(emit.outputs[0],output.inputs['Surface'])
    return m

skin=material('Pebble moss jade skin',(.32,.45,.15))
blue=material('Woven indigo cloth',(.026,.10,.28),.16)
blue_edge=material('Cloth raised seams',(.05,.17,.38))
shell=material('Deep pebble shell seams',(.12,.17,.13))
stones=[material('Pebble scute '+str(i),c,.16) for i,c in enumerate([
    (.30,.36,.25),(.38,.39,.28),(.26,.34,.25),(.41,.40,.28),(.31,.38,.29)])]
belly=material('Warm limestone plastron',(.49,.38,.17),.10)
wrap=material('Weathered leather wraps',(.15,.095,.043),.14)
ivory=material('Eye ivory',(.88,.87,.63),.02)
iris=material('Amber olive iris',(.30,.21,.035),.02)
black=material('Pupil and mouth',(.012,.018,.012),0)
shine=material('Eye highlights',(.96,.99,.90),0)

def finish(obj, name, mat, group='skin'):
    obj.name=name
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.clear(); obj.data.materials.append(mat)
    vg=obj.vertex_groups.new(name=group); vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    for p in obj.data.polygons:p.use_smooth=True
    parts.append(obj); return obj

def ellipsoid(name, p, r, mat=skin, group='skin', seg=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=p)
    o=bpy.context.object; o.scale=r
    return finish(o,name,mat,group)

def tube(name, points, radius, mat, group='head'):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=1 if len(points)>30 else 6
    c.bevel_depth=radius; c.bevel_resolution=2; c.use_fill_caps=True
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for b,p in zip(s.bezier_points,points):b.co=p; b.handle_left_type='AUTO'; b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o=bpy.context.object
    for a in bpy.context.selected_objects:a.select_set(False)
    return finish(o,name,mat,group)

# Skull, muzzle, neck and body form a single sculpted skin surface.
ellipsoid('cranial mass',(0,.395,.155),(.505,.395,.455),seg=64,rings=48)
ellipsoid('rounded muzzle',(0,.15,.46),(.37,.215,.245),seg=48,rings=32)
ellipsoid('chin',(0,.025,.425),(.30,.13,.20))
ellipsoid('left cheek',(.29,.20,.40),(.19,.18,.18))
ellipsoid('right cheek',(-.29,.20,.40),(.19,.18,.18))
ellipsoid('neck',(0,-.005,.09),(.245,.29,.25))
ellipsoid('torso',(0,-.38,.015),(.395,.43,.275))
ellipsoid('hips',(0,-.62,.015),(.37,.22,.245))
for side,s in [('L',1),('R',-1)]:
    ellipsoid('shoulder '+side,(s*.385,-.10,.08),(.17,.18,.17))
    arm=ellipsoid('upper arm '+side,(s*.50,-.245,.11),(.135,.23,.145))
    arm.rotation_euler.z=s*-.20
    ellipsoid('forearm '+side,(s*.575,-.40,.17),(.14,.18,.15))
    ellipsoid('palm '+side,(s*.60,-.52,.20),(.145,.14,.135))
    for k in range(3):ellipsoid('finger '+side+str(k),(s*(.52+k*.067),-.565,.265),(.045,.072,.065),seg=16,rings=12)
    ellipsoid('thigh '+side,(s*.275,-.68,.02),(.175,.23,.185))
    ellipsoid('shin '+side,(s*.32,-.815,.075),(.15,.16,.16))
    ellipsoid('foot '+side,(s*.33,-.925,.155),(.175,.075,.235))
    for k in range(3):ellipsoid('toe '+side+str(k),(s*.33+(k-1)*.095,-.934,.33),(.055,.053,.08),seg=16,rings=12)

skin_parts=parts[:]
bpy.ops.object.select_all(action='DESELECT')
for o in skin_parts:o.select_set(True)
bpy.context.view_layer.objects.active=skin_parts[0]; bpy.ops.object.join()
body=bpy.context.object; body.name='Pebble continuous anatomical sculpt'
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
mod=body.modifiers.new('Union anatomical masses','REMESH'); mod.mode='VOXEL'; mod.voxel_size=.010; mod.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=body.modifiers.new('Sculpt relaxation','SMOOTH'); mod.factor=.65; mod.iterations=5
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=body.modifiers.new('Game topology','DECIMATE'); mod.ratio=.065
bpy.ops.object.modifier_apply(modifier=mod.name)
body.vertex_groups.clear(); v=body.vertex_groups.new(name='skin'); v.add(list(range(len(body.data.vertices))),1,'REPLACE')
for p in body.data.polygons:p.use_smooth=True
parts=[body]

# Ray-fitted eyes follow the actual sculpted skull tangent, rather than bulging
# forward as separate spheres. Position details on the relaxed skin surface.
def front_surface(x,y):
    inverse=body.matrix_world.inverted()
    hit,p,n,fi=body.ray_cast(inverse@Vector((x,y,2)),Vector((0,0,-1)))
    assert hit,(x,y)
    return body.matrix_world@p

for s in [-1,1]:
    tangent=Vector((s*math.sin(.48),0,math.cos(.48)))
    center=front_surface(s*.275,.398)
    eye=ellipsoid('eye white',center-tangent*.007,(.128,.162,.027),ivory,'head')
    eye.rotation_euler.y=s*.48
    for name,offset,r,mat,xy in [
        ('iris',.020,(.077,.114,.009),iris,(0,0)),
        ('pupil',.028,(.052,.091,.006),black,(0,0)),
        ('large catchlight',.034,(.019,.028,.004),shine,(-.019,.041)),
        ('small catchlight',.034,(.008,.011,.004),shine,(.022,-.035))]:
        p=center+tangent*offset+Vector((xy[0],xy[1],0))
        o=ellipsoid(name,p,r,mat,'head',20,14);o.rotation_euler.y=s*.48
    p=front_surface(s*.078,.224)+Vector((0,0,.004))
    ellipsoid('nostril',p,(.013,.010,.005),black,'head',12,8)
smile=[]
for x,y in [(-.215,.095),(-.125,.060),(0,.047),(.125,.060),(.215,.095)]:
    smile.append(front_surface(x,y)+Vector((0,0,.003)))
tube('gentle smile',smile,.0065,black)

# Tail is a tapered sculpt with its own skeletal attachment.
tail=ellipsoid('tail',(0,-.69,-.43),(.105,.095,.30),skin,'tail_1')
tail.rotation_euler.x=-.18

# Independently authored pebbled shell, low rounded stones with beveled seams.
ellipsoid('shell understructure',(0,-.31,-.285),(.48,.575,.285),shell,'shell',40,28)
tube('continuous shell rim',[(.468*math.sin(2*math.pi*i/96),-.31+.563*math.cos(2*math.pi*i/96),-.322) for i in range(97)],.024,stones[2],'shell')
def scute(name,cx,cy,rx,ry,material_index):
    points=[];fs=[]
    def surface(x,y,lift):
        q=max(.02,1-(x/.49)**2-((y+.31)/.59)**2)
        return (x,y,-.285-.285*math.sqrt(q)-lift)
    points.append(surface(cx,cy,.042))
    for ring,scale in enumerate([.55,1]):
        for i in range(12):
            # Beveled hex profile, alternating corner/edge points.
            a=math.pi/6+i*math.pi/6
            r=1 if i%2==0 else math.cos(math.pi/6)
            points.append(surface(cx+rx*math.cos(a)*scale*r,cy+ry*math.sin(a)*scale*r,.040 if ring==0 else .014))
    for i in range(12):
        a=1+i;b=1+(i+1)%12;fs.append((0,b,a));fs.append((a,b,b+12,a+12))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(points,[],fs); mesh.update()
    o=bpy.data.objects.new(name,mesh); scene.collection.objects.link(o); bpy.context.view_layer.objects.active=o
    o.select_set(True)
    sol=o.modifiers.new('Scute thickness','SOLIDIFY'); sol.thickness=.025
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bevel=o.modifiers.new('Worn rounded stone edges','BEVEL'); bevel.width=.012; bevel.segments=3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    o.select_set(False); finish(o,name,stones[material_index%len(stones)],'shell')
scute('central river pebble',0,-.30,.215,.23,0)
for i,(x,y,rx,ry) in enumerate([(-.255,-.28,.17,.205),(.255,-.28,.17,.205),(-.13,.045,.17,.155),(.13,.045,.17,.155),(-.14,-.64,.17,.16),(.14,-.64,.17,.16)]):scute('peripheral pebble '+str(i),x,y,rx,ry,i+1)

# Continuous plastron with incised seams, avoiding separate pillow-like abs.
ellipsoid('continuous belly plastron',(0,-.40,.255),(.30,.325,.065),belly,'torso',32,24)
for row in range(2):
    y=-.32-row*.17
    pts=[]
    for x in [-.235,-.12,0,.12,.235]:
        q=max(.01,1-(x/.30)**2-((y+.4)/.325)**2)
        pts.append((x,y,.255+.065*math.sqrt(q)+.001))
    tube('plastron shallow seam '+str(row),pts,.0055,wrap,'torso')
tube('plastron center seam',[(0,-.16,.300),(0,-.32,.319),(0,-.49,.318),(0,-.65,.295)],.004,wrap,'torso')
for s in [-1,1]:
    tube('shell strap '+str(s),[(s*.29,-.02,-.20),(s*.34,-.09,.03),(s*.29,-.20,.25),(s*.26,-.42,.28)],.030,wrap,'torso')
    ellipsoid('wrist wrap '+str(s),(s*.57,-.40,.17),(.148,.060,.155),wrap,'forearm'+('L' if s==1 else 'R'))
    ellipsoid('ankle wrap '+str(s),(s*.32,-.842,.08),(.155,.047,.165),wrap,'shin'+('L' if s==1 else 'R'))

# Cloth band follows the cranial ellipse; crown rises only modestly above it.
verts=[]; faces=[]; n=96; rows=5
for row in range(rows):
    t=row/(rows-1)
    for i in range(n):
        a=2*math.pi*i/n; y=.582+.032*math.cos(a)+(t-.5)*.123
        q=math.sqrt(max(.01,1-((y-.395)/.395)**2))
        # Cloth thickness/soft edge: always outside the skull.
        pad=.013+.006*math.sin(math.pi*t)
        verts.append((math.sin(a)*(.505*q+pad),y,.155+math.cos(a)*(.455*q+pad)))
for row in range(rows-1):
    for i in range(n):
        a=row*n+i; b=row*n+(i+1)%n; faces.append((a,b,b+n,a+n))
mesh=bpy.data.meshes.new('fitted cloth band'); mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('fitted indigo headband',mesh);scene.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True)
mod=o.modifiers.new('Cloth thickness','SOLIDIFY');mod.thickness=.008;bpy.ops.object.modifier_apply(modifier=mod.name)
o.select_set(False);finish(o,o.name,blue,'head')
for edge in [-1,1]:
    pts=[]
    for i in range(97):
        a=2*math.pi*i/96;y=.582+.032*math.cos(a)+edge*.056;q=math.sqrt(max(.01,1-((y-.395)/.395)**2))
        pts.append((math.sin(a)*(.505*q+.019),y,.155+math.cos(a)*(.455*q+.019)))
    tube('headband seam '+str(edge),pts,.004,blue_edge)
ellipsoid('tied headband knot',(0,.56,-.283),(.095,.075,.068),blue,'head')
for s in [-1,1]:
    tube('headband tied tail '+str(s),[(s*.04,.56,-.30),(s*.17,.55,-.39),(s*.29,.49,-.43),(s*.33,.46,-.48)],.033,blue)
# Triangular scarf, visibly cloth rather than a thick chest wedge.
tube('folded neckerchief collar',[(-.24,-.02,.10),(-.18,-.07,.28),(0,-.10,.32),(.18,-.07,.28),(.24,-.02,.10)],.026,blue,'torso')
mesh=bpy.data.meshes.new('scarf front');mesh.from_pydata([(-.24,-.015,.285),(0,-.29,.315),(.24,-.015,.285),(0,-.055,.334)],[],[(0,1,3),(1,2,3),(2,0,3)]);mesh.update()
o=bpy.data.objects.new('indigo neckerchief',mesh);scene.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True)
mod=o.modifiers.new('Soft scarf edge','SOLIDIFY');mod.thickness=.012;bpy.ops.object.modifier_apply(modifier=mod.name)
mod=o.modifiers.new('Scarf edge roll','BEVEL');mod.width=.012;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
o.select_set(False);finish(o,o.name,blue,'torso')

# Apply transforms, join, unwrap and bake the authored materials into one atlas.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Increase the head/body ratio for a juvenile tortoise silhouette. Smooth
    # falloff through the sculpted neck keeps its continuous topology intact.
    group_names={g.index:g.name for g in o.vertex_groups}
    for vertex in o.data.vertices:
        group=group_names.get(max(vertex.groups,key=lambda g:g.weight).group,'skin') if vertex.groups else 'skin'
        t=1 if group=='head' else (max(0,min(1,(vertex.co.y-.025)/.13)) if group=='skin' else 0)
        t=t*t*(3-2*t)
        vertex.co.x*=1+.10*t
        vertex.co.y=.025+(vertex.co.y-.025)*(1+.045*t)
        vertex.co.z=.18+(vertex.co.z-.18)*(1+.045*t)
bpy.context.view_layer.objects.active=body;bpy.ops.object.join();model=bpy.context.object
model.name='Pebble Tortoise remade sculpt PRIVATE'
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(65),island_margin=.008);bpy.ops.object.mode_set(mode='OBJECT')
image=bpy.data.images.new('Pebble authored diffuse atlas',width=1024,height=1024,alpha=False)
for mat in model.data.materials:
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;mat.node_tree.nodes.active=node
bpy.ops.wm.save_as_mainfile(filepath=str(out/'pebble-remade-sculpt-private.blend'))
print('SCULPT READY; baking real UV atlas',flush=True)
bpy.ops.object.bake(type='EMIT')
image.filepath_raw=str(out/'pebble-remade-atlas-private.png');image.file_format='PNG';image.save()
image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'pebble-remade-sculpt-private.blend'))
model.data.calc_loop_triangles()
uv=model.data.uv_layers.active.data
positions=[];normals=[];uvs=[];groups=[];indices=[];keys={}
for tri in model.data.loop_triangles:
    for li in tri.loops:
        loop=model.data.loops[li];vertex=model.data.vertices[loop.vertex_index]
        p=tuple(vertex.co);n=tuple(model.data.corner_normals[li].vector);t=tuple(uv[li].uv)
        group=max(vertex.groups,key=lambda g:g.weight).group if vertex.groups else 0
        gn=model.vertex_groups[group].name
        key=(loop.vertex_index,round(t[0],7),round(t[1],7))
        if key not in keys:
            keys[key]=len(groups);positions.extend(p);normals.extend(n);uvs.extend((t[0],1-t[1]));groups.append(gn)
        indices.append(keys[key])
report={'construction':'full new continuous anatomical sculpt; fitted accessories; new UV unwrap and baked material atlas','privateCandidateOnly':True,'positions':positions,'normals':normals,'uvs':uvs,'groups':groups,'indices':indices}
(out/'pebble-remade-mesh-private.json').write_text(json.dumps(report))
print(json.dumps({'vertices':len(groups),'triangles':len(indices)//3,'groups':sorted(set(groups))}),flush=True)
