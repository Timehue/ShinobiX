"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _core_js_1 = require("./_core.js");
/*
 * Pet-ladder core. Also the server-side smoke test that the PORTED engines
 * (_duel-sim.ts / _arena-sim.ts) load + run under the cPanel build: resolve*()
 * call them. Determinism + stronger-wins guard parity with the client engines;
 * the offer/swap logic guards the Sword-x-Staff ladder math.
 */
const pet = (over = {}) => ({
    id: "p", name: "P", rarity: "rare", level: 25, hp: 700, attack: 90, defense: 40, speed: 70,
    element: "Fire", role: "assassin", jutsus: [{ name: "Strike", kind: "damage", power: 100, cooldown: 0 }], ...over,
});
const entry = (slug) => ({
    slug, name: slug, record: { wins: 0, losses: 0, defended: 0, defeated: 0 },
    summary: [{ name: "P", element: "Fire", level: 25, role: "assassin", rarity: "rare" }], updatedAt: 1,
});
const team = (slug, mul) => {
    const roles = ["defender", "tracker", "assassin", "sage"];
    const pets = roles.map((r, i) => pet({ id: `${slug}-${r}`, role: r, hp: Math.round(700 * mul), attack: Math.round(90 * mul) }));
    return { slug, name: slug, mode: "tactical", pets, roles: (0, _core_js_1.ladderRoles)(pets), updatedAt: 1 };
};
// ── ported engines (server-authoritative resolution) ──────────────────────────
(0, node_test_1.test)("resolveColiseum: deterministic, and a clearly stronger pet wins", () => {
    const strong = pet({ id: "s", hp: 1400, attack: 220 }), weak = pet({ id: "w", hp: 400, attack: 45 });
    strict_1.default.equal((0, _core_js_1.resolveColiseum)(strong, weak, 2024), true);
    strict_1.default.equal((0, _core_js_1.resolveColiseum)(weak, strong, 2024), false);
    strict_1.default.equal((0, _core_js_1.resolveColiseum)(strong, weak, 7), (0, _core_js_1.resolveColiseum)(strong, weak, 7));
});
(0, node_test_1.test)("resolveColiseum: equipped PvP gear is applied (wins more over many seeds)", () => {
    const seeds = Array.from({ length: 24 }, (_, i) => i * 41 + 3);
    const a = pet({ id: "a", attack: 90, hp: 700, defense: 40, speed: 80 });
    const b = pet({ id: "b", attack: 90, hp: 700, defense: 40, speed: 80 });
    const wins = (geared) => seeds.filter((s) => (0, _core_js_1.resolveColiseum)(geared ? { ...a, loadout: { pvp: "pvp-arena-champion-regalia" } } : a, b, s)).length;
    strict_1.default.ok(wins(true) > wins(false), `gear should win more (off=${wins(false)}, on=${wins(true)})`);
});
(0, node_test_1.test)("resolveTactical: deterministic, and a clearly stronger team wins", () => {
    const strong = team("S", 2), weak = team("W", 0.5);
    strict_1.default.equal((0, _core_js_1.resolveTactical)(strong, weak, 7), true);
    strict_1.default.equal((0, _core_js_1.resolveTactical)(weak, strong, 7), false);
    strict_1.default.equal((0, _core_js_1.resolveTactical)(strong, weak, 99), (0, _core_js_1.resolveTactical)(strong, weak, 99));
});
// ── offer matchmaking ─────────────────────────────────────────────────────────
const aiSummary = (i) => ({ kind: "ai", id: `ai:${i}`, name: `AI${i}`, rank: null, summary: [] });
(0, node_test_1.test)("buildOffer: close-above humans first, AI fills the rest", () => {
    const order = ["a", "b", "c", "d", "e", "f"].map(entry); // ranks 1..6
    strict_1.default.deepEqual((0, _core_js_1.buildOffer)(order, "d", aiSummary, 0).map((o) => o.id), ["c", "b", "a"]); // rank 4 → 3 humans
    const offB = (0, _core_js_1.buildOffer)(order, "b", aiSummary, 0); // rank 2 → 1 human + 2 AI
    strict_1.default.equal(offB[0].id, "a");
    strict_1.default.equal(offB.filter((o) => o.kind === "ai").length, 2);
    const offEmpty = (0, _core_js_1.buildOffer)([], "z", aiSummary, 0); // empty ladder → all AI
    strict_1.default.equal(offEmpty.length, _core_js_1.OFFER_SIZE);
    strict_1.default.ok(offEmpty.every((o) => o.kind === "ai"));
});
(0, node_test_1.test)("canChallenge: above + within band; AI always legal", () => {
    const order = Array.from({ length: 20 }, (_, i) => entry(`p${i}`)); // ranks 1..20 (index 0..19)
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "p15", "p6"), true); // 15-6 = 9 ≤ band
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "p15", "p4"), false); // 15-4 = 11 > band
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "p5", "p9"), false); // below you
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "p5", "ai:0"), true);
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "p5", "ai:99"), false);
    strict_1.default.ok(_core_js_1.CLIMB_BAND === 10);
});
(0, node_test_1.test)("buildOffer: excludes the just-fought opponent (no back-to-back), AI backfills to 3", () => {
    const order = ["a", "b", "c", "d", "e", "f"].map(entry); // ranks 1..6
    const off = (0, _core_js_1.buildOffer)(order, "d", aiSummary, 0, "c"); // d (rank 4) just fought c (rank 3)
    strict_1.default.ok(!off.some((o) => o.id === "c"), "the just-fought opponent must not be re-offered");
    strict_1.default.equal(off.length, _core_js_1.OFFER_SIZE);
    strict_1.default.deepEqual(off.filter((o) => o.kind === "player").map((o) => o.id), ["b", "a"]); // next two humans, then AI fill
    const offAi = (0, _core_js_1.buildOffer)([], "z", aiSummary, 0, "ai:0"); // a just-fought AI isn't re-offered either
    strict_1.default.ok(!offAi.some((o) => o.id === "ai:0"));
    strict_1.default.equal(offAi.length, _core_js_1.OFFER_SIZE);
});
(0, node_test_1.test)("canChallenge: rejects the just-fought opponent (excludeId)", () => {
    const order = ["a", "b", "c"].map(entry);
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "c", "b", "b"), false); // just fought b → no immediate rematch
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "c", "a", "b"), true); // a different valid target is fine
    strict_1.default.equal((0, _core_js_1.canChallenge)(order, "c", "ai:0", "ai:0"), false); // same rule for a just-fought AI
});
// ── rank swaps ────────────────────────────────────────────────────────────────
(0, node_test_1.test)("applyChallenge: beating a human above takes their rank", () => {
    const order = ["a", "b", "c", "d", "e"].map(entry);
    const r = (0, _core_js_1.applyChallenge)(order, entry("d"), "b", true); // d (rank 4) beats b (rank 2)
    strict_1.default.deepEqual(r.order.map((e) => e.slug), ["a", "d", "b", "c", "e"]);
    strict_1.default.equal(r.order[1].record.wins, 1);
    strict_1.default.equal(r.order[2].record.defeated, 1);
    strict_1.default.equal(r.notifySlug, "b");
});
(0, node_test_1.test)("applyChallenge: losing leaves the order intact but records the loss/defend", () => {
    const order = ["a", "b", "c"].map(entry);
    const r = (0, _core_js_1.applyChallenge)(order, entry("c"), "a", false);
    strict_1.default.deepEqual(r.order.map((e) => e.slug), ["a", "b", "c"]);
    strict_1.default.equal(r.order.find((e) => e.slug === "c").record.losses, 1);
    strict_1.default.equal(r.order.find((e) => e.slug === "a").record.defended, 1);
});
(0, node_test_1.test)("applyChallenge: an unranked challenger joins only on a win", () => {
    const order = ["a", "b"].map(entry);
    strict_1.default.deepEqual((0, _core_js_1.applyChallenge)(order, entry("z"), "ai:0", false).order.map((e) => e.slug), ["a", "b"]); // AI loss → not ranked
    strict_1.default.deepEqual((0, _core_js_1.applyChallenge)(order, entry("z"), "ai:0", true).order.map((e) => e.slug), ["a", "b", "z"]); // AI win → inducted
    strict_1.default.deepEqual((0, _core_js_1.applyChallenge)(order, entry("z"), "b", true).order.map((e) => e.slug), ["a", "z", "b"]); // beat a human → take their rank
    strict_1.default.deepEqual((0, _core_js_1.applyChallenge)(order, entry("z"), "b", false).order.map((e) => e.slug), ["a", "b"]); // human loss → not ranked
});
(0, node_test_1.test)("a ranked bottom player losing to AI is NOT removed (edge guard)", () => {
    const order = ["a", "b", "c"].map(entry);
    const r = (0, _core_js_1.applyChallenge)(order, entry("c"), "ai:0", false);
    strict_1.default.deepEqual(r.order.map((e) => e.slug), ["a", "b", "c"]);
    strict_1.default.equal(r.order[2].record.losses, 1);
});
// ── ownership + snapshot ────────────────────────────────────────────────────────
(0, node_test_1.test)("chooseOwnedLadderPets: validates ownership + preserves loadout", () => {
    const owned = [
        { id: "x1", name: "Fox", hp: 700, attack: 90, defense: 40, speed: 70, element: "Fire", loadout: { pvp: "pvp-aegis-pendant", consumable: "consum-second-wind" } },
        { id: "x2", name: "Owl", hp: 600, attack: 80, defense: 35, speed: 80, element: "Wind" },
    ];
    strict_1.default.equal((0, _core_js_1.chooseOwnedLadderPets)(owned, ["x1"], 1)[0].loadout?.pvp, "pvp-aegis-pendant");
    strict_1.default.equal((0, _core_js_1.chooseOwnedLadderPets)(owned, ["x9"], 1), null); // not owned
    strict_1.default.equal((0, _core_js_1.chooseOwnedLadderPets)(owned, ["x1", "x2"], 1), null); // wrong count
    strict_1.default.equal((0, _core_js_1.chooseOwnedLadderPets)(owned, ["x1", "x1"], 2), null); // can't pick one pet twice
    strict_1.default.equal((0, _core_js_1.chooseOwnedLadderPets)(owned, ["x1", "x2"], 2).length, 2);
});
(0, node_test_1.test)("snapshotLadderPet: clamps junk + keeps only known loadout slots", () => {
    const s = (0, _core_js_1.snapshotLadderPet)({ id: "p", name: "P", hp: -5, attack: 1e9, defense: "x", speed: 50, element: "Fire", loadout: { pvp: "g", collar: "c", consumable: "k" }, jutsus: [{ name: "S", kind: "damage", power: 99, cooldown: 1 }] });
    strict_1.default.equal(s.hp, 1); // clamped up from -5
    strict_1.default.equal(s.attack, 320); // clamped to the standard-rarity attack ceiling (base 40 * 8) — was a flat 100000
    strict_1.default.equal(s.defense, 30); // junk → default
    strict_1.default.equal(s.loadout?.pvp, "g");
    strict_1.default.equal(s.loadout?.consumable, "k");
    strict_1.default.equal(s.loadout.collar, undefined); // collar dropped (not combat)
    strict_1.default.equal(s.jutsus.length, 1);
});
