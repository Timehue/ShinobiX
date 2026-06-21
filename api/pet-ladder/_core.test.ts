import { test } from "node:test";
import assert from "node:assert/strict";
import {
    resolveColiseum, resolveTactical, buildOffer, canChallenge, applyChallenge,
    chooseOwnedLadderPets, ladderRoles, snapshotLadderPet, CLIMB_BAND, OFFER_SIZE,
    type LadderPet, type LadderEntry, type DefenseDoc, type OfferOpponent,
} from "./_core.js";

/*
 * Pet-ladder core. Also the server-side smoke test that the PORTED engines
 * (_duel-sim.ts / _arena-sim.ts) load + run under the cPanel build: resolve*()
 * call them. Determinism + stronger-wins guard parity with the client engines;
 * the offer/swap logic guards the Sword-x-Staff ladder math.
 */

const pet = (over: Partial<LadderPet> = {}): LadderPet => ({
    id: "p", name: "P", rarity: "rare", level: 25, hp: 700, attack: 90, defense: 40, speed: 70,
    element: "Fire", role: "assassin", jutsus: [{ name: "Strike", kind: "damage", power: 100, cooldown: 0 }], ...over,
});
const entry = (slug: string): LadderEntry => ({
    slug, name: slug, record: { wins: 0, losses: 0, defended: 0, defeated: 0 },
    summary: [{ name: "P", element: "Fire", level: 25, role: "assassin", rarity: "rare" }], updatedAt: 1,
});
const team = (slug: string, mul: number): DefenseDoc => {
    const roles = ["defender", "tracker", "assassin", "sage"] as const;
    const pets = roles.map((r, i) => pet({ id: `${slug}-${r}`, role: r, hp: Math.round(700 * mul), attack: Math.round(90 * mul) }));
    return { slug, name: slug, mode: "tactical", pets, roles: ladderRoles(pets), updatedAt: 1 };
};

// ── ported engines (server-authoritative resolution) ──────────────────────────
test("resolveColiseum: deterministic, and a clearly stronger pet wins", () => {
    const strong = pet({ id: "s", hp: 1400, attack: 220 }), weak = pet({ id: "w", hp: 400, attack: 45 });
    assert.equal(resolveColiseum(strong, weak, 2024), true);
    assert.equal(resolveColiseum(weak, strong, 2024), false);
    assert.equal(resolveColiseum(strong, weak, 7), resolveColiseum(strong, weak, 7));
});

test("resolveColiseum: equipped PvP gear is applied (wins more over many seeds)", () => {
    const seeds = Array.from({ length: 24 }, (_, i) => i * 41 + 3);
    const a = pet({ id: "a", attack: 90, hp: 700, defense: 40, speed: 80 });
    const b = pet({ id: "b", attack: 90, hp: 700, defense: 40, speed: 80 });
    const wins = (geared: boolean) => seeds.filter((s) => resolveColiseum(geared ? { ...a, loadout: { pvp: "pvp-arena-champion-regalia" } } : a, b, s)).length;
    assert.ok(wins(true) > wins(false), `gear should win more (off=${wins(false)}, on=${wins(true)})`);
});

test("resolveTactical: deterministic, and a clearly stronger team wins", () => {
    const strong = team("S", 2), weak = team("W", 0.5);
    assert.equal(resolveTactical(strong, weak, 7), true);
    assert.equal(resolveTactical(weak, strong, 7), false);
    assert.equal(resolveTactical(strong, weak, 99), resolveTactical(strong, weak, 99));
});

// ── offer matchmaking ─────────────────────────────────────────────────────────
const aiSummary = (i: number): OfferOpponent => ({ kind: "ai", id: `ai:${i}`, name: `AI${i}`, rank: null, summary: [] });

test("buildOffer: close-above humans first, AI fills the rest", () => {
    const order = ["a", "b", "c", "d", "e", "f"].map(entry);   // ranks 1..6
    assert.deepEqual(buildOffer(order, "d", aiSummary, 0).map((o) => o.id), ["c", "b", "a"]); // rank 4 → 3 humans
    const offB = buildOffer(order, "b", aiSummary, 0);                                        // rank 2 → 1 human + 2 AI
    assert.equal(offB[0].id, "a");
    assert.equal(offB.filter((o) => o.kind === "ai").length, 2);
    const offEmpty = buildOffer([], "z", aiSummary, 0);                                       // empty ladder → all AI
    assert.equal(offEmpty.length, OFFER_SIZE);
    assert.ok(offEmpty.every((o) => o.kind === "ai"));
});

