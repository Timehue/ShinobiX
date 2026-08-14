"""Render the frame-smoothed and companion-copy-polished V16 promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v16"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
