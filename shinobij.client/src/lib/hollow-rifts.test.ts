import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Character } from "../types/character";
import {
    RIFT_ACCEPT_MARKER, RIFT_DESCEND_MARKER, RIFT_GIVER_PREFIX,
    nextRift, synthRiftGiver, riftTargetSector, riftEventConfig,
    riftIntroEvent, riftDescentEvent, riftBySynthId, riftByDescentEventId, isRiftDescentEventId,
    riftGiverPortrait, riftBossPortrait,
} from "./hollow-rifts";
import { hollowRifts } from "../data/hollow-rifts";
import { builtinAis } from "./combat-ai";
import { CASTLE_SECTORS, OUTSKIRTS_SECTORS, MAX_WILD_SECTOR } from "../../../shared/sector-geo";
import { resolveStorywideActorImage } from "./vn-storywide-direction";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const publicAssetExists = (p: string) => existsSync(join(PUBLIC_DIR, p.replace(/^\//, "")));

function mkChar(overrides: Partial<Character>): Character {
    return { name: "Tester", level: 40, totalAiKills: 0, activeRiftQuest: null, riftCooldownUntil: 0, ...overrides } as unknown as Character;
}

test("nextRift gates on level, an active rift, and the post-clear cooldown", () => {
    const rift = hollowRifts[0];
    assert.equal(nextRift(mkChar({ level: rift.levelReq }))?.id, rift.id);
    assert.equal(nextRift(mkChar({ level: rift.levelReq - 1 })), null);              // under level
    assert.equal(nextRift(mkChar({ level: 99, activeRiftQuest: { id: rift.id, targetSector: 5, stage: "travel", baseline: 0, bossName: rift.bossName } })), null); // one at a time
    assert.equal(nextRift(mkChar({ level: 99, riftCooldownUntil: Date.now() + 60_000 })), null); // cooling down
});

test("nextRift offers a reached rift with NO upper cap (missed rifts stay doable)", () => {
    // From the intro floor up, every level has an eligible rift, and the offered
    // one is always a rift the player has reached (level >= its levelReq).
    for (let lvl = 12; lvl <= 100; lvl++) {
        const r = nextRift(mkChar({ level: lvl, name: "Cov" }));
        assert.ok(r, `level ${lvl} has an eligible rift`);
        assert.ok(lvl >= r!.levelReq, `level ${lvl} -> ${r!.id} (req ${r!.levelReq})`);
    }
    // Below the intro floor (L12) no rift is offered yet.
    assert.equal(nextRift(mkChar({ level: 11, name: "New" })), null);
    // Pre-L30, the legacy-teaching intro rift is the ONLY thing offered.
    for (let lvl = 12; lvl <= 29; lvl++) {
        assert.equal(nextRift(mkChar({ level: lvl, name: "Lo" }))?.id, "rift-legacy-echo", `level ${lvl} -> intro rift`);
    }
    // No rift caps out: a max-level player is still eligible for EVERY rift
    // (including the intro one), so a rift they out-leveled remains completable.
    assert.equal(
        hollowRifts.filter((r) => 100 >= r.levelReq).length,
        hollowRifts.length,
        "every rift is eligible at max level",
    );
    // Every rift has a positive entry floor.
    for (const r of hollowRifts) assert.ok(r.levelReq >= 1, `${r.id}: levelReq ${r.levelReq}`);
});

test("nextRift is a WORLD roll: the same day offers the same rift to every player of the same reach", () => {
    const day = 20_600 * 24 * 60 * 60 * 1000 + 5_000;
    const a = nextRift(mkChar({ level: 45, name: "aki" }), day);
    const b = nextRift(mkChar({ level: 45, name: "someone-else" }), day);
    assert.ok(a && b);
    assert.equal(a.id, b.id);
});

test("nextRift PREFERS the highest tier reached but still surfaces lower rifts", () => {
    // The day hash keys on the UTC day (never the player), so sampling many
    // consecutive days draws the weighted distribution. A level-45 player has
    // the intro (L12), the stalker (L30) and the warren (L40) in reach; margins
    // here are >5σ so the ordering can't flake regardless of which day the suite runs.
    const counts: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
        const now = (20_000 + i) * 24 * 60 * 60 * 1000 + 1;
        const id = nextRift(mkChar({ level: 45, name: "sampler" }), now)?.id ?? "none";
        counts[id] = (counts[id] ?? 0) + 1;
    }
    const warren = counts["rift-beast-warren"] ?? 0;    // top tier reached (L40)
    const stalker = counts["rift-hollow-stalker"] ?? 0;  // mid (L30)
    const legacy = counts["rift-legacy-echo"] ?? 0;      // intro (L12)
    // Strict tier preference: the nearer-to-level rift is offered more often…
    assert.ok(warren > stalker, `warren ${warren} > stalker ${stalker}`);
    assert.ok(stalker > legacy, `stalker ${stalker} > legacy ${legacy}`);
    // …yet the out-leveled intro rift still surfaces (never locked out).
    assert.ok(legacy >= 1, `intro rift still surfaces (got ${legacy})`);
});

test("rift map portraits remain valid while VN pages defer to cinematic actor routes", () => {
    for (const rift of hollowRifts) {
        const giverArt = riftGiverPortrait(rift);
        const bossArt = riftBossPortrait(rift);
        // Compact map/combat surfaces keep their square portraits.
        assert.ok(publicAssetExists(giverArt), `${rift.id}: missing giver portrait ${giverArt}`);
        assert.ok(publicAssetExists(bossArt), `${rift.id}: missing boss portrait ${bossArt}`);

        const giverCinematic = resolveStorywideActorImage(`rift-giver-${rift.slug}`, rift.giverName);
        const bossCinematic = resolveStorywideActorImage(`rift-descend-${rift.slug}`, rift.bossName);
        assert.match(giverCinematic ?? "", /^\/portraits\/cinematic\//, `${rift.id}: missing cinematic giver`);
        assert.match(bossCinematic ?? "", /^\/portraits\/cinematic\//, `${rift.id}: missing cinematic boss`);
        assert.ok(publicAssetExists(giverCinematic!), `${rift.id}: missing cinematic giver asset`);
        assert.ok(publicAssetExists(bossCinematic!), `${rift.id}: missing cinematic boss asset`);

        // VN pages deliberately carry no boxed-art override; the central
        // premium resolver binds the named actor to its transparent cutout.
        for (const page of riftIntroEvent(rift, 20, "shadow").vnPages!) {
            assert.equal(page.rightImage, undefined, `${rift.id}: intro page bypasses cinematic routing`);
        }
        for (const page of riftDescentEvent(rift, "shadow").vnPages!) {
            assert.equal(page.rightImage, undefined, `${rift.id}: descent page bypasses cinematic routing`);
        }
    }
});

test("every rift's boss AI exists in builtinAis and is a boss", () => {
    for (const rift of hollowRifts) {
        const boss = builtinAis.find((a) => a.id === rift.bossAiId);
        assert.ok(boss, `${rift.id}: boss ${rift.bossAiId} not in builtinAis`);
        assert.equal(boss!.isBossAi, true, `${rift.id}: boss must be flagged isBossAi`);
    }
});

test("riftEventConfig is a free-entry, short, themed event gate", () => {
    const rift = hollowRifts[0];
    const cfg = riftEventConfig(rift);
    assert.equal(cfg.id, rift.id);           // run.variant.id → completion hook keys off it
    assert.equal(cfg.maxFloor, rift.floors);
    assert.ok(cfg.maxFloor >= 1 && cfg.maxFloor <= 3);
    assert.equal(cfg.bossAiId, rift.bossAiId);
    assert.equal(cfg.bossName, rift.bossName);
    assert.equal(cfg.keyCost, 0);            // quest-granted, free
    assert.equal(cfg.requiresUnlock, false); // the quest is the gate
});

test("synthRiftGiver is a non-hostile roaming quest NPC", () => {
    const rift = hollowRifts[0];
    const w = synthRiftGiver(rift, 20);
    assert.equal(w.id, `${RIFT_GIVER_PREFIX}${rift.slug}`);
    assert.equal(w.verb, "quest");
    assert.equal(riftBySynthId(w.id)?.id, rift.id);
    assert.ok(w.homeTile >= 0 && w.homeTile <= 143);
});

test("riftTargetSector is deterministic, wilderness-ranged, skips safe hubs", () => {
    const skip = new Set([...OUTSKIRTS_SECTORS, ...CASTLE_SECTORS]);
    for (const p of ["Aki", "Rill", "player-two"]) {
        const s = riftTargetSector(p, "rift-hollow-stalker");
        assert.equal(s, riftTargetSector(p, "rift-hollow-stalker"));
        assert.ok(s >= 1 && s <= MAX_WILD_SECTOR && !skip.has(s));
    }
    // The range must be genuinely reachable — a stale `% 60` would otherwise
    // slip through on the three sampled names above.
    const hit = new Set<number>();
    for (let i = 0; i < 4000; i += 1) hit.add(riftTargetSector(`sweep-${i}`, "rift-hollow-stalker"));
    assert.ok(hit.has(MAX_WILD_SECTOR), "the newest sector really can host a rift");
});

test("intro names the target sector and carries the accept sentinel; descent carries the descend sentinel", () => {
    const rift = hollowRifts[0];
    const intro = riftIntroEvent(rift, 47, "shadow");
    const descent = riftDescentEvent(rift, "shadow");
    // %sector was substituted (a sector reference appears; the raw token does not).
    const introText = intro.vnPages!.flatMap((p) => p.dialogue).join(" ");
    assert.ok(introText.includes("sector 47"), "intro references the target sector");
    assert.ok(!introText.includes("%sector"), "no unsubstituted token");
    const introChoices = intro.vnPages![intro.vnPages!.length - 1].choices ?? [];
    assert.equal(introChoices.filter((c) => c.trait === RIFT_ACCEPT_MARKER).length, 1);
    const descentChoices = descent.vnPages![descent.vnPages!.length - 1].choices ?? [];
    assert.equal(descentChoices.filter((c) => c.trait === RIFT_DESCEND_MARKER).length, 1);
    assert.equal(isRiftDescentEventId(descent.id), true);
    assert.equal(riftByDescentEventId(descent.id)?.id, rift.id);
});
