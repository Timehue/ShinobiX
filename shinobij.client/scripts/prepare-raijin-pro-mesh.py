"""Reduce the reviewed high-resolution Raijin sculpt for browser QA.

Run from Blender 4.5 with -- SOURCE.glb OUTPUT.glb. This does not modify the
provider original or any live game asset.
"""
import bpy
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
source, output = [Path(value).resolve() for value in args[:2]]
ratio = float(args[2]) if len(args) > 2 else .09
selective = len(args) > 3 and args[3] == 'selective'
body_ratio = float(args[4]) if len(args) > 4 else .65
assert .05 <= ratio <= .3
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
surfaces = [obj for obj in bpy.data.objects if obj.type == 'MESH']
assert len(surfaces) == 1, f'Expected one sculpt surface, got {len(surfaces)}'
surface = surfaces[0]
surface.name = 'RaijinHound_ReviewedSculpt'

# The high-resolution original remains untouched. Retain roughly Oni Hound's
# shipping geometry budget, with the source PBR maps carrying micro-detail.
before = len(surface.data.polygons)
decimate = surface.modifiers.new('browser mesh reduction', 'DECIMATE')
decimate.ratio = ratio
bpy.context.view_layer.objects.active = surface
bpy.ops.object.modifier_apply(modifier=decimate.name)
if selective:
    body_group = surface.vertex_groups.new(name='Simpler body areas')
    body_count = 0
    for vertex in surface.data.vertices:
        p = vertex.co
        preserve = ((p.y < -.14 and p.z > .36) or
                    (p.y > .24 and p.z > .33) or
                    (p.y < -.35 and p.z > .22))
        if not preserve:
            body_group.add([vertex.index], 1.0, 'REPLACE')
            body_count += 1
    body_decimate = surface.modifiers.new('body-focused reduction', 'DECIMATE')
    body_decimate.ratio = body_ratio
    body_decimate.vertex_group = body_group.name
    body_decimate.vertex_group_factor = 1.0
    bpy.ops.object.modifier_apply(modifier=body_decimate.name)
    print('Body vertices marked for second reduction:', body_count)
for polygon in surface.data.polygons:
    polygon.use_smooth = True

for image in bpy.data.images:
    if image.size[0] > 2048 or image.size[1] > 2048:
        image.scale(2048, 2048)
        image.pack()

surface['source_sculpt'] = source.name
surface['source_faces'] = before
surface['decimation_ratio'] = ratio
surface['review_state'] = 'candidate_not_shipped'
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
surface.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
                          export_animations=False, export_extras=True,
                          export_image_format='AUTO')
print('Raijin browser mesh:', before, 'to', len(surface.data.polygons), 'faces')
