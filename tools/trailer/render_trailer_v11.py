"""Render the final forehead-bond V11 edition of the Shinobi Journey promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v11"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
