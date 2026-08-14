/*
 * rollWanderers — the per-sector roster must be deterministic (same sector +
 * dayBucket → identical cast, so nothing flickers and a later phase could
 * re-derive it server-side), bounded, and on-grid.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollWanderers, wandererLevelFor, wandererDayBucket, wandererCount, wandererPresenceGate, isWandererOnCooldown, withWandererCooldown, WANDERER_NPC_COOLDOWN_MS, WANDERER_FLEE_COOLDOWN_MS, WANDERER_DECLINE_COOLDOWN_MS, QUEST_GIVER_PRESENCE, MAX_ROAMING_QUEST_GIVERS, pickRoamingQuestGivers, lockedWandererVerbs, lockedQuestMetrics, questForWanderer, parseWandererId, wandererRelocationSector, pruneWandererMoves, hasWandererRelocated, wanderersVisitingSector, type Wanderer } from "./wanderers";
import { MAX_WILD_SECTOR } from "../../../shared/sector-geo";

const GRID = 12;
const onGrid = (t: number) => Number.isInteger(t) && t >= 0 && t < GRID * GRID;

describe("rollWanderers", () => {
    it("is deterministic for the same (sector, dayBucket)", () => {
        const a = rollWanderers(7, 1000);
        const b = rollWanderers(7, 1000);
        assert.deepEqual(a, b);
    });

    it("varies the cast across sectors (and isn't all-empty)", () => {
        const rosters = Array.from({ length: 60 }, (_, i) => JSON.stringify(rollWanderers(i + 1, 1000)));
        assert.ok(new Set(rosters).size > 1, "rosters should differ across sectors");
        assert.ok(rosters.some(r => r !== "[]"), "at least some sectors are populated");
    });

    it("is an occasional encounter — many sectors empty, most populated have 1", () => {
        let empty = 0, total = 0, maxLen = 0;
        for (let sector = 1; sector <= 200; sector++) {
            const list = rollWanderers(sector, 5000);
            if (list.length === 0) empty++;
            total++;
            maxLen = Math.max(maxLen, list.length);
        }
        assert.ok(empty / total > 0.4, "a healthy share of sectors are empty");
        assert.ok(maxLen <= 2, "never more than 2 in a sector");
    });

    it("returns 0–2 wanderers with valid, on-grid data", () => {
        for (let sector = 1; sector <= 80; sector++) {
            for (let d = 0; d < 4; d++) {
                const list = rollWanderers(sector, 5000 + d);
                assert.ok(list.length >= 0 && list.length <= 2, `count for sector ${sector}`);
                for (const w of list) assertValidWanderer(w);
            }
        }
    });

    it("never spawns in a non-positive sector", () => {
        assert.deepEqual(rollWanderers(0, 1), []);
        assert.deepEqual(rollWanderers(-3, 1), []);
    });

    it("ids are unique within a roster", () => {
        // find a populated roster to test against
        let list: Wanderer[] = [];
        for (let s = 1; s <= 200 && list.length < 2; s++) list = rollWanderers(s, 5000);
        assert.equal(new Set(list.map(w => w.id)).size, list.length);
    });
});

describe("archetype spawn balance (2026-07 pass)", () => {
    it("no archetype dominates and the whole cast actually shows up", () => {
        // Deterministic census: every wild sector across ~10 days of windows.
        const seen = new Map<string, number>();
        let spawns = 0;
        for (let bucket = 5000; bucket < 5040; bucket++) {
            for (let sector = 1; sector <= 60; sector++) {
                for (const w of rollWanderers(sector, bucket)) {
                    seen.set(w.archetype, (seen.get(w.archetype) ?? 0) + 1);
                    spawns++;
                }
            }
        }
        const weighted = ["bandit", "gambler", "pilgrim", "beast", "sage", "merchant", "medic", "patrol", "tracker"];
        for (const id of weighted) {
            assert.ok((seen.get(id) ?? 0) > 0, `${id} never spawned in the census`);
        }
        const shares = weighted.map((id) => (seen.get(id) ?? 0) / spawns);
        assert.ok(Math.max(...shares) < 0.26, `most-common archetype capped (${Math.max(...shares).toFixed(3)})`);
        assert.ok(Math.min(...shares) > 0.05, `rarest archetype still present (${Math.min(...shares).toFixed(3)})`);
        // The spread between the most and least common face stays moderate — the
        // old 0.45-weight bandit was ~4.5× the support cast; keep it under 3.5×.
        assert.ok(Math.max(...shares) / Math.min(...shares) < 3.5, "spawn spread stays flat-ish");
    });
});

// Content-locked archetypes must never take the road, or their offer dead-ends:
// "Deal me in" walked a pre-codex player into the Card Hall's sealed wall.
describe("content-locked archetypes", () => {
    const CARD_UNLOCKED = { starterCardsClaimed: true, pets: [{}] };

    it("locks the gambler until the SCRIBE EVENT, not until you own cards", () => {
        assert.deepEqual(lockedWandererVerbs({ starterCardsClaimed: true, pets: [{}] }), []);
        assert.ok(lockedWandererVerbs({ pets: [{}] }).includes("gamble"));
        // Mirrors api/card-clash/_starter-cards.ts: only boolean true unlocks, and
        // holding cards is not the unlock.
        assert.ok(lockedWandererVerbs({ starterCardsClaimed: false, pets: [{}] }).includes("gamble"));
        assert.ok(lockedWandererVerbs(null).includes("gamble"));
    });

    it("locks the beast challenge while the pet roster is empty", () => {
        assert.ok(lockedWandererVerbs({ starterCardsClaimed: true, pets: [] }).includes("petDuel"));
        assert.ok(!lockedWandererVerbs(CARD_UNLOCKED).includes("petDuel"));
    });

    it("never rolls a locked archetype anywhere in the world", () => {
        const locked = lockedWandererVerbs({});
        let spawns = 0;
        for (let bucket = 5000; bucket < 5030; bucket++) {
            for (let sector = 1; sector <= 60; sector++) {
                for (const w of rollWanderers(sector, bucket, locked)) {
                    spawns++;
                    assert.ok(w.verb !== "gamble", `sector ${sector}: a sealed player must not meet a gambler`);
                    assert.ok(w.verb !== "petDuel", `sector ${sector}: a pet-less player must not meet a beast`);
                }
            }
        }
        assert.ok(spawns > 100, "the locked world is still populated, not emptied");
    });

    it("thins the CAST, not the roster size — locked weight is redistributed", () => {
        const locked = lockedWandererVerbs({});
        for (let bucket = 5000; bucket < 5010; bucket++) {
            for (let sector = 1; sector <= 60; sector++) {
                assert.equal(
                    rollWanderers(sector, bucket, locked).length,
                    rollWanderers(sector, bucket).length,
                    `sector ${sector}/${bucket}: a locked player meets just as many wanderers`,
                );
            }
        }
    });

    it("a relocated wanderer can't smuggle a locked archetype in the back door", () => {
        // wanderersVisitingSector re-derives the wanderer from its id, so it needs
        // the same lock the home roster got.
        const locked = lockedWandererVerbs({});
        const bucket = 5000;
        const moves: Record<string, number> = {};
        for (let sector = 1; sector <= 60; sector++) {
            for (let i = 0; i < 2; i++) moves[`w-${sector}-${bucket}-${i}`] = 7;
        }
        const visiting = wanderersVisitingSector(7, bucket, moves, {}, 1000, locked);
        assert.ok(visiting.length > 0, "the fixture should actually produce visitors");
        for (const w of visiting) {
            assert.ok(w.verb !== "gamble" && w.verb !== "petDuel", `${w.archetype} slipped through relocation`);
        }
    });

    it("never offers a quest objective the player can't progress", () => {
        // The other half of the same bug: a sage could hand a pre-codex player
        // "Win 2 Shinobi Chronicle Showdowns" — unwinnable, and it occupies their
        // one quest slot until abandoned.
        const locked = lockedQuestMetrics({});
        const sage = (id: string): Wanderer => ({
            id, name: id, archetype: "sage", verb: "quest", level: 10,
            homeTile: 30, waypoints: [30], greeting: "…", tellTint: "#fff", avatarKey: "sage",
        });
        for (let i = 0; i < 300; i++) {
            const def = questForWanderer(sage(`w-${i}-5000-0`), locked);
            assert.ok(def.metric !== "cardClashWins", `${def.id} needs a deck the player has not been given`);
            assert.ok(def.metric !== "totalPetWins", `${def.id} needs a pet the player does not have`);
        }
    });

    it("offers the whole quest catalog once nothing is locked", () => {
        const open = lockedQuestMetrics({ starterCardsClaimed: true, pets: [{}] });
        assert.deepEqual(open, []);
        const sage = (id: string): Wanderer => ({
            id, name: id, archetype: "sage", verb: "quest", level: 10,
            homeTile: 30, waypoints: [30], greeting: "…", tellTint: "#fff", avatarKey: "sage",
        });
        const metrics = new Set<string>();
        for (let i = 0; i < 300; i++) metrics.add(questForWanderer(sage(`w-${i}-5000-0`), open).metric);
        assert.ok(metrics.has("cardClashWins") && metrics.has("totalPetWins"), "unlocking restores the full catalog");
        // No lock argument must behave exactly like an empty lock list.
        assert.deepEqual(questForWanderer(sage("w-7-5000-0"), open), questForWanderer(sage("w-7-5000-0")));
    });

    it("unlocking changes who is on the road without changing how many", () => {
        const sealed = rollWanderers(12, 5000, lockedWandererVerbs({}));
        const open = rollWanderers(12, 5000, lockedWandererVerbs(CARD_UNLOCKED));
        assert.equal(sealed.length, open.length);
        assert.deepEqual(open, rollWanderers(12, 5000), "no lock === no options");
    });
});

describe("wandererPresenceGate", () => {
    it("is deterministic for the same key", () => {
        assert.equal(wandererPresenceGate("road#aki#ev1#7#5000", 0.35), wandererPresenceGate("road#aki#ev1#7#5000", 0.35));
    });
    it("passes roughly the requested fraction of sectors and reshuffles per window", () => {
        let pass = 0, flipped = 0;
        for (let sector = 1; sector <= 60; sector++) {
            for (let bucket = 5000; bucket < 5020; bucket++) {
                if (wandererPresenceGate(`road#aki#ev1#${sector}#${bucket}`, 0.35)) pass++;
            }
            if (wandererPresenceGate(`road#aki#ev1#${sector}#5000`, 0.35) !== wandererPresenceGate(`road#aki#ev1#${sector}#5001`, 0.35)) flipped++;
        }
        const rate = pass / (60 * 20);
        assert.ok(rate > 0.25 && rate < 0.45, `gate rate near 0.35 (${rate.toFixed(3)})`);
        assert.ok(flipped > 5, "blocked sectors reshuffle when the window rolls over");
    });
    it("chance bounds behave", () => {
        for (let i = 0; i < 50; i++) {
            assert.equal(wandererPresenceGate(`k${i}`, 0), false);
            assert.equal(wandererPresenceGate(`k${i}`, 1), true);
        }
    });
});

describe("wandererCount", () => {
    it("maps rng to 0/1/2 with empties common and pairs rare", () => {
        assert.equal(wandererCount(0), 0);
        assert.equal(wandererCount(0.5), 0);
        assert.equal(wandererCount(0.7), 1);
        assert.equal(wandererCount(0.95), 2);
        assert.ok(wandererCount(0.99) <= 2);
    });
    it("keeps two-wanderer sectors a rare tail (the clutter case)", () => {
        // Roll the whole 0..1 range and count how much of it lands on a pair.
        let pairs = 0;
        const steps = 1000;
        for (let i = 0; i < steps; i++) if (wandererCount(i / steps) === 2) pairs++;
        const rate = pairs / steps;
        assert.ok(rate > 0.02 && rate <= 0.08, `pairs should be a rare tail, got ${(rate * 100).toFixed(1)}%`);
    });
});

// The user-facing bug this guards: the three roaming quest-givers each ran their
// own presence gate, so their odds stacked into a crowd, and declining one did
// nothing — the same NPC was standing in the next sector you entered.
describe("roaming quest-giver density", () => {
    const giver = (id: string): Wanderer => ({
        id, name: id, archetype: "sage", verb: "quest", level: 10,
        homeTile: 30, waypoints: [30], greeting: "…", tellTint: "#fff", avatarKey: "sage",
    });

    it("keeps every rate-gated giver occasional, rift lowest", () => {
        for (const [who, rate] of Object.entries(QUEST_GIVER_PRESENCE)) {
            assert.ok(rate > 0 && rate <= 0.4, `${who} at ${rate} should be an occasional meeting`);
        }
        // The rift giver is fixed for a whole UTC day, so it must be the rarest.
        assert.ok(QUEST_GIVER_PRESENCE.rift <= QUEST_GIVER_PRESENCE.road);
        // The Chronicle Scribe gates a whole system, so she is deliberately NOT
        // rate-gated — she must not be re-added to this table (see chronicle-scribe).
        assert.ok(!("scribe" in QUEST_GIVER_PRESENCE), "the scribe is always present, never a coin flip");
    });

    it("caps a sector at one giver, in priority order", () => {
        const picked = pickRoamingQuestGivers([giver("road"), giver("rift")], {}, 1000);
        assert.equal(picked.length, MAX_ROAMING_QUEST_GIVERS);
        assert.equal(picked[0].id, "road", "the finite story beat outranks the repeatable rift offer");
    });

    it("drops a giver you turned down and promotes the next in line", () => {
        const now = 1000;
        const cooled = withWandererCooldown({}, "road", now, WANDERER_DECLINE_COOLDOWN_MS);
        const picked = pickRoamingQuestGivers([giver("road"), giver("rift")], cooled, now);
        assert.deepEqual(picked.map(w => w.id), ["rift"]);
    });

    it("leaves the sector empty when every giver is on a decline cooldown", () => {
        const now = 1000;
        let cd: Record<string, number> = {};
        for (const id of ["road", "rift"]) cd = withWandererCooldown(cd, id, now, WANDERER_DECLINE_COOLDOWN_MS);
        assert.deepEqual(pickRoamingQuestGivers([giver("road"), giver("rift")], cd, now), []);
        // …and they come back once it lifts, rather than being gone for good.
        const later = now + WANDERER_DECLINE_COOLDOWN_MS + 1;
        assert.equal(pickRoamingQuestGivers([giver("road"), giver("rift")], cd, later).length, 1);
    });

    it("declining backs a giver off longer than fleeing a bandit, but not the full anti-farm window", () => {
        assert.ok(WANDERER_DECLINE_COOLDOWN_MS > WANDERER_FLEE_COOLDOWN_MS);
        assert.ok(WANDERER_DECLINE_COOLDOWN_MS < WANDERER_NPC_COOLDOWN_MS);
    });

    it("a declined giver is absent from EVERY sector, not just the one you met it in", () => {
        // The regression: the presence gate is per-sector and deterministic, so
        // before the cooldown a declined giver simply reappeared next door.
        const now = 1000;
        const cd = withWandererCooldown({}, "rift-giver-legacy-echo", now, WANDERER_DECLINE_COOLDOWN_MS);
        for (let sector = 1; sector <= 60; sector++) {
            const present = wandererPresenceGate(`rift#aki#rift-legacy-echo#${sector}#5000`, QUEST_GIVER_PRESENCE.rift)
                ? pickRoamingQuestGivers([giver("rift-giver-legacy-echo")], cd, now)
                : [];
            assert.deepEqual(present, [], `sector ${sector} must respect the decline`);
        }
    });
});

describe("wandererLevelFor", () => {
    it("stays within [3, 95] and scales with the sector", () => {
        const rng = () => 0.5; // mid jitter → deterministic here
        assert.ok(wandererLevelFor(1, rng) >= 3);
        assert.ok(wandererLevelFor(60, rng) <= 95);
        assert.ok(wandererLevelFor(40, rng) > wandererLevelFor(5, rng));
    });
});

describe("wandererDayBucket", () => {
    it("advances every 6 hours", () => {
        const t0 = new Date("2026-06-25T00:00:00Z");
        const t5 = new Date("2026-06-25T05:59:00Z");
        const t6 = new Date("2026-06-25T06:01:00Z");
        assert.equal(wandererDayBucket(t0), wandererDayBucket(t5));
        assert.equal(wandererDayBucket(t6), wandererDayBucket(t0) + 1);
    });
});

describe("per-NPC cooldown", () => {
    it("isWandererOnCooldown is true only while the entry is in the future", () => {
        const now = 1_000_000;
        assert.equal(isWandererOnCooldown({ a: now + 1000 }, "a", now), true);
        assert.equal(isWandererOnCooldown({ a: now - 1000 }, "a", now), false);
        assert.equal(isWandererOnCooldown({ a: now + 1000 }, "b", now), false);
        assert.equal(isWandererOnCooldown(undefined, "a", now), false);
        assert.equal(isWandererOnCooldown(null, "a", now), false);
    });
    it("withWandererCooldown sets the new entry and prunes expired ones", () => {
        const now = 1_000_000;
        const next = withWandererCooldown({ stale: now - 1, live: now + 5000 }, "w1", now);
        assert.equal(next.w1, now + WANDERER_NPC_COOLDOWN_MS, "new entry cooled a few hours out");
        assert.equal(next.live, now + 5000, "still-live entry kept");
        assert.equal("stale" in next, false, "expired entry pruned");
        assert.equal(isWandererOnCooldown(next, "w1", now), true);
    });
    it("the cooldown is a few hours", () => {
        assert.ok(WANDERER_NPC_COOLDOWN_MS >= 60 * 60 * 1000 && WANDERER_NPC_COOLDOWN_MS <= 6 * 60 * 60 * 1000);
    });
    it("withWandererCooldown honours a custom (shorter) duration", () => {
        const now = 1_000_000;
        const fled = withWandererCooldown(null, "bandit", now, WANDERER_FLEE_COOLDOWN_MS);
        assert.equal(fled.bandit, now + WANDERER_FLEE_COOLDOWN_MS, "cooled for exactly the passed duration");
        assert.equal(isWandererOnCooldown(fled, "bandit", now), true, "on cooldown right after fleeing");
        assert.equal(isWandererOnCooldown(fled, "bandit", now + WANDERER_FLEE_COOLDOWN_MS + 1), false, "back after the flee window");
    });
    it("the flee back-off is short — present, but well under the anti-farm window", () => {
        assert.ok(WANDERER_FLEE_COOLDOWN_MS > 0 && WANDERER_FLEE_COOLDOWN_MS < WANDERER_NPC_COOLDOWN_MS);
    });
});

describe("wanderer relocation", () => {
    const BUCKET = 5000;
    // Find a populated sector for this bucket so we have a real wanderer id to move.
    function anyWanderer(): Wanderer {
        for (let s = 1; s <= 400; s++) {
            const list = rollWanderers(s, BUCKET);
            if (list.length) return list[0];
        }
        throw new Error("no populated sector found for the test bucket");
    }

    it("parseWandererId reads real ids and rejects merc/synthetic ones", () => {
        assert.deepEqual(parseWandererId("w-7-5000-1"), { sector: 7, dayBucket: 5000, index: 1 });
        assert.equal(parseWandererId("merc-abc-2"), null);
        assert.equal(parseWandererId("w-7-5000"), null);
        assert.equal(parseWandererId(""), null);
    });

    it("wandererRelocationSector picks a different, in-range sector deterministically", () => {
        for (let from = 1; from <= MAX_WILD_SECTOR; from++) {
            const dest = wandererRelocationSector("w-7-5000-0", from);
            assert.ok(dest >= 1 && dest <= MAX_WILD_SECTOR, `dest ${dest} in range`);
            assert.notEqual(dest, from, "never relocates to the same sector");
        }
        for (const from of [60, 61, 66]) {
            const dest = wandererRelocationSector(`w-${from}-5000-0`, from);
            assert.ok(dest >= 1 && dest <= MAX_WILD_SECTOR);
            assert.notEqual(dest, from);
        }
        // deterministic
        assert.equal(wandererRelocationSector("w-7-5000-0", 12), wandererRelocationSector("w-7-5000-0", 12));
        // hopping again from the new sector generally moves it somewhere else
        const s1 = wandererRelocationSector("w-7-5000-0", 7);
        const s2 = wandererRelocationSector("w-7-5000-0", s1);
        assert.notEqual(s2, s1);
    });

    it("hasWandererRelocated / pruneWandererMoves track and expire entries", () => {
        assert.equal(hasWandererRelocated({ "w-7-5000-0": 12 }, "w-7-5000-0"), true);
        assert.equal(hasWandererRelocated({ "w-7-5000-0": 12 }, "w-7-5000-1"), false);
        assert.equal(hasWandererRelocated(undefined, "w-7-5000-0"), false);
        // prune keeps current-bucket entries, drops stale-bucket + malformed ones
        const pruned = pruneWandererMoves({ "w-7-5000-0": 12, "w-7-4999-0": 3, "merc-x": 5 }, 5000);
        assert.deepEqual(pruned, { "w-7-5000-0": 12 });
    });

    it("wanderersVisitingSector surfaces a moved wanderer once its cooldown lifts", () => {
        const w = anyWanderer();
        const parsed = parseWandererId(w.id)!;
        const dest = parsed.sector === 60 ? 59 : 60; // any sector that isn't home
        const now = 1_000_000;
        const moves = { [w.id]: dest };

        // On cooldown → still travelling, not here yet.
        const onCd = wanderersVisitingSector(dest, BUCKET, moves, { [w.id]: now + 1000 }, now);
        assert.equal(onCd.length, 0);

        // Cooldown lifted → appears in the destination sector, same id, re-homed tile.
        const arrived = wanderersVisitingSector(dest, BUCKET, moves, {}, now);
        assert.equal(arrived.length, 1);
        assert.equal(arrived[0].id, w.id);
        assert.ok(arrived[0].homeTile >= 0 && arrived[0].homeTile < 144);

        // Not shown in a sector it didn't move to, nor against a stale window.
        assert.equal(wanderersVisitingSector(dest + 1 <= 60 ? dest + 1 : 1, BUCKET, moves, {}, now).length, 0);
        assert.equal(wanderersVisitingSector(dest, BUCKET + 1, moves, {}, now).length, 0);
    });
});

function assertValidWanderer(w: Wanderer): void {
    assert.ok(w.name.length > 0);
    assert.ok(["attack", "gift", "gamble", "petDuel", "quest", "merchant", "medic", "patrol", "tracker"].includes(w.verb));
    assert.ok(["bandit", "gambler", "pilgrim", "beast", "sage", "merchant", "medic", "patrol", "tracker"].includes(w.archetype));
    assert.ok(w.level >= 3 && w.level <= 95);
    assert.ok(onGrid(w.homeTile), `home ${w.homeTile}`);
    assert.ok(w.waypoints.length >= 1 && w.waypoints.every(onGrid), "waypoints on grid");
    assert.ok(w.greeting.length > 0);
    assert.ok(/^#/.test(w.tellTint));
    // natural attacker-archetype invariant: bandits attack, others do not
    assert.equal(w.verb === "attack", w.archetype === "bandit");
}
