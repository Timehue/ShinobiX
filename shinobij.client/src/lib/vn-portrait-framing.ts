/** Reviewed upper-body framing for bundled full-length VN illustrations only.
 * Normal waist-up cutouts, uploaded players and custom creator URLs keep their
 * original fit. Fractions refer to the original image; no source bytes change.
 */
export type VnPortraitFrame = { x: number; y: number; width: number; height: number; aspect: number };

const fullLengthPortraits = new Set([
    "/portraits/cinematic/kite-harrow.webp",
    ...["kage-raiko-veyr-hollow", "elder-sova-canon", "elder-sova-solemn-canon",
        "pale-pack-runner", "kage-kael-whitefang-hollow", "nyx-resolute", "kage-sable-nocturne-hollow",
    ].map(name => `/portraits/cinematic/storywide/${name}.webp`),
    ...["pell-marrow", "umi", "instructor-havek", "instructor-havek-empty-hand-v1", "petra", "oren-slate",
        "serel", "sefa", "captain-hela-dray", "warden-suvi-rell", "emissary-corvane", "bracken", "sergeant-venn",
        "bellis-crane", "registrar-corin-vell", "sergeant-aldis-rime", "anji-vesk", "proctor-hasse", "sergeant-brekka",
        "captain-joss-arne", "corvo-latch", "foreman-dray", "wandering-sage", "adjutant-denn", "meru", "suma", "verah",
        "undersecretary-corvel", "amra-tull", "deni-cros", "hob-setter", "senna-graveward", "the-unremembered",
        "scout-vessa-clean-alpha-v1", "houndmaster-bel-clean-alpha-v1", "recorder-sann", "keeper-oru", "broker-nemo",
        "village-elder", "dungeon-warden", "scribe-ihara",
    ].map(name => `/portraits/cinematic/side-stories/${name}.webp`),
]);

const extendedPropPortraits = new Set([
    "/portraits/cinematic/side-stories/corvo-latch.webp",
    "/portraits/cinematic/side-stories/emissary-corvane.webp",
    "/portraits/cinematic/side-stories/proctor-hasse.webp",
]);

export function vnPortraitFrame(source: string, player = false): VnPortraitFrame | undefined {
    const pathname = source.split(/[?#]/, 1)[0];
    if (player || !fullLengthPortraits.has(pathname)) return undefined;
    // Their keys, open book and letter extend beyond the torso. Keep that hand
    // inside the phone crop rather than enforcing an identical magnification.
    if (extendedPropPortraits.has(pathname)) return { x: .2, y: 0, width: .8, height: .74, aspect: (1000 / 1536) * .8 / .74 };
    // Keep heads and the hand/waist prop lane. The rescue portrait of Bel with
    // Nara is deliberately absent: the whole kneeling composition is essential.
    return { x: .16, y: 0, width: .68, height: .64, aspect: (1000 / 1536) * .68 / .64 };
}
