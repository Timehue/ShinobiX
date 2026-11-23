# Unmapped Coast quest achievement badges

These eight 256 × 256 opaque WebPs accompany the story quest and side-tale achievements. Each badge has its own lossless painting in `masters/`. The prompts and references are in `prompts.json`. The three style references are the game’s Story Chapter 9, Questbook 5 and Dungeon Clear 1 badges. The crossing also uses the coast’s own boat painting.

From this worktree with its pinned dependencies installed, run `node shinobij.client/art-source/coast-quest-badges/export.cjs` to reproduce the runtime images. To verify an export in a separate directory, pass that directory as an argument. File sizes and SHA-256 hashes for both the masters and the delivered badges are in [files.json](files.json).
