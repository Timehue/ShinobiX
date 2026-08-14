"""Render the legacy-captioned, extended 1v1 jutsu V18 promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v18"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
