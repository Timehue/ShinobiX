"""Fit a reviewed Raijin sculpt to the project's quadruped animation rig.

Run Blender with the existing quadruped .blend loaded, then pass
REDUCED.glb OUT.blend OUT.glb after --. Only writes candidate outputs.
"""
import bpy
import sys
from pathlib import Path

mesh_source, blend_out, glb_out = [Path(arg).resolve() for arg in sys.argv[sys.argv.index('--') + 1:][:3]]
rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
donor = next(obj for obj in bpy.data.objects if obj.type == 'MESH')
assert len(rig.data.bones) == 21
assert len(bpy.data.actions) >= 8

bpy.ops.import_scene.gltf(filepath=str(mesh_source))
targets = [obj for obj in bpy.data.objects if obj.type == 'MESH' and obj != donor]
assert len(targets) == 1
surface = targets[0]
surface.name = 'RaijinHound_Surface'
for donor_group in donor.vertex_groups:
    surface.vertex_groups.new(name=donor_group.name)

# Provider coordinates have ground at zero; the established rig's paws rest at
# roughly -0.47. Both meshes already face the same native forward direction.
surface.location.z -= .47
bpy.ops.object.select_all(action='DESELECT')
surface.select_set(True)
bpy.context.view_layer.objects.active = surface
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

transfer = surface.modifiers.new('transfer quadruped weights', 'DATA_TRANSFER')
transfer.object = donor
transfer.use_vert_data = True
transfer.data_types_verts = {'VGROUP_WEIGHTS'}
transfer.vert_mapping = 'POLYINTERP_NEAREST'
transfer.layers_vgroup_select_src = 'ALL'
transfer.layers_vgroup_select_dst = 'NAME'
transfer.mix_mode = 'REPLACE'
transfer.mix_factor = 1.0
bpy.ops.object.modifier_apply(modifier=transfer.name)
assert len(surface.vertex_groups) == len(donor.vertex_groups) >= 20, 'Weight transfer did not retain the source groups'

missing = [vertex.index for vertex in surface.data.vertices if not vertex.groups]
if missing:
    raise RuntimeError(f'{len(missing)} vertices received no rig weights')
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# The donor skull is narrower than this sculpt's muzzle. Nearest-surface
# transfer blends some nose and brow vertices into the neck, which stretches
# individual facial triangles during even the idle clip. Anchor the face to
# the head and feather weights through the back of the mane.
head_group = surface.vertex_groups.get('head')
assert head_group is not None
for vertex in surface.data.vertices:
    p = vertex.co
    if p.z <= -.02 or p.y >= -.10:
        continue
    head_blend = min(1.0, max(0.0, (-p.y - .10) / .14))
    if head_blend <= 0:
        continue
    existing = [(surface.vertex_groups[item.group], item.weight) for item in vertex.groups]
    for group, weight in existing:
        updated = weight * (1.0 - head_blend)
        if updated < 1e-5:
            group.remove([vertex.index])
        else:
            group.add([vertex.index], updated, 'REPLACE')
    previous_head = next((weight for group, weight in existing if group == head_group), 0.0)
    head_group.add([vertex.index], previous_head * (1.0 - head_blend) + head_blend, 'REPLACE')
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

bpy.data.objects.remove(donor, do_unlink=True)
rig.name = 'RaijinHound_Rig'
world = surface.matrix_world.copy()
surface.parent = rig
surface.matrix_world = world
armature = surface.modifiers.new('Raijin quadruped rig', 'ARMATURE')
armature.object = rig
surface['source_sculpt'] = 'pro-generation-candidate.glb'
surface['review_state'] = 'rigged_candidate_not_shipped'
bpy.context.view_layer.update()

blend_out.parent.mkdir(parents=True, exist_ok=True)
glb_out.parent.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(blend_out))

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
surface.select_set(True)
bpy.context.view_layer.objects.active = surface
bpy.ops.export_scene.gltf(filepath=str(glb_out), export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_extras=True, export_image_format='AUTO')
print('Raijin rig candidate:', len(surface.data.vertices), 'vertices,',
      len(surface.data.polygons), 'faces,', len(surface.vertex_groups), 'groups,',
      len(bpy.data.actions), 'actions')
