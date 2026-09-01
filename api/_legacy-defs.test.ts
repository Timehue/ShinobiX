import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    LEGACY_DEFS, LEGACY_BY_ID, EXPECTED_RARITY_COUNTS, STAT_CATEGORY, RARITY_ORDER,
    type LegacyDef, type LegacyRarity, type LegacyCategory, type LegacyStatKey,
} from './_legacy-defs.js';
import {
    mythicTitleFor, provenTitleFor, trialObjectivesFor, TRIAL_VARIANT_COUNT,
} from './_legacy-core.js';
import {
    BOOTSTRAP_CAPS, legacyBootstrapBeforeCounterIncrement, seedLegacyStatsFromSave,
} from './_legacy-track.js';
import { AI_FIGHT_SOFT_CAP_PER_DAY } from './missions/_ai-fight-reward.js';
import { DAILY_HUNT_LIMIT, DAILY_MISSION_LIMIT } from './missions/_mission-catalog.js';
import { AMBUSH_REWARDS_PER_DAY } from './sector/_wanderer-ambush.js';
import { PET_EXPEDITION_DAILY_CAP } from '../shared/pet-expedition-contract.js';

// ─── Stat liveness registry ─────────────────────────────────────────────────
// LIVE: incremented by a server settle hook (grep the bumpLegacyStats call
// sites before moving a stat here). MIRRORED: fed only by the capped
// bootstrap/daily-reconcile from client-tracked save counters. Anything in
// neither set is DEAD — usable in the LegacyStatKey type for future wiring,
// but the lint below forbids requirements or trial objectives on it.
// (Verification finding: 8 dead stats shipped in requirements, making 7/10
// mythics unobtainable and stranding village/explorer/pets trials forever.)
const LIVE_STATS: ReadonlySet<LegacyStatKey> = new Set<LegacyStatKey>([
    'pvpWins', 'pvpKills', 'pvpLosses', 'rankedWins', 'sameRankWins', 'higherLevelWins',
    // defensiveWins/sectorDefenses (defender wins) + warPvpKills (raider wins)
    // are credited by report-pvp-win from an authoritative village-guard queue
    // marker (village-guard/challenge.ts) — an ALWAYS-AVAILABLE faucet, not just
    // Kage-declared sector wars (eligibility-audit finding).
    'defensiveWins', 'comebackWins', 'bestKillStreak', 'warPvpKills',
    'ninjutsuKills', 'ninjutsuDamage', 'genjutsuKills', 'genjutsuDamage',
    'taijutsuKills', 'taijutsuDamage', 'bukijutsuKills', 'bukijutsuDamage',
    'healingDone', 'shieldsApplied', 'damageBlocked',
    'pveKills', 'eliteKills', 'missionCompletions', 'huntCompletions',
    'raidsCompleted', 'hollowGateClears', 'dungeonClears',
    'bossContribution', 'weeklyBossTop10', 'eventCompletions', 'firstClears',
    'sectorDiscoveries', 'hiddenFinds', 'wandererQuests',
    'villageDonations', 'warContribution', 'sectorCaptures', 'sectorDefenses',
    'warsWon', 'villageTenureDays', 'petDuelWins', 'petExpeditions', 'cardClashWins',
]);
const MIRRORED_STATS: ReadonlySet<LegacyStatKey> = new Set<LegacyStatKey>([
    'tilesExplored', 'endlessTowerBest', 'arenaTournaments',
]);
const STANDARD_DAILY_RATE: Partial<Record<LegacyStatKey, number>> = {
    eventCompletions: 1 / 7,
    weeklyBossTop10: 1 / 7,
    villageTenureDays: 1,
    hollowGateClears: 2,
    missionCompletions: DAILY_MISSION_LIMIT,
    pveKills: AI_FIGHT_SOFT_CAP_PER_DAY,
    huntCompletions: DAILY_HUNT_LIMIT,
    petExpeditions: PET_EXPEDITION_DAILY_CAP,
    hiddenFinds: AMBUSH_REWARDS_PER_DAY,
};

test('post-settlement mirror snapshots are rewound before first-touch bootstrap', () => {
    assert.deepEqual(
        legacyBootstrapBeforeCounterIncrement({ totalPetWins: 12, marker: 'kept' }, 'totalPetWins'),
        { totalPetWins: 11, marker: 'kept' },
    );
    assert.equal(legacyBootstrapBeforeCounterIncrement({ totalPetWins: 0 }, 'totalPetWins')?.totalPetWins, 0);
    assert.equal(legacyBootstrapBeforeCounterIncrement(null, 'totalPetWins'), null);
});

