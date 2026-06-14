/*
 * Card Clash painted art — bundled Flux-generated backgrounds (scripts/gen-bg.mjs).
 * The board backdrop sits behind every Card Clash surface; each location id maps
 * to its own painted scene shown as the lane header banner. Imported (not
 * referenced by raw path) so Vite hashes + bundles them.
 */
import board from "../assets/card-clash/board.webp";
import trainingGround from "../assets/card-clash/loc/training-ground.webp";
import volcanoPass from "../assets/card-clash/loc/volcano-pass.webp";
import riverShrine from "../assets/card-clash/loc/river-shrine.webp";
import stoneGate from "../assets/card-clash/loc/stone-gate.webp";
import windBridge from "../assets/card-clash/loc/wind-bridge.webp";
import stormPeak from "../assets/card-clash/loc/storm-peak.webp";
import moonshadowRuins from "../assets/card-clash/loc/moonshadow-ruins.webp";
import frozenLake from "../assets/card-clash/loc/frozen-lake.webp";
import ninjaAcademy from "../assets/card-clash/loc/ninja-academy.webp";
import blackMarket from "../assets/card-clash/loc/black-market.webp";
import hollowGate from "../assets/card-clash/loc/hollow-gate.webp";
import hiddenDojo from "../assets/card-clash/loc/hidden-dojo.webp";
import kageSummit from "../assets/card-clash/loc/kage-summit.webp";

export const CARD_CLASH_BOARD_BG = board;

export const CARD_CLASH_LOCATION_ART: Record<string, string> = {
    "training-ground": trainingGround,
    "volcano-pass": volcanoPass,
    "river-shrine": riverShrine,
    "stone-gate": stoneGate,
    "wind-bridge": windBridge,
    "storm-peak": stormPeak,
    "moonshadow-ruins": moonshadowRuins,
    "frozen-lake": frozenLake,
    "ninja-academy": ninjaAcademy,
    "black-market": blackMarket,
    "hollow-gate": hollowGate,
    "hidden-dojo": hiddenDojo,
    "kage-summit": kageSummit,
};
