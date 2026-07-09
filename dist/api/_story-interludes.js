"use strict";
/*
 * _story-interludes — server catalog for the VN-only story interludes.
 * Mirror of shinobij.client/src/data/story-interludes.ts (ids, gates, and the
 * trait->lane map only; the dialogue lives client-side). The parity test
 * _story-interludes.test.ts fails the build if the two drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_INTERLUDE_DEFS = void 0;
const MILESTONE_LEVELS = [4, 15, 25, 35, 50, 65, 75, 85, 100];
function def(village, levelReq, traits) {
    return {
        id: `story-interlude-${village.toLowerCase().replace(/\W+/g, '-')}-${levelReq}`,
        village,
        levelReq,
        minProgress: MILESTONE_LEVELS.filter((l) => l < levelReq).length,
        traits,
    };
}
const DEFS = [
    def("Stormveil Village", 20, { "sv20-offered-the-spar": "good", "sv20-asked-the-price": "neutral", "sv20-turned-your-back": "bad" }),
    def("Stormveil Village", 30, { "mira-trust": "good", "mira-respect": "neutral", "mira-fear": "bad" }),
    def("Stormveil Village", 42, { "sv42-said-it-aloud": "good", "sv42-kept-the-count": "neutral", "sv42-fed-the-floor": "bad" }),
    def("Stormveil Village", 58, { "sv58-refused-the-ninth": "good", "sv58-copied-the-column": "neutral", "sv58-took-the-cut": "bad" }),
    def("Stormveil Village", 70, { "sv70-fell-on-schedule": "neutral", "sv70-read-the-mark": "good", "sv70-made-him-kneel": "bad" }),
    def("Stormveil Village", 80, { "sv80-pulled-her-back": "good", "sv80-set-the-terms": "neutral", "sv80-took-notes": "bad" }),
    def("Stormveil Village", 92, { "sv92-open-road": "good", "sv92-signed-muster": "neutral", "sv92-fear-column": "bad" }),
    def("Ashen Leaf Village", 20, { "al20-met-her-eye": "good", "al20-took-her-measure": "neutral", "al20-turned-your-back": "bad" }),
    def("Ashen Leaf Village", 30, { "toma-hope": "good", "toma-caution": "neutral", "toma-doubt": "bad" }),
    def("Ashen Leaf Village", 42, { "al42-filed-a-report": "good", "al42-kept-the-count": "neutral", "al42-burned-a-blank": "bad" }),
    def("Ashen Leaf Village", 58, { "al58-refused-the-cut": "good", "al58-took-note": "neutral", "al58-took-the-knowledge": "bad" }),
    def("Ashen Leaf Village", 70, { "al70-claimed-the-name": "good", "al70-erased-the-name": "neutral", "al70-traded-the-name": "bad" }),
    def("Ashen Leaf Village", 80, { "al80-pulled-her-back": "good", "al80-split-the-draw": "neutral", "al80-let-her-burn": "bad" }),
    def("Ashen Leaf Village", 92, { "al92-carried-their-trust": "good", "al92-took-the-count": "neutral", "al92-wore-their-fear": "bad" }),
    def("Frostfang Village", 20, { "ff20-shared-the-fire": "good", "ff20-read-her-license": "neutral", "ff20-called-the-next-name": "bad" }),
    def("Frostfang Village", 30, { "yura-trust": "good", "yura-respect": "neutral", "yura-fear": "bad" }),
    def("Frostfang Village", 42, { "ff42-held-the-doubt": "good", "ff42-kept-the-count": "neutral", "ff42-reported-the-doubt": "bad" }),
    def("Frostfang Village", 58, { "ff58-stayed-in-the-count": "good", "ff58-asked-the-meter": "neutral", "ff58-took-the-exemption": "bad" }),
    def("Frostfang Village", 70, { "ff70-turned-the-plate": "good", "ff70-copied-the-terms": "neutral", "ff70-took-the-hold": "bad" }),
    def("Frostfang Village", 80, { "ff80-burned-the-plates": "good", "ff80-sold-the-schedule": "neutral", "ff80-kept-her-list": "bad" }),
    def("Frostfang Village", 92, { "ff92-called-the-camp": "good", "ff92-took-her-terms": "neutral", "ff92-sent-the-warning": "bad" }),
    def("Moonshadow Village", 20, { "ms20-respected-the-unsworn": "good", "ms20-measured-the-unsworn": "neutral", "ms20-dismissed-the-unsworn": "bad" }),
    def("Moonshadow Village", 30, { "nyx-partner": "good", "nyx-respect": "neutral", "nyx-suspicion": "bad" }),
    def("Moonshadow Village", 42, { "ms42-reported-the-booths": "good", "ms42-kept-it-quiet": "neutral", "ms42-tested-the-drain": "bad" }),
    def("Moonshadow Village", 58, { "ms58-refused-the-shelf": "good", "ms58-took-note": "neutral", "ms58-took-the-shelf": "bad" }),
    def("Moonshadow Village", 70, { "ms70-burned-the-file": "good", "ms70-claimed-custody": "neutral", "ms70-started-files": "bad" }),
    def("Moonshadow Village", 80, { "ms80-pulled-her-back": "good", "ms80-partnered": "neutral", "ms80-let-her-burn": "bad" }),
    def("Moonshadow Village", 92, { "ms92-vowed-open-ledgers": "good", "ms92-vowed-a-keeper": "neutral", "ms92-vowed-to-collect": "bad" }),
];
exports.STORY_INTERLUDE_DEFS = Object.fromEntries(DEFS.map((d) => [d.id, d]));
