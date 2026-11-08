/** Client copy of where each painted ruin restoration is drawn on its 1024px
 * floor: [x, y, width, height]. The full layout (shared/sector-ruin-restorations.ts)
 * stays off the client bundle; a test pins these to `restorationArtBounds`. */
export const RUIN_RESTORATION_BOUNDS: Readonly<Record<string, readonly [number, number, number, number]>> = {
    'festival-welcome': [14, 62, 402, 554],
    'festival-steps-house': [14, 624, 429, 277],
    'festival-lantern-house': [69, 744, 715, 280],
    gorgewatch: [581, 69, 373, 347],
    'esplanade-record-house': [24, 496, 432, 380],
    'esplanade-work-yard': [584, 410, 440, 614],
    'grey-landing-relay': [74, 69, 369, 717],
    'grey-landing-memorial': [496, 414, 320, 382],
    'obsidian-waystation': [84, 410, 530, 545],
    'obsidian-north-watch': [0, 0, 446, 316],
};
