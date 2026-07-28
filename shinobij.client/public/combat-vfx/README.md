Original generated 2.5D combat VFX plates for PvP.

The source plates were generated on black backgrounds for additive VFX art, then
exported with keyed alpha. The PvP renderer still draws them with
`mix-blend-mode: screen` so glow and energy detail blend into the arena.

The `fire60-smart.webp`, `wind60.webp`, `water60.webp`, `lightning60.webp`, and
`earth60.webp` plates are the core-element 60 AP target effects shared by PvE
and PvP. They were generated with OpenAI image generation, normalized to
512x512, and keyed to alpha for this renderer.

High-tier target effects should describe the technique without inventing a
second character. Their energy stays open around the center so the real fighter,
tile, and hit result remain readable. The retired human-shaped Fire plate is no
longer shipped.

Compact statuses also use their own silhouettes: `burn-status-smart.webp` is a
low flame ring, `wound-status-smart.webp` is a directional cut marker, and
`spark-status-smart.webp` is an open static halo. They deliberately do not reuse
the larger Magma, Blood, or Lightning attack plates.
