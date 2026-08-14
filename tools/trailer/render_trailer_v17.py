"""Render the motion-smoothed combat and lightning-companion V17 promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v17"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
