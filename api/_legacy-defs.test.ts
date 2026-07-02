import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    LEGACY_DEFS, LEGACY_BY_ID, EXPECTED_RARITY_COUNTS, STAT_CATEGORY, RARITY_ORDER,
    type LegacyDef, type LegacyRarity, type LegacyCategory, type LegacyStatKey,
} from './_legacy-defs.js';
import { trialObjectivesFor, TRIAL_VARIANT_COUNT } from './_legacy-core.js';
import { BOOTSTRAP_CAPS } from './_legacy-track.js';

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
    'warsWon', 'villageTenureDays', 'petExpeditions', 'cardClashWins',
]);
const MIRRORED_STATS: ReadonlySet<LegacyStatKey> = new Set<LegacyStatKey>([
    'tilesExplored', 'petDuelWins', 'endlessTowerBest', 'arenaTournaments',
]);

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
