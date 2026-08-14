# Shinobi Journey Trailer V18 QA Report

## Requested changes verified

- `EMBRACE YOUR LEGACY` is centered on the purple lightning shinobi shot at 75.516-77.616.
- The old blade close-up, passive broken-bridge standoff, and sword-touch duel were removed from the 104.211-112.211 sequence.
- The replacement sequence is continuous tactical 1v1 jutsu combat:
  - 104.211-106.311: water redirects lightning into a kunai grounding point.
  - 106.311-109.161: the counter expands across a broken bridge with multiple grounding kunai.
  - 109.161-112.211: a crescent wave collides with vertical lightning pillars and shatters the bridge.
- Both opponents remain on consistent sides and face one another.
- No sword-touch ending, passive stare-down, central orb, beam lock, extra fighter, or camera shake appears in the accepted motion.
- Existing V17 language, complete logos, companion captions, clan/village battle wording, and the requested early music cutoff remain intact.

## Motion checks

- `95-jutsu-duel-escalation-v18-final.mp4`: 96 frames, 96 unique frame hashes.
- `96-jutsu-duel-climax-v18-final.mp4`: 96 frames, 96 unique frame hashes.
- Artifact-heavy raw FramePack tail frames were explicitly rejected before assembly.
- Final 104.211-112.211 contact sheet: `tmp/trailer/v18-audit/v18-final-104-112-contact.jpg`.
- Legacy caption proof: `tmp/trailer/v18-audit/legacy-caption.jpg`.

## Technical validation

- Master: `output/trailer/shinobi-journey-epic-anime-promo-v18-1080p.mp4`
- Duration: 00:02:12.07
- Video: H.264 High, 1920x1080, 30 fps, yuv420p
- Audio: AAC LC, 48 kHz stereo, approximately 320 kb/s
- Full decode errors: 0
- Detected black intervals (minimum 0.10 s): 0
- Ending silence: 131.568437-132.053333, duration 0.484896 s
- Moving source reuse: maximum 1 use per source
- SHA-256: `E52225167E246643CF2AEECA9207CBBF2972FA10CC584FCD498E6902B502C9B4`
