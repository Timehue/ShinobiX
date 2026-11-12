"""Produce a review sheet from the final hosted model's packaged pose pages."""
from bisect import bisect_right
from gzip import decompress
import json
from math import ceil, cos, pi, sin
from pathlib import Path
import subprocess
import sys

from imageio_ffmpeg import get_ffmpeg_exe
import numpy as np
from PIL import Image, ImageDraw

from browser_motion import worker_delivery_objects
from recognition_lineup import DIRECTIONS, posed_views


def preview(result, source, map_path, destination):
    tile, columns, top, gap = 112, 8, 49, 6
    left = 67
    board = Image.new("RGB", (left + columns * (tile + gap), top + 3 * (tile + gap)), "#22272d")
    draw = ImageDraw.Draw(board)
    draw.text((14, 10), "Hosted game package", fill="#f3f4f6")
    with Image.open(map_path) as sector:
        terrain = sector.convert("RGB").resize((1080, 1080), Image.Resampling.LANCZOS)
    cx, cy = 547, 515
    road = terrain.crop((cx - tile//2, cy - 91, cx + tile//2, cy - 91 + tile))
    ffmpeg = get_ffmpeg_exe()
    for i, (gait, phase) in enumerate((("idle", 0), ("walk", .24), ("run", .24))):
        y = top + i * (tile + gap)
        draw.text((12, y + tile//2), gait.title(), fill="#f3f4f6")
        for j, (sprite, origin) in enumerate(posed_views(result, source, ffmpeg, gait, phase)):
            x = left + j * (tile + gap)
            if i == 0:
                draw.text((x + tile//2, top - 13), DIRECTIONS[j].upper(), anchor="mm", fill="#f3f4f6")
            panel = road.copy()
            panel.paste(sprite, (round(tile//2 + origin[0]), round(91 + origin[1])), sprite)
            board.paste(panel, (x, y))
    board.save(destination, "PNG")


def motion_preview(result, source, map_path, destination):
    """Play every delivered walk/run direction at game scale in one review video."""
    model = result["model"]
    objects = worker_delivery_objects(result, model["assetId"], source)
    root = json.loads(objects[model["version"] + ".json"])
    ffmpeg = get_ffmpeg_exe()
    tile, pitch, left, top = 112, 118, 86, 50
    size = (left + 8 * pitch, top + 4 * pitch)
    board = Image.new("RGB", size, "#22272d")
    draw = ImageDraw.Draw(board)
    draw.text((13, 10), "Hosted movement at game scale", fill="#f3f4f6")
    with Image.open(map_path) as sector:
        terrain = sector.convert("RGB").resize((1080, 1080), Image.Resampling.LANCZOS)
    road = terrain.crop((491, 424, 491 + tile, 424 + tile))
    clips = []
    rows = (("Walk", "A", "walk"), ("Sprint A", "A", "run"), ("Original B", "B", "run"), ("Ninja C", "C", "run"))
    for i, (label, style, gait) in enumerate(rows):
        y = top + i * pitch
        draw.text((12, y + tile//2), label, fill="#f3f4f6")
        for view, bank_name in enumerate(root["styles"][style]):
            x = left + view * pitch
            if i == 0:
                draw.text((x + tile//2, top - 12), DIRECTIONS[view].upper(), anchor="mm", fill="#f3f4f6")
            board.paste(road, (x, y))
            bank = json.loads(decompress(objects[bank_name]))
            clip = bank["clips"][gait]
            page = bank["pages"][clip["file"]]
            w, h = page["cell"]
            padded_w, padded_h = 2 * ceil(w/2), 2 * ceil(h/2)
            count, first = clip["count"], clip.get("firstCell", 0)
            command = [ffmpeg, "-v", "error", "-threads", "1", "-f", "h264", "-i", "pipe:0",
                       "-vf", f"trim=start_frame={first}", "-frames:v", str(count),
                       "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
            raw = subprocess.run(command, input=objects[page["file"]], capture_output=True, check=True, timeout=30)
            decoded = np.frombuffer(raw.stdout, np.uint8).reshape(count, 2*padded_h, padded_w, 3)
            alpha = decoded[:, padded_h:padded_h+h, :w, 0].copy()
            alpha[alpha < 5], alpha[alpha > 250] = 0, 255
            rgb = decoded[:, :h, :w].astype(np.float32) * 255 / np.maximum(alpha[..., None], 1)
            rgba = np.concatenate((np.clip(np.rint(rgb), 0, 255).astype(np.uint8), alpha[..., None]), axis=3)
            frames = tuple(Image.fromarray(frame) for frame in rgba)
            clips.append((x, y, view * pi / 4, clip, frames))

    fps = 60
    encode = [ffmpeg, "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
              "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-threads", "2", "-crf", "19", "-movflags", "+faststart", str(destination)]
    with subprocess.Popen(encode, stdin=subprocess.PIPE) as video:
        for frame in range(6 * fps):
            canvas = board.copy()
            for x, y, angle, clip, frames in clips:
                count, period = clip["count"], clip["period"]
                phase = (frame / fps) % period
                times = clip.get("times")
                index = min(count - 1, bisect_right(times, phase) - 1 if times else int(phase / period * count))
                index = max(0, index)
                ox, oy = clip["origins"][index]
                residual = 0 if times else (phase-index/count*period)*clip.get("speed", 0)
                sprite = frames[index]
                canvas.paste(sprite, (round(x + tile//2 + ox - sin(angle)*residual),
                                      round(y + 91 + oy - cos(angle)*residual)), sprite)
            video.stdin.write(canvas.tobytes())
        video.stdin.close()
        if video.wait(timeout=30):
            raise subprocess.CalledProcessError(video.returncode, encode)


if __name__ == "__main__":
    folder, map_path, destination = map(Path, sys.argv[1:4])
    receipt = json.loads((folder / "receipt.json").read_bytes())
    result = {"model": receipt["model"], "objects": {p.name: p.read_bytes() for p in (folder / "objects").iterdir()}}
    preview(result, receipt["sourceSha256"], map_path, destination)
    if len(sys.argv) == 5:
        motion_preview(result, receipt["sourceSha256"], map_path, Path(sys.argv[4]))