test("canChallenge: above + within band; AI always legal", () => {
    const order = Array.from({ length: 20 }, (_, i) => entry(`p${i}`));   // ranks 1..20 (index 0..19)
    assert.equal(canChallenge(order, "p15", "p6"), true);   // 15-6 = 9 ≤ band
    assert.equal(canChallenge(order, "p15", "p4"), false);  // 15-4 = 11 > band
    assert.equal(canChallenge(order, "p5", "p9"), false);   // below you
    assert.equal(canChallenge(order, "p5", "ai:0"), true);
    assert.equal(canChallenge(order, "p5", "ai:99"), false);
    assert.ok(CLIMB_BAND === 10);
});

// ── rank swaps ────────────────────────────────────────────────────────────────
test("applyChallenge: beating a human above takes their rank", () => {
    const order = ["a", "b", "c", "d", "e"].map(entry);
    const r = applyChallenge(order, entry("d"), "b", true);   // d (rank 4) beats b (rank 2)
    assert.deepEqual(r.order.map((e) => e.slug), ["a", "d", "b", "c", "e"]);
    assert.equal(r.order[1].record.wins, 1);
    assert.equal(r.order[2].record.defeated, 1);
    assert.equal(r.notifySlug, "b");
});

test("applyChallenge: losing leaves the order intact but records the loss/defend", () => {
    const order = ["a", "b", "c"].map(entry);
    const r = applyChallenge(order, entry("c"), "a", false);
    assert.deepEqual(r.order.map((e) => e.slug), ["a", "b", "c"]);
    assert.equal(r.order.find((e) => e.slug === "c")!.record.losses, 1);
    assert.equal(r.order.find((e) => e.slug === "a")!.record.defended, 1);
});

test("applyChallenge: an unranked challenger joins only on a win", () => {
    const order = ["a", "b"].map(entry);
    assert.deepEqual(applyChallenge(order, entry("z"), "ai:0", false).order.map((e) => e.slug), ["a", "b"]);          // AI loss → not ranked
    assert.deepEqual(applyChallenge(order, entry("z"), "ai:0", true).order.map((e) => e.slug), ["a", "b", "z"]);      // AI win → inducted
    assert.deepEqual(applyChallenge(order, entry("z"), "b", true).order.map((e) => e.slug), ["a", "z", "b"]);          // beat a human → take their rank
    assert.deepEqual(applyChallenge(order, entry("z"), "b", false).order.map((e) => e.slug), ["a", "b"]);             // human loss → not ranked
});

test("a ranked bottom player losing to AI is NOT removed (edge guard)", () => {
    const order = ["a", "b", "c"].map(entry);
    const r = applyChallenge(order, entry("c"), "ai:0", false);
    assert.deepEqual(r.order.map((e) => e.slug), ["a", "b", "c"]);
    assert.equal(r.order[2].record.losses, 1);
});

// ── ownership + snapshot ────────────────────────────────────────────────────────
test("chooseOwnedLadderPets: validates ownership + preserves loadout", () => {
    const owned = [
        { id: "x1", name: "Fox", hp: 700, attack: 90, defense: 40, speed: 70, element: "Fire", loadout: { pvp: "pvp-aegis-pendant", consumable: "consum-second-wind" } },
        { id: "x2", name: "Owl", hp: 600, attack: 80, defense: 35, speed: 80, element: "Wind" },
    ];
    assert.equal(chooseOwnedLadderPets(owned, ["x1"], 1)![0].loadout?.pvp, "pvp-aegis-pendant");
    assert.equal(chooseOwnedLadderPets(owned, ["x9"], 1), null);                 // not owned
    assert.equal(chooseOwnedLadderPets(owned, ["x1", "x2"], 1), null);           // wrong count
    assert.equal(chooseOwnedLadderPets(owned, ["x1", "x1"], 2), null);           // can't pick one pet twice
    assert.equal(chooseOwnedLadderPets(owned, ["x1", "x2"], 2)!.length, 2);
});

test("snapshotLadderPet: clamps junk + keeps only known loadout slots", () => {
    const s = snapshotLadderPet({ id: "p", name: "P", hp: -5, attack: 1e9, defense: "x", speed: 50, element: "Fire", loadout: { pvp: "g", collar: "c", consumable: "k" }, jutsus: [{ name: "S", kind: "damage", power: 99, cooldown: 1 }] });
    assert.equal(s.hp, 1);                       // clamped up from -5
    assert.equal(s.attack, 100000);              // clamped down
    assert.equal(s.defense, 30);                 // junk → default
    assert.equal(s.loadout?.pvp, "g");
    assert.equal(s.loadout?.consumable, "k");
    assert.equal((s.loadout as Record<string, unknown>).collar, undefined);   // collar dropped (not combat)
    assert.equal(s.jutsus.length, 1);
});
