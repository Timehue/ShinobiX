"""Render the tactical-combat and motion-polished V14 Shinobi Journey promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v14"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
