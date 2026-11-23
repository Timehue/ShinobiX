"""Build the neutral five-piece stocky guide in the fitted worker's rig coordinates."""
from hashlib import sha256
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


FACINGS = ("s", "se", "e", "ne", "n", "nw", "w", "sw")
ROWS = (0, 400, 610, 820, 1050, 1280)
TEMPLATE = "stocky-template"


def body(side, front):
    # The torso ends just below the hip sockets. The muzzle indicates the turn
    # even after the painter converts the guide to neutral lighting.
    image = Image.new("RGBA", (420, 548))
    draw = ImageDraw.Draw(image)
    middle = 210
    draw.ellipse((middle-128, 198, middle+128, 543), fill="#afb1b3")
    draw.ellipse((middle-146, 0, middle+145, 252), fill="#bfc1c2")
    muzzle = middle + round(side * 94)
    if front >= -.72:
        draw.ellipse((muzzle-82, 123, muzzle+81, 228), fill="#d2d3d4")
    if front > -.1:
        for eye in (-1, 1):
            if abs(side) > .95 and eye * side < 0:
                continue
            x = middle + round(eye * 55 * front + side * 87)
            draw.ellipse((x-8, 91, x+8, 109), fill="#6c7072")
    box = image.getbbox()
    return image.crop(box), [box[0]-middle, box[1], box[2]-middle, box[3]], {}


def limb(is_leg, side, outward):
    width, height = (180, 239) if is_leg else (110, 177)
    axis = width // 2
    image = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(image)
    if is_leg:
        draw.ellipse((axis-49, 0, axis+49, 163), fill="#aaadb0")
        draw.ellipse((axis-42, 84, axis+42, 221), fill="#afb2b5")
        foot = axis + round(16*side)
        draw.ellipse((foot-61, 171, foot+61, 234), fill="#bfc1c4")
        for toe in (-1, 0, 1):
            x = foot + round(toe*34*(1-.55*abs(side)) + 21*side)
            draw.ellipse((x-25, 202, x+24, 238-abs(toe)*3), fill="#c9cbcd")
        joints = [[0, 12], [0, 112], [0, 192]]
    else:
        draw.ellipse((axis-34, 0, axis+34, 123), fill="#aaadb0")
        hand = axis + round(9*outward)
        draw.ellipse((hand-31, 81, hand+31, 176), fill="#bfc1c4")
        joints = [[0, 14], [0, 80], [hand-axis, 137]]
    left, top, right, bottom = image.getbbox()
    fields = {"joints": joints}
    if is_leg:
        fields.update(sole=[foot-axis, bottom-1], footSpan=[left-axis, right-axis-1])
    return image.crop((left, top, right, bottom)), [left-axis, top, right-axis, bottom], fields


def build(folder):
    folder.mkdir(exist_ok=True, parents=True)
    page = Image.new("RGBA", (2048, 1280))
    config = dict(center=[0]*8, hip_y=475, arm_scale=1., foot_width=1., shoulders=[], hips=[])
    views = {}
    for index, facing in enumerate(FACINGS):
        angle = index * math.pi / 4
        side, front = math.sin(angle), math.cos(angle)
        shoulder = round(100 * abs(front) + 12)
        hip = round(52 * abs(front) + 10)
        config["shoulders"].append([[-shoulder, 270], [shoulder, 270]])
        config["hips"].append([-hip, hip])
        parts = views[facing] = {}
        for row, role in enumerate(("body", "arm0", "arm1", "leg0", "leg1")):
            if role == "body":
                art, box, fields = body(side, front)
            else:
                art, box, fields = limb(role.startswith("leg"), side, -1 if role.endswith("0") else 1)
            slot = [index*256, ROWS[row], (index+1)*256, ROWS[row+1]]
            # Side-view torsos leave space around the silhouette for a painted hip tail.
            scale = min(216/art.width, (slot[3]-slot[1]-28)/art.height)
            width, height = round(art.width*scale), round(art.height*scale)
            x = slot[0] + (256-width)//2
            y = slot[1] + (slot[3]-slot[1]-height)//2
            page.alpha_composite(art.resize((width,height), Image.Resampling.LANCZOS), (x,y))
            parts[role] = dict(slot=slot, guideRect=[x,y,width,height], virtualBox=box,
                               sourceSize=list(art.size), joints=None, sole=None, footSpan=None,
                               sourcePixelSha256=sha256(art.tobytes()).hexdigest())
            parts[role].update(fields)
    guide = folder / (TEMPLATE + ".png")
    page.save(guide)
    spec = dict(schemaVersion=1, archetype="stocky-biped", canvas=list(page.size),
                rigConfig=config, trainingCharacter="patrol", views=views,
                guideSha256=sha256(guide.read_bytes()).hexdigest(), productionReady=False)
    (folder / (TEMPLATE + ".json")).write_text(json.dumps(spec, indent=2), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
