"""Draw a stocky animal's continuous painted legs on joint-bound Blender meshes."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector


def paint_material(first, second, weight):
    material = bpy.data.materials.new('Painted skin')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()

    def texture(path):
        node = nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(str(path), check_existing=True)
        node.extension = 'CLIP'
        return node
    tex = texture(first)
    color, alpha = tex.outputs['Color'], tex.outputs['Alpha']
    if weight:
        other = texture(second)
        def blend(a,b):
            mix = nodes.new('ShaderNodeMixRGB')
            mix.inputs[0].default_value = weight
            links.new(a,mix.inputs[1])
            links.new(b,mix.inputs[2])
            return mix.outputs[0]
        color = blend(color,other.outputs['Color'])
        alpha = blend(alpha,other.outputs['Alpha'])
    ink = nodes.new('ShaderNodeEmission')
    links.new(color,ink.inputs['Color'])
    cutout = nodes.new('ShaderNodeMixShader')
    links.new(alpha,cutout.inputs[0])
    links.new(nodes.new('ShaderNodeBsdfTransparent').outputs[0],cutout.inputs[1])
    links.new(ink.outputs[0],cutout.inputs[2])
    links.new(cutout.outputs[0],nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    return material


def painted_leg(folder, row, side, right, depth, ground):
    """Pose one continuous cutout. Its ankle bends into the painted foot; the sole follows the contact."""
    pose = row['pose']
    hip,knee,ankle = (Vector(pose[bone+'_'+side]) for bone in ('thigh','calf','foot'))
    dx,dy = row['offsets'][side]
    shift = right*(dx/row['metricPixels']) + Vector((0,0,-dy/row['metricPixels']))
    hip,knee,ankle = (v+shift for v in (hip,knee,ankle))
    pitch = row['feet'][side]['pitch']
    roll = Matrix.Rotation(-pitch,3,'X')
    height = row['bindFootHeight'][side]
    # Carry the foot with the ball through toe-off. Derive the sole's height
    # from this skeleton's bind frame rather than a fixed toe thickness.
    contact = Vector(pose['ball_'+side])+shift + roll @ Vector((0,0,-row['stockyToeHeight'][side]))
    # The painted foot begins above the joint. This gives a broad instep and a short shin.
    instep = ankle.lerp(knee, .25)
    front_lean = -pitch*depth.x
    foot_axis = Vector((math.cos(front_lean), math.sin(front_lean)))
    def project(p):
        return Vector((right.dot(p), -p.z-ground*depth.dot(p)))
    # The forward distance to the planted toe projects vertically in front/back
    # views. Keep that camera depth from stretching the claws or flattening the heel.
    drawn_height = project(contact).y-project(instep).y
    instep.z += height*1.8*math.cos(front_lean)-drawn_height
    thigh_vector = project(knee)-project(hip)
    shin_vector = project(instep)-project(knee)
    def across(v):
        # Cross-body width stays readable even when the knee swings toward the camera.
        a = max(-.65,min(.65, math.atan2(-v.x,max(.001,v.y))))
        return Vector((math.cos(a),math.sin(a)))
    thigh_axis, shin_axis = across(thigh_vector), across(shin_vector)
    source = row['sources'][side]
    other = row['sources'].get(side+'Next',source)
    weight = row.get('stockyBlend',0.)
    def coords(spec, v):
        left,top = spec['box'][:2]
        width,h = spec['size']
        y = top+v*h
        joints = spec['joints']
        anchors = [*joints,spec['sole']]
        seg = 0 if y<joints[1][1] else 1 if y<joints[2][1] else 2
        a,b = anchors[seg:seg+2]
        t = (y-a[1])/(b[1]-a[1])
        axis = a[0]+t*(b[0]-a[0])
        if seg == 0:
            center = hip.lerp(knee,t)
            orientation = thigh_axis.lerp(shin_axis, .5*max(0.,t)**3)
        elif seg == 1:
            center = knee.lerp(instep,t)
            orientation = thigh_axis.lerp(shin_axis,.5+.5*t).lerp(foot_axis,t**3)
        else:
            center = instep.lerp(contact,t)
            orientation = foot_axis
        return center,orientation.normalized(),left-axis,width

    def vertex_at(spec, u):
        center,orientation,left,width = spec
        offset = (left+u*width)*row['stockyFootScale']
        screen = orientation*(1.10*offset)
        return center+right*screen.x+Vector((0,0,-screen.y))

    vertices,uvs,faces = [],[],[]
    sections = 28
    for j in range(sections+1):
        v=j/sections
        spec_a=coords(source,v)
        spec_b=coords(other,v) if weight else spec_a
        for u in (0.,1.):
            vertex = vertex_at(spec_a,u)
            vertices.append(vertex.lerp(vertex_at(spec_b,u),weight) if weight else vertex)
            uvs.append((u,1.-v))
        if j:
            i=j*2
            faces.append((i-2,i-1,i+1,i))
    data=bpy.data.meshes.new(side+' painted leg')
    data.from_pydata(vertices,[],faces)
    data.update()
    obj=bpy.data.objects.new(data.name,data)
    bpy.context.scene.collection.objects.link(obj)
    uv=data.uv_layers.new(name='Leg painting')
    for loop in data.loops:
        uv.data[loop.index].uv=uvs[loop.vertex_index]
    obj.data.materials.append(paint_material(folder/source['file'],folder/other['file'],weight))
    return (hip,knee,ankle)


def main():
    folder=Path(sys.argv[sys.argv.index('--')+1]).resolve()
    records=json.loads((folder/'inputs.json').read_bytes())['records']
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=12
    scene.cycles.use_denoising=False
    scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage=400,600,100
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=True
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='None'
    bpy.ops.object.camera_add()
    camera=bpy.context.object
    camera.data.type='ORTHO'
    camera.data.sensor_fit='HORIZONTAL'
    scene.camera=camera
    receipt=[]
    for row in records:
        for obj in list(scene.objects):
            if obj.type=='MESH':
                mesh=obj.data
                bpy.data.objects.remove(obj,do_unlink=True)
                bpy.data.meshes.remove(mesh)
        for mat in list(bpy.data.materials):
            if not mat.users:
                bpy.data.materials.remove(mat)
        theta=row['view']*math.pi/4
        metric=row['metricPixels']
        right=Vector((math.cos(theta),-math.sin(theta),0))
        depth=Vector((math.sin(theta),math.cos(theta),0))
        ground=row['groundProjection']
        camera.location=-10*depth+Vector((0,0,10*ground))
        camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.ortho_scale=400/metric
        scene.render.pixel_aspect_x=math.sqrt(1+ground**2)
        scene.render.pixel_aspect_y=1
        pins=[]
        for side in ('r','l'):
            pins.extend(painted_leg(folder,row,side,right,depth,ground))
        bpy.context.view_layer.update()
        errors=[]
        for point in pins:
            p=world_to_camera_view(scene,camera,point)
            errors.append(math.hypot(p.x*400-(200+metric*right.dot(point)),
                                     (1-p.y)*600-(300-metric*(point.z+ground*depth.dot(point)))))
        if max(errors)>=.001:
            raise ValueError(('Bare leg projection mismatch',row['prefix'],max(errors)))
        target=folder/(row['prefix']+'-lower.png')
        scene.render.filepath=str(target)
        bpy.ops.render.render(write_still=True)
        receipt.append(dict(prefix=row['prefix'],projectionError=max(errors),file=target.name,
                            vertices=sum(len(o.data.vertices) for o in scene.objects if o.type=='MESH'),
                            sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    (folder/'render-receipt.json').write_text(json.dumps(dict(paintedSurfaces=True,records=receipt,
        source='Joint-bound stocky leg paintings',scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())))


if __name__=='__main__':
    main()