test('roster has exactly 100 legacies with the design rarity split', () => {
    assert.equal(LEGACY_DEFS.length, 100);
    const counts: Record<string, number> = {};
    for (const d of LEGACY_DEFS) counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
    assert.deepEqual(counts, EXPECTED_RARITY_COUNTS);
});

test('ids are unique kebab-case slugs and the map covers all of them', () => {
    const seen = new Set<string>();
    for (const d of LEGACY_DEFS) {
        assert.match(d.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${d.id}`);
        assert.ok(!seen.has(d.id), `duplicate id: ${d.id}`);
        seen.add(d.id);
        assert.equal(LEGACY_BY_ID.get(d.id), d);
    }
});

test('names and titles are present, distinct enough, and flavored', () => {
    const names = new Set<string>();
    for (const d of LEGACY_DEFS) {
        assert.match(d.name, /^Legacy of the /, `name shape: ${d.name}`);
        assert.ok(!names.has(d.name), `duplicate name: ${d.name}`);
        names.add(d.name);
        assert.ok(d.title.length >= 3 && d.title.length <= 32, `title length: ${d.id}`);
        assert.ok(d.flavor.length >= 20, `flavor too thin: ${d.id}`);
    }
});

test('Sage-facing Legacy flavor reads as concise witness evidence, not slogans or game UI', () => {
    const copy = LEGACY_DEFS.map((legacy) => legacy.flavor).join('\n');
    assert.doesNotMatch(copy, /[—–]/);
    assert.doesNotMatch(copy, /\b(?:health bars?|level differences?|the world remembers|the Gate whispers|the swords? (?:speaks?|listens?)|the land has been introducing itself|fires? (?:refuse|stay lit)|storms? caused|the long watch blinked|base reward)\b/i);
    for (const legacy of LEGACY_DEFS) {
        const words = legacy.flavor.trim().split(/\s+/).length;
        assert.ok(words <= 40, `${legacy.id} flavor is a lore wall (${words} words)`);
    }
});

function reqCategories(d: LegacyDef): Set<LegacyCategory> {
    const cats = new Set<LegacyCategory>();
    for (const req of d.reqs) {
        if ('stat' in req) cats.add(STAT_CATEGORY[req.stat]);
        else for (const alt of req.anyOf) cats.add(STAT_CATEGORY[alt.stat]);
    }
    return cats;
}

// Multi-proof rule: high rarity cannot be farmed off a single number.
// Mythic: >= 5 requirements spanning >= 4 stat categories.
// Legendary: >= 3 requirements spanning >= 2 stat categories.
test('multi-proof rule holds per rarity', () => {
    for (const d of LEGACY_DEFS) {
        const cats = reqCategories(d);
        if (d.rarity === 'mythic') {
            assert.ok(d.reqs.length >= 5, `mythic ${d.id} needs >=5 reqs`);
            assert.ok(cats.size >= 4, `mythic ${d.id} spans ${cats.size} categories, needs >=4`);
        } else if (d.rarity === 'legendary') {
            assert.ok(d.reqs.length >= 3, `legendary ${d.id} needs >=3 reqs`);
            assert.ok(cats.size >= 2, `legendary ${d.id} spans ${cats.size} categories, needs >=2`);
        } else if (d.rarity === 'rare') {
            assert.ok(d.reqs.length >= 2, `rare ${d.id} needs >=2 reqs`);
        } else {
            assert.ok(d.reqs.length >= 1, `basic ${d.id} needs >=1 req`);
        }
    }
});

test('same-tier identities are not strict requirement upgrades of one another', () => {
    const simple = LEGACY_DEFS.filter((definition) => definition.reqs.every((req) => 'stat' in req));
    const dominates = (easier: LegacyDef, harder: LegacyDef): boolean => {
        const harderFloors = new Map(harder.reqs.map((req) => {
            if (!('stat' in req)) throw new Error('simple requirement expected');
            return [req.stat, req.atLeast] as const;
        }));
        return easier.reqs.every((req) => {
            if (!('stat' in req)) return false;
            const harderFloor = harderFloors.get(req.stat);
            return harderFloor !== undefined && harderFloor >= req.atLeast;
        });
    };

    for (let left = 0; left < simple.length; left += 1) {
        for (let right = left + 1; right < simple.length; right += 1) {
            const a = simple[left]!;
            const b = simple[right]!;
            if (a.rarity !== b.rarity || a.category !== b.category) continue;
            assert.equal(
                dominates(a, b) || dominates(b, a),
                false,
                `${a.id} and ${b.id}: one same-tier path is only a stricter version of the other`,
            );
        }
    }
});

test('all 100 badge and wearable-title links resolve without identity collisions', () => {
    const titles = new Set<string>();
    for (const d of LEGACY_DEFS) {
        assert.equal(d.badge, d.id, `${d.id}: badge key drifted from the canonical asset slug`);
        assert.ok(
            fs.existsSync(path.join(process.cwd(), 'shinobij.client', 'public', 'badges', `legacy-${d.badge}.webp`)),
            `${d.id}: missing public badge asset legacy-${d.badge}.webp`,
        );
        for (const title of [d.title, provenTitleFor(d.title), mythicTitleFor(d.title)]) {
            assert.ok(!titles.has(title), `${d.id}: duplicate wearable title "${title}"`);
            titles.add(title);
        }
    }
    assert.equal(titles.size, LEGACY_DEFS.length * 3);
});

test('requirement breadth follows the intended basic-to-mythic effort curve', () => {
    const bands: Record<LegacyRarity, readonly [number, number]> = {
        basic: [1, 1],
        rare: [2, 2],
        legendary: [3, 5],
        mythic: [6, 8],
    };
    for (const d of LEGACY_DEFS) {
        const [min, max] = bands[d.rarity];
        assert.ok(
            d.reqs.length >= min && d.reqs.length <= max,
            `${d.rarity} ${d.id} has ${d.reqs.length} requirements; expected ${min}-${max}`,
        );
    }
});

test('a genuine level-50 villager always has an attainable basic fallback', () => {
    const stats = seedLegacyStatsFromSave({ level: 50, village: 'Ashen Leaf' }, Date.now());
    const fallback = LEGACY_BY_ID.get('village-veteran');
    assert.ok(fallback, 'village-veteran definition is missing');
    assert.equal(fallback.rarity, 'basic');
    for (const req of fallback.reqs) {
        assert.ok('stat' in req, 'the guaranteed fallback must stay a single direct proof');
        assert.ok((stats[req.stat] ?? 0) >= req.atLeast,
            `level-50 village bootstrap no longer reaches ${req.stat}:${req.atLeast}`);
    }
});

test('all requirement stats are known counters and thresholds are sane', () => {
    for (const d of LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                assert.ok(f.stat in STAT_CATEGORY, `${d.id}: unknown stat ${f.stat}`);
                assert.ok(Number.isFinite(f.atLeast) && f.atLeast > 0, `${d.id}: bad floor for ${f.stat}`);
            }
        }
    }
});

test('rarity thresholds escalate: a mythic is never cheaper than a basic on shared stats', () => {
    // For every stat used by both a basic and a mythic def, the mythic floor
    // must be strictly higher — guards against a fat-fingered "mythic for 10 kills".
    const floorByRarity = new Map<string, Map<LegacyRarity, number>>();
    for (const d of LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                let m = floorByRarity.get(f.stat);
                if (!m) floorByRarity.set(f.stat, (m = new Map()));
                const prev = m.get(d.rarity);
                m.set(d.rarity, prev === undefined ? f.atLeast : Math.min(prev, f.atLeast));
            }
        }
    }
    for (const [stat, m] of floorByRarity) {
        const basic = m.get('basic');
        const mythic = m.get('mythic');
        if (basic !== undefined && mythic !== undefined) {
            assert.ok(mythic > basic, `${stat}: mythic floor ${mythic} <= basic floor ${basic}`);
        }
    }
});

test('basic proofs stay below every higher-tier use of the same stat', () => {
    const basicFloors = new Map<LegacyStatKey, number>();
    for (const d of LEGACY_DEFS) {
        if (d.rarity !== 'basic') continue;
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const floor of floors) basicFloors.set(floor.stat, floor.atLeast);
        }
    }
    for (const d of LEGACY_DEFS) {
        if (d.rarity === 'basic') continue;
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const floor of floors) {
                const basic = basicFloors.get(floor.stat);
                if (basic !== undefined) {
                    assert.ok(floor.atLeast > basic,
                        `${d.rarity} ${d.id}: ${floor.stat}:${floor.atLeast} must exceed basic ${basic}`);
                }
            }
        }
    }
});

test('weighted primary mastery floors strictly increase between tiers', () => {
    const tiers: readonly LegacyRarity[] = ['basic', 'rare', 'legendary', 'mythic'];
    const lowerTierPrimaryMax = new Map<LegacyStatKey, number>();
    for (const tier of tiers) {
        const tierPrimaries: Array<{ def: LegacyDef; stat: LegacyStatKey; atLeast: number }> = [];
        for (const d of LEGACY_DEFS) {
            if (d.rarity !== tier) continue;
            const direct = d.reqs.filter((req): req is Extract<typeof req, { stat: LegacyStatKey }> => 'stat' in req);
            const primaryWeight = Math.max(...direct.map((req) => req.weight ?? 1));
            for (const req of direct.filter((floor) => (floor.weight ?? 1) === primaryWeight)) {
                tierPrimaries.push({ def: d, stat: req.stat, atLeast: req.atLeast });
            }
        }
        for (const primary of tierPrimaries) {
            const lower = lowerTierPrimaryMax.get(primary.stat);
            if (lower !== undefined) {
                assert.ok(primary.atLeast > lower,
                    `${tier} ${primary.def.id}: primary ${primary.stat}:${primary.atLeast} must exceed lower-tier ${lower}`);
            }
        }
        for (const primary of tierPrimaries) {
            lowerTierPrimaryMax.set(
                primary.stat,
                Math.max(lowerTierPrimaryMax.get(primary.stat) ?? 0, primary.atLeast),
            );
        }
    }
});

test('mythics are calendar-scale but remain possible within bounded earning cadences', () => {
    // Standard daily rates from the authoritative faucets. These are not an
    // estimate of player skill or total effort; they verify that every mythic
    // includes a meaningful time gate without turning one into a multi-year or
    // mathematically unreachable path.
    for (const d of LEGACY_DEFS.filter((definition) => definition.rarity === 'mythic')) {
        const gatedDays: number[] = [];
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const floor of floors) {
                const dailyRate = STANDARD_DAILY_RATE[floor.stat];
                if (dailyRate === undefined) continue;
                const days = floor.atLeast / dailyRate;
                gatedDays.push(days);
                assert.ok(days <= 365,
                    `${d.id}: ${floor.stat}:${floor.atLeast} requires ${days.toFixed(1)} standard-cadence days`);
            }
        }
        assert.ok(gatedDays.length > 0, `${d.id}: mythic has no bounded cadence proof`);
        assert.ok(Math.max(...gatedDays) >= 20,
            `${d.id}: mythic has no requirement representing at least 20 standard-cadence days`);
    }
});

test('fresh-delta trials never demand more than 30 standard days from a capped faucet', () => {
    for (const d of LEGACY_DEFS) {
        for (const kind of ['awaken', 'bind', 'prove', 'mythic'] as const) {
            for (let variant = 0; variant < TRIAL_VARIANT_COUNT; variant += 1) {
                for (const objective of trialObjectivesFor(d, kind, variant)) {
                    const dailyRate = STANDARD_DAILY_RATE[objective.stat];
                    if (dailyRate === undefined) continue;
                    const days = objective.delta / dailyRate;
                    assert.ok(days <= 30,
                        `${d.id} ${kind} v${variant}: ${objective.stat}+${objective.delta} needs ${days.toFixed(1)} standard-cadence days`);
                }
            }
        }
    }
});

test('every requirement stat has a write path (no dead-stat legacies)', () => {
    for (const d of LEGACY_DEFS) {
        for (const req of d.reqs) {
            const floors = 'stat' in req ? [req] : req.anyOf;
            for (const f of floors) {
                assert.ok(
                    LIVE_STATS.has(f.stat) || MIRRORED_STATS.has(f.stat),
                    `${d.id}: requirement on DEAD stat ${f.stat} — no hook or mirror ever writes it`,
                );
                // Mirrored stats are capped by BOOTSTRAP_CAPS forever, so a
                // floor above the cap is unreachable for everyone.
                if (MIRRORED_STATS.has(f.stat)) {
                    const cap = BOOTSTRAP_CAPS[f.stat] ?? 0;
                    assert.ok(f.atLeast <= cap,
                        `${d.id}: ${f.stat} floor ${f.atLeast} exceeds the mirror cap ${cap}`);
                }
            }
        }
    }
});

test('trial objectives only use strictly LIVE stats (mirrors move once a day at best)', () => {
    for (const d of LEGACY_DEFS) {
        for (const kind of ['awaken', 'bind', 'prove', 'mythic'] as const) {
            for (let variant = 0; variant < TRIAL_VARIANT_COUNT; variant++) {
                for (const o of trialObjectivesFor(d, kind, variant)) {
                    assert.ok(LIVE_STATS.has(o.stat),
                        `${d.id} ${kind} v${variant} trial: objective on non-live stat ${o.stat} would strand the player`);
                    assert.ok(o.delta >= 1, `${d.id} ${kind} v${variant}: zero-delta objective on ${o.stat}`);
                }
            }
        }
    }
});

test('trial variants differ, later kinds add breadth, and the client labels every trial stat', () => {
    const statsUsed = new Set<string>();
    for (const d of LEGACY_DEFS) {
        // Reroll must actually change the ask.
        const v0 = JSON.stringify(trialObjectivesFor(d, 'awaken', 0).map((o) => o.stat));
        const v1 = JSON.stringify(trialObjectivesFor(d, 'awaken', 1).map((o) => o.stat));
        assert.notEqual(v0, v1, `${d.id}: awaken variants are identical — reroll would be a no-op`);
        // Bind/prove/mythic must add breadth beyond the awaken shape, not just
        // scale it (depth-audit finding: "same objectives, bigger numbers").
        // Checked for EVERY variant — a secondary that collides with a variant's
        // primary is deduped away and would silently flatten that stage
        // (verification finding: village v1 bind lost its cross-category proof).
        for (let variant = 0; variant < TRIAL_VARIANT_COUNT; variant++) {
            const awakenCount = trialObjectivesFor(d, 'awaken', variant).length;
            assert.ok(trialObjectivesFor(d, 'bind', variant).length > awakenCount, `${d.id} v${variant}: bind adds no secondary`);
            assert.ok(trialObjectivesFor(d, 'prove', variant).length > awakenCount, `${d.id} v${variant}: prove adds no extra`);
            assert.ok(trialObjectivesFor(d, 'mythic', variant).length >= trialObjectivesFor(d, 'prove', variant).length,
                `${d.id} v${variant}: the mythic trial is not the culmination`);
        }
        for (const kind of ['awaken', 'bind', 'prove', 'mythic'] as const) {
            for (let variant = 0; variant < TRIAL_VARIANT_COUNT; variant++) {
                for (const o of trialObjectivesFor(d, kind, variant)) statsUsed.add(o.stat);
            }
        }
    }
    // Client-label drift guard: every stat a trial can surface must have a
    // human label in shinobij.client/src/lib/legacy.ts TRIAL_STAT_LABELS —
    // raw camelCase keys leaked to players (depth-audit finding). Resolved
    // from process.cwd() like the other cross-package tests (npm test runs
    // from the repo root; import.meta is unavailable under the CJS build).
    const clientLib = fs.readFileSync(
        path.join(process.cwd(), 'shinobij.client', 'src', 'lib', 'legacy.ts'),
        'utf8',
    );
    const labelsBlock = clientLib.slice(clientLib.indexOf('TRIAL_STAT_LABELS'));
    for (const stat of statsUsed) {
        assert.ok(new RegExp(`\\b${stat}\\b\\s*:`).test(labelsBlock),
            `TRIAL_STAT_LABELS (client lib/legacy.ts) is missing a label for trial stat "${stat}"`);
    }
});

test('legendary and mythic tiers cannot be fully covered by bootstrap-seeded counters', () => {
    // For every legendary+ def, at least one requirement must exceed what the
    // (client-writable) bootstrap/reconcile can ever seed for that stat.
    for (const d of LEGACY_DEFS) {
        if (RARITY_ORDER[d.rarity] < RARITY_ORDER.legendary) continue;
        const hasLiveProof = d.reqs.some((req) => {
            const floors = 'stat' in req ? [req] : req.anyOf;
            return floors.some((f) => f.atLeast > (BOOTSTRAP_CAPS[f.stat] ?? 0));
        });
        assert.ok(hasLiveProof, `${d.rarity} ${d.id}: every floor is coverable by a tampered pre-Legacy save`);
    }
});

test('village affinities only reference real villages', () => {
    const VILLAGES = new Set(['Ashen Leaf', 'Stormveil', 'Frostfang', 'Moonshadow']);
    for (const d of LEGACY_DEFS) {
        if (d.villageAffinity) assert.ok(VILLAGES.has(d.villageAffinity), `${d.id}: ${d.villageAffinity}`);
    }
});

test('no legacy uses the internal "mythic" identity category (it would leak the hidden rarity)', () => {
    // `category` is a player-facing identity facet: the codex tabs and the
    // "your <category> path is…" whispers render it verbatim. 'mythic' is an
    // internal stat-bucket label (firstClears/eventCompletions) and NOT an
    // identity — a legacy carrying it surfaces a "Mythic" tab that reveals the
    // owner-only rarity the whole system conceals (the mystery rule). Mythic-
    // RARITY legacies must live in a real category (first-flame → explorer,
    // world-awakener → pve). Rarity stays 'mythic'; only the facet moves.
    for (const d of LEGACY_DEFS) {
        assert.notEqual(d.category, 'mythic', `${d.id} must use a real identity category, not 'mythic'`);
    }
});
