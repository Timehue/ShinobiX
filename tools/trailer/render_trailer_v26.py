"""Render the all-motion Rill V26 animated landing teaser."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

from render_trailer_v5 import FPS, HEIGHT, WIDTH, ffmpeg_path, run
from render_trailer_v25 import make_end_card, make_story_overlay


TOTAL_FRAMES = 432
TOTAL_DURATION = TOTAL_FRAMES / FPS
BAR_HEIGHT = 58


@dataclass(frozen=True)
class MotionShot:
    name: str
    source: Path
    frames: int
    overlay: str | None = None
    flash: bool = False


def render_motion_shot(
    ffmpeg: str,
    shot: MotionShot,
    overlay: Path | None,
    destination: Path,
) -> None:
    duration = shot.frames / FPS
    retime_factor = shot.frames / 37
    command = [ffmpeg, "-loglevel", "error", "-y", "-i", str(shot.source)]
    if overlay:
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(overlay)]
    base = (
        "[0:v]setpts=PTS-STARTPTS,"
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={WIDTH}:{HEIGHT},"
        f"setpts=(PTS-STARTPTS)*{retime_factor:.8f},fps={FPS},"
        f"tpad=stop_mode=clone:stop_duration=1,trim=end_frame={shot.frames},"
        f"setpts=N/({FPS}*TB),"
        "hqdn3d=0.30:0.24:0.90:0.72,"
        "eq=contrast=1.055:saturation=1.070:gamma=1.005:brightness=-0.003,"
        "curves=all='0/0 0.10/0.075 0.50/0.535 0.90/0.945 1/1',"
        "unsharp=5:5:0.28:5:5:0.0"
    )
    if shot.flash:
        base += ",fade=t=in:st=0:d=0.060:color=white"
    filters = [base + "[base]"]
    current = "base"
    if overlay:
        fade_out = max(0.0, duration - 0.18)
        filters.append(
            f"[1:v]format=rgba,fade=t=in:st=0.08:d=0.16:alpha=1,"
            f"fade=t=out:st={fade_out:.3f}:d=0.16:alpha=1[text]"
        )
        filters.append(f"[{current}][text]overlay=0:0:shortest=1[captioned]")
        current = "captioned"
    filters.append(
        f"[{current}]drawbox=x=0:y=0:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - BAR_HEIGHT}:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        "format=yuv420p[out]"
    )
    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-frames:v",
        str(shot.frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "14",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(destination),
    ]
    run(command, quiet=True)


def render_end_card(
    ffmpeg: str,
    still: Path,
    particles: Path,
    frames: int,
    destination: Path,
) -> None:
    duration = frames / FPS
    graph = (
        "[0:v]scale=2048:1152:force_original_aspect_ratio=increase:flags=lanczos,"
        "crop=2048:1152,"
        f"zoompan=z='1.0+0.018*on/{frames - 1}':"
        "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,"
        "format=gbrp[card];"
        "[1:v]scale=1920:1080:flags=lanczos,setpts=PTS-STARTPTS,format=gbrp[snow];"
        "[card][snow]blend=all_mode=screen:all_opacity=0.34:shortest=1,"
        f"fade=t=in:st=0:d=0.22:color=black,fade=t=out:st={duration - 0.32:.3f}:d=0.30:color=black,"
        f"drawbox=x=0:y=0:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        f"drawbox=x=0:y={HEIGHT - BAR_HEIGHT}:w=iw:h={BAR_HEIGHT}:color=black:t=fill,"
        "eq=contrast=1.045:saturation=1.040:gamma=1.010,format=yuv420p[out]"
    )
    run([
        ffmpeg,
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        str(FPS),
        "-i",
        str(still),
        "-stream_loop",
        "-1",
        "-i",
        str(particles),
        "-filter_complex",
        graph,
        "-map",
        "[out]",
        "-frames:v",
        str(frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "14",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        str(destination),
    ], quiet=True)


def assemble(ffmpeg: str, clips: list[Path], manifest: Path, destination: Path) -> None:
    manifest.write_text("".join(f"file '{clip.as_posix()}'\n" for clip in clips), encoding="utf-8")
    run([
        ffmpeg,
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(manifest),
        "-c",
        "copy",
        str(destination),
    ])


def mix_audio(
    ffmpeg: str,
    silent: Path,
    song: Path,
    sfx: Path,
    destination: Path,
) -> None:
    events = [
        ("omen.wav", 0.000, 0.120),
        ("reveal.wav", 0.180, 0.100),
        ("chakra-positive.wav", 1.800, 0.105),
        ("mythic.wav", 3.000, 0.100),
        ("battle-transition.wav", 4.600, 0.095),
        ("impact-light.wav", 5.833, 0.090),
        ("impact-heavy.wav", 7.066, 0.145),
        ("impact-heavy.wav", 8.299, 0.100),
        ("chakra-positive.wav", 9.599, 0.090),
        ("victory-seal.wav", 10.999, 0.150),
    ]
    command = [ffmpeg, "-loglevel", "error", "-y", "-i", str(silent), "-i", str(song)]
    for filename, _, _ in events:
        command += ["-i", str(sfx / filename)]
    filters = [
        f"[1:a]atrim=start=14.303:end={14.303 + TOTAL_DURATION:.3f},asetpts=PTS-STARTPTS,"
        f"volume=0.94,afade=t=in:st=0:d=0.06,afade=t=out:st={TOTAL_DURATION - 0.65:.3f}:d=0.62[music]"
    ]
    labels = ["[music]"]
    for index, (_, timestamp, volume) in enumerate(events):
        label = f"sfx{index}"
        filters.append(
            f"[{index + 2}:a]adelay={round(timestamp * 1000)}:all=1,"
            f"volume={volume:.4f}[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.95[aout]"
    )
    temporary = destination.with_name(destination.stem + ".tmp.mp4")
    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(temporary),
    ]
    run(command)
    os.replace(temporary, destination)


def encode_web(ffmpeg: str, source: Path, destination: Path) -> None:
    run([
        ffmpeg,
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "23",
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(destination),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--song",
        type=Path,
        default=Path(r"C:\Users\Tyler R\Downloads\SHINOBI ROASTED RICE 2.wav"),
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    song = args.song.resolve(strict=True)
    ffmpeg = ffmpeg_path()
    work = root / "tmp" / "trailer" / "render-v26"
    clips_dir = work / "clips"
    overlays = work / "overlays"
    output = root / "output" / "trailer"
    motion = output / "framepack-v26"
    for directory in (work, clips_dir, overlays, output):
        directory.mkdir(parents=True, exist_ok=True)

    wrong = overlays / "world-remembers-wrong.png"
    machine = overlays / "one-machine.png"
    end_card = work / "end-card-v26.png"
    make_story_overlay(wrong, "THE WORLD REMEMBERS\nYOU WRONG.", "FROSTFANG VILLAGE")
    make_story_overlay(machine, "ONE MACHINE\nBENEATH THEM ALL.", "THE SUNKEN COURT")
    make_end_card(end_card, root / "shinobij.client" / "public" / "shinobi-journey-logo-wide.webp")

    shots = [
        MotionShot("meter-awakening", motion / "001-meter-awakening-v26.mp4", 54, "world-remembers-wrong"),
        MotionShot("rill-wolf-step", motion / "002-rill-wolf-step-v26.mp4", 36),
        MotionShot("sunken-court", motion / "003-sunken-court-awakens-v26.mp4", 48, "one-machine"),
        MotionShot("rill-dash", motion / "005-rill-dash-v26.mp4", 37, flash=True),
        MotionShot("rill-kick-ring", motion / "003-rill-kael-framepack-onewindow-v26.mp4", 37),
        MotionShot("rill-kick-impact", motion / "006-rill-kick-impact-v26.mp4", 37, flash=True),
        MotionShot("rill-landing", motion / "007-rill-landing-rise-v26.mp4", 39),
        MotionShot("rill-close", motion / "004-rill-close-resolve-v26.mp4", 42),
    ]
    if sum(shot.frames for shot in shots) + 102 != TOTAL_FRAMES:
        raise ValueError("V26 timeline frame count changed")

    rendered: list[Path] = []
    for index, shot in enumerate(shots):
        if not shot.source.exists():
            raise FileNotFoundError(shot.source)
        destination = clips_dir / f"{index:03d}-{shot.name}.mp4"
        overlay = overlays / f"{shot.overlay}.png" if shot.overlay else None
        if args.force or not destination.exists():
            print(f"shot={index + 1}/{len(shots) + 1} name={shot.name}", flush=True)
            render_motion_shot(ffmpeg, shot, overlay, destination)
        rendered.append(destination)

    end_clip = clips_dir / "008-end-card.mp4"
    if args.force or not end_clip.exists():
        print(f"shot={len(shots) + 1}/{len(shots) + 1} name=end-card", flush=True)
        render_end_card(
            ffmpeg,
            end_card,
            root / "tmp" / "trailer" / "motion" / "particles-snow.mp4",
            102,
            end_clip,
        )
    rendered.append(end_clip)

    silent = work / "silent-v26.mp4"
    assemble(ffmpeg, rendered, work / "concat-v26.txt", silent)
    master = output / "shinobi-journey-rill-animated-teaser-v26-1080p.mp4"
    mix_audio(
        ffmpeg,
        silent,
        song,
        root / "shinobij.client" / "public" / "sfx" / "production",
        master,
    )
    web = output / "shinobi-journey-rill-animated-teaser-v26-web.mp4"
    encode_web(ffmpeg, master, web)
    print(f"Rendered {master}")
    print(f"Rendered {web}")


if __name__ == "__main__":
    main()
