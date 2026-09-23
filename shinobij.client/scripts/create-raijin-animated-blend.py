"""Rebuild the editable Raijin battle animation source from the shipping GLB.

Run in Blender background mode with: -- SHOWDOWN.glb OUTPUT.blend
The original high-detail sculpt and rig source remain separate and untouched.
"""
import bpy
import sys
from pathlib import Path

source, output = [Path(arg).resolve() for arg in sys.argv[sys.argv.index("--") + 1:][:2]]
required = {
    "idle", "idle_2", "walk", "gallop", "gallop_jump", "attack",
    "idle_hitreact1", "death", "entrance", "cast", "guard", "rest", "victory",
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
print("Imported objects:", [(obj.name, obj.type, len(obj.data.vertices) if obj.type == "MESH" else 0, [mod.type for mod in obj.modifiers]) for obj in bpy.data.objects])
surface = [obj for obj in meshes if len(obj.data.vertices) > 45000 and any(mod.type == "ARMATURE" for mod in obj.modifiers)]
assert len(rigs) == 1 and len(surface) == 1, "Expected one battle rig and one skinned sculpt"
# The imported GLB also contains a 42-vertex helper from the source rig. It is
# not part of the skinned pet and should not clutter the editable character file.
for obj in meshes:
    if obj not in surface:
        assert len(obj.data.vertices) == 42 and obj.name == "Icosphere", "Unexpected extra battle mesh"
        bpy.data.objects.remove(obj, do_unlink=True)
assert len(rigs[0].data.bones) == 21, "The battle rig lost its 21-bone skeleton"

actions = {action.name.split("|")[-1].lower(): action for action in bpy.data.actions}
assert required <= actions.keys(), f"Missing battle actions: {sorted(required - actions.keys())}"
for action in actions.values():
    action.use_fake_user = True

for image in bpy.data.images:
    if image.source == "FILE" and not image.packed_file:
        image.pack()

output.parent.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print("Raijin animated Blender source:", output, "actions:", sorted(required))
