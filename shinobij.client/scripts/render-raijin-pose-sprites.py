"""Render Raijin's active 2D pose set from the current animated Blender source.

Run with Blender in raijin-hound-showdown-animated.blend:
  blender --background SOURCE.blend --python scripts/render-raijin-pose-sprites.py -- OUTPUT_DIRECTORY
Then run scripts/finalize-raijin-pose-sprites.mjs to publish the WebP set.
"""
import bpy
import sys
from pathlib import Path
from mathutils import Vector

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = 0.15
scene.view_settings.gamma = 1

target = Vector((0, 0, 0.17))
camera_data = bpy.data.cameras.new('RaijinPoseCamera')
camera = bpy.data.objects.new('RaijinPoseCamera', camera_data)
scene.collection.objects.link(camera)
camera.location = (-1.55, -2.1, 1.1)
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 1.4
scene.camera = camera


def area(name, location, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()


area('RaijinWarmKey', (-1.3, -1.5, 2.2), 90, 3.0, (1.0, 0.86, 0.69))
area('RaijinCoolFill', (1.5, -0.6, 1.1), 55, 2.8, (0.52, 0.71, 1.0))
area('RaijinBackRim', (0.4, 1.5, 1.7), 105, 2.0, (0.65, 0.81, 1.0))

rig = bpy.data.objects['RaijinHound_Rig']
rig.animation_data_create()
poses = {
    'idle': ('idle', 0.18),
    'attack': ('attack', 0.57),
    'hurt': ('idle_hitreact1', 0.22),
    'cast': ('cast', 0.48),
    'run-a': ('gallop', 0.16),
    'run-b': ('gallop', 0.62),
    'windup': ('attack', 0.18),
    'lunge': ('gallop_jump', 0.52),
    'impact': ('attack', 0.53),
    'recover': ('attack', 0.8),
}
for category, (action_name, progress) in poses.items():
    action = bpy.data.actions[action_name]
    rig.animation_data.action = action
    scene.frame_set(round(action.frame_range[1] * progress))
    scene.render.filepath = str(output / f'starter-lightning-l-{category}.png')
    bpy.ops.render.render(write_still=True)
    print(f'Rendered Raijin {category}: {action_name} {progress:.2f}')
