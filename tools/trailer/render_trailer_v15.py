"""Render the elemental-combat and identity-polished V15 Shinobi Journey promo."""

from __future__ import annotations

import os

os.environ["SHINOBI_TRAILER_EDITION"] = "v15"

from render_trailer_v9 import main  # noqa: E402


if __name__ == "__main__":
    main()
