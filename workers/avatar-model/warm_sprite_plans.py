"""Prepare shared movement plans before the private renderer serves players."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


# Exact body calibrations measured in the four fitted pilots. Other bodies
# calculate their own plan at render time.
PILOT_CALIBRATIONS = (29.485074150863937, 29.55561260577031, 30.917056247179648)


def warm(entry, calibrations=PILOT_CALIBRATIONS, styles=("A", "B", "C")):
    planner = entry.resolve(strict=True).with_name("shared_upload_motion.py")
    with TemporaryDirectory() as temporary:
        for factor in calibrations:
            for style in styles:
                environment = dict(os.environ, SHINOBIX_WALK_TOE_RELEASE="1",
                                   SHINOBIX_CLOSE_GUARD="1", SHINOBIX_SPRINT_STYLE=style)
                print(f"Preparing {style} at body calibration {factor}", flush=True)
                subprocess.run([sys.executable, planner, repr(factor), temporary],
                               env=environment, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installed_entry_file", type=Path, help="File containing the installed renderer entry path")
    args = parser.parse_args()
    warm(Path(args.installed_entry_file.read_text().strip()))
