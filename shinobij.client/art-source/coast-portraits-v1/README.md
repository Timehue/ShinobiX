# Unmapped Coast scene portraits

The 25 speaking coast characters have individual waist-up portraits. Each master was painted using ImageGen with the assigned model’s pinned portrait as the costume reference and the Ansel and Aya cinematic cutouts as rendering references. The manifest records the model, the original reference path under the client and the full painting prompt for every character.

Run `node export.cjs` here with the repository dependencies installed to reproduce the candidate WebPs under `output/coast/portraits`. An optional directory argument writes the same files elsewhere. The exporter samples the magenta backdrop, removes the key, suppresses edge colour spill, frames the visible figure at 733 × 1100 and encodes with alpha. It checks each portrait against 130,000 bytes and the collection against 3,000,000 bytes.

Runtime files live under `shinobij.client/public/portraits/cinematic/coast/`. The admitted ids in `shared/coast-cast.ts` select these pictures for quest speech. The Wandering Sage uses his existing side-story cutout. [Candidate portraits and contact sheet](../../../output/coast/portraits/)

The three Untamed Coast bosses also have cutouts. Their world models supply the silhouettes and colours. Their faces occupy the upper part of the canvas for the combat crop. The exporter places them at a consistent top inset and checks their separate 350,000-byte limit. [Beast sheet](../../../output/coast/portraits/beast-review.webp)

Old Brinejaw’s current portrait uses the versioned `masters/brinejaw-v2.png` and a three-pixel chroma edge cleanup to preserve his naturally violet coat. The original master and candidate remain available for art history.
