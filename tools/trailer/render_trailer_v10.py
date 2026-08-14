"""Render the AAA-copy V10 edition of the Shinobi Journey anime promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v10"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
