"use strict";
/*
 * _story-road-events — server catalog for the wandering story road events.
 * Mirror of shinobij.client/src/data/story-road-events.ts (ids, gates, and the
 * trait->lane map only). The parity test _story-road-events.test.ts fails the
 * build if the two drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_ROAD_EVENT_DEFS = void 0;
function def(slug, levelReq, traits) {
    return { id: `story-road-${slug}`, levelReq, minProgress: levelReq >= 100 ? 9 : 0, traits };
}
const DEFS = [
    def("border-smoke", 22, { "rd22-showed-the-token": "good", "rd22-sealed-for-mori": "neutral", "rd22-salted-the-crate": "bad" }),
    def("second-teacher", 26, { "rd26-held-the-yard": "good", "rd26-split-the-pairs": "neutral", "rd26-kept-the-scroll": "bad" }),
    def("three-footprints", 31, { "rd31-calmed-the-runner": "good", "rd31-bound-the-charm": "neutral", "rd31-learned-the-throw": "bad" }),
    def("withheld-cache", 34, { "rd34-kept-my-no": "good", "rd34-copied-the-rule": "neutral", "rd34-pried-the-seam": "bad" }),
    def("shrine-of-two-flags", 38, { "rd38-walked-them-out": "good", "rd38-split-the-hours": "neutral", "rd38-lifted-the-bowl": "bad" }),
    def("legacy-without-a-name", 44, { "rd44-restored-isa-renn": "good", "rd44-kept-three-warnings": "neutral", "rd44-wore-her-myth": "bad" }),
    def("unsworn-ledger", 48, { "rd48-split-the-penalty": "good", "rd48-favor-on-the-books": "neutral", "rd48-collected-the-fee": "bad" }),
    def("black-bridge", 52, { "rd52-shielded-the-line": "good", "rd52-held-the-count": "neutral", "rd52-sold-the-hirer": "bad" }),
    def("rival-who-keeps-losing", 56, { "rd56-trained-the-rescue": "good", "rd56-rotations-for-lessons": "neutral", "rd56-leash-on-corin": "bad" }),
    def("alliance-drill", 62, { "rd62-showed-both-commands": "good", "rd62-briefed-the-marshals": "neutral", "rd62-collected-the-honors": "bad" }),
    def("fifth-anchor", 66, { "rd66-dropped-the-shaft": "good", "rd66-carried-the-map": "neutral", "rd66-priced-the-routes": "bad" }),
    def("four-seals-one-gate", 74, { "rd74-broke-the-anchor-keys": "good", "rd74-bound-the-lattice": "neutral", "rd74-palmed-a-key": "bad" }),
    def("emergency-powers", 82, { "rd82-tore-the-clauses": "good", "rd82-three-ledgers": "neutral", "rd82-added-names": "bad" }),
    def("last-road", 94, { "rd94-walked-with-witnesses": "good", "rd94-signed-on-record": "neutral", "rd94-marched-the-afraid": "bad" }),
    def("seat-of-scars", 100, { "rd100-stood-at-dusk": "good", "rd100-set-the-ceiling": "neutral", "rd100-marked-who-bowed": "bad" }),
];
exports.STORY_ROAD_EVENT_DEFS = Object.fromEntries(DEFS.map((d) => [d.id, d]));
