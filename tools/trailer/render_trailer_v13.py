"""Render the game-feature and full-logo V13 Shinobi Journey promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v13"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
