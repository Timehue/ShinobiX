"""Render a left-facing combat guard with the same fitted art as the world model."""

import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image


def forearm_frame(vector):
    forward = vector / np.linalg.norm(vector)
    up = np.cross(forward, [1, 0, 0])
    up /= np.linalg.norm(up)
    return np.column_stack((forward, up, np.cross(forward, up)))


def guard_pose(rest):
    from foot_contacts import sole_offset, solve_knee

    pose = {name: point.copy() for name, point in rest.items()}
    height = rest["neck_01"][2] - rest["pelvis"][2]
    for name, point in pose.items():
        if name != "root":
            lean = np.clip((point[2] - rest["pelvis"][2]) / height, 0, 1)
            point[1] -= .10 * lean
            point[2] -= .14

    for side, outward, stride, reach, wrist_height in (
        ("r", -1, -.34, -.40, -.10),
        ("l", 1, .28, -.26, -.19),
    ):
        hip, knee, ankle, toe = (bone + "_" + side for bone in ("thigh", "calf", "foot", "ball"))
        foot = rest[ankle] + np.array([outward * .09, stride, 0])
        foot[2] = -sole_offset(rest, side)[2]
        pose[knee] = solve_knee(pose[hip], foot, pose[hip] + [outward * .20, -1, 0],
                                 np.linalg.norm(rest[knee] - rest[hip]), np.linalg.norm(rest[ankle] - rest[knee]))
        pose[ankle], pose[toe] = foot, foot + rest[toe] - rest[ankle]

        shoulder, elbow, wrist = (bone + "_" + side for bone in ("upperarm", "lowerarm", "hand"))
        hand = pose[shoulder] + np.array([outward * .04, reach, wrist_height])
        pose[elbow] = solve_knee(pose[shoulder], hand, pose[shoulder] + [outward * .20, 0, -1],
                                  np.linalg.norm(rest[elbow] - rest[shoulder]), np.linalg.norm(rest[wrist] - rest[elbow]))
        # Carry the fitted grip with the forearm, keeping its local finger geometry.
        rotation = forearm_frame(hand - pose[elbow]) @ forearm_frame(rest[wrist] - rest[elbow]).T
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            for joint in ("01", "02", "03", "04_leaf"):
                name = f"{finger}_{joint}_{side}"
                pose[name] = hand + rotation @ (rest[name] - rest[wrist])
        pose[wrist] = hand
    return pose


def render_battle_pose(fit, sheet, template, work):
    import projection_trial
    from render_fitted_roster import eight_views, fit as fit_parts, read_parts

    name = "avatar"
    view = eight_views.VIEWS.index("sw")
    with TemporaryDirectory(dir=work) as scratch:
        parts = Path(scratch) / "parts"
        receipt = fit_parts(sheet, parts, template)
        if not receipt["structuralFitAccepted"]:
            raise ValueError("battle-sprite-fitting")
        # read_parts validates corrections from painted templates when present.
        for field in ("bodyAspectCorrection", "armAspectCorrection"):
            if field in fit:
                receipt[field] = fit[field]
        (parts / "fit-receipt.json").write_text(json.dumps(receipt))
        renderer = read_parts(name, json.loads(template.read_bytes()), parts)
        pose = guard_pose(renderer.rest)
        materials = fit.get("sourceMaterials", {})
        with projection_trial.using(1., .42):
            if materials.get("heldProp") or materials.get("bedroll"):
                from render_fitted_roster import fit_equipment

                _, rest_detail = renderer.render(name, view, renderer.rest)
                _, top, _, bottom = rest_detail["bounds"]
                fit_equipment(renderer.cast[name][view], 73.44 / (bottom - top),
                              materials.get("heldProp"), materials.get("bedroll"))
            sprite, detail = renderer.render(name, view, pose)

    sprite = sprite.crop(detail["bounds"])
    sprite.thumbnail((148, 148), Image.Resampling.LANCZOS)
    output = BytesIO()
    sprite.save(output, format="WEBP", lossless=True)
    return output.getvalue()
