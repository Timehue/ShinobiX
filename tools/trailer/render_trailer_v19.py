"""Render the style-matched, fully recut 1v1 fight V19 promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v19"

from render_trailer_v9 import main


if __name__ == "__main__":
    main()
