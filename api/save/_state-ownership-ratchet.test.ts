import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    SAVE_FIELD_CONTRACT,
    classifiedFieldSet,
    PUBLIC_CHAR_FIELDS,
    PUBLIC_TOPLEVEL_FIELDS,
    PUBLIC_COMBAT_TOPLEVEL_FIELDS,
    SHARED_ADMIN_CONTENT_FIELDS,
    COMBAT_STRIP_CHAR_FIELDS,
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS,
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS,
    SERVER_PAYOUT_CHARACTER_FIELDS,
    SERVER_OWNED_CLAN_POINT_FIELDS,
    SERVER_MIRRORED_CHARACTER_FIELDS,
    SERVER_ARRAY_LEDGER_CHARACTER_FIELDS,
    PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS,
    CURRENCY_CAPS,
    LIFETIME_COUNTERS,
    definitionsFor,
} from './_state-ownership.js';
import { combatProjection, sanitizeCharacterSave } from './[name].js';

/*
 * P0-1 ownership ratchet + drift guards.
 *
 * Purpose: a future change cannot (a) add sensitive save handling without
 * classifying the field, (b) re-introduce a shadow copy of an ownership list,
 * (c) leak a server-private field through a public projection, or (d) weaken
 * the autosave boundary through manifest drift — without a test failing.
 *
 * The ratchet is TEST-enforced, deliberately not runtime-enforced: current
 * behavior passes unknown harmless fields through the save path, and P0-1 is
 * behavior-preserving.
 */

const handlerSource = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');

// ── (a) Unclassified-field ratchet ──────────────────────────────────────────
// Every character-scope field the sanitizer/handler touches by name must have
// a manifest entry. New sensitive handling ⇒ new manifest entry, consciously.

// Local plumbing/identifier names that appear as `char.<x>` / `exChar.<x>`
// property accesses but are not save fields (or are subfields handled by a
// nested structure).
const NON_FIELD_ACCESS_ALLOWLIST = new Set([
    // structural / plumbing
    'character', 'length',
]);

describe('unclassified-field ratchet', () => {
    it('classifies every character field the save handler touches by name', () => {
        const classified = classifiedFieldSet('character');
        const touched = new Set<string>();
        const accessPattern = /\b(?:char|exChar|inChar|finalChar|fc)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
        for (const match of handlerSource.matchAll(accessPattern)) touched.add(match[1]);
        const unclassified = [...touched]
            .filter((field) => !classified.has(field) && !NON_FIELD_ACCESS_ALLOWLIST.has(field))
            .sort();
        assert.deepEqual(
            unclassified,
            [],
            'these character fields are handled in api/save/[name].ts but have no entry in the ownership manifest '
            + '(api/save/_state-ownership.ts) — classify each one (see docs/architecture/state-ownership-contract.md)',
        );
    });

    it('classifies every top-level field the sanitizer tail assigns by name', () => {
        const classified = classifiedFieldSet('top');
        // Scope the scan to sanitizeCharacterSave's output block — the region
        // between building `out` from the incoming save and returning it —
        // so unrelated local variables named `out` elsewhere don't match.
        const start = handlerSource.indexOf('{ ...incoming, character: finalChar }');
        const end = handlerSource.indexOf('return out;', start);
        assert.ok(start > 0 && end > start, 'sanitizer output block not found — update this scan');
        const tail = handlerSource.slice(start, end);
        const touched = new Set<string>();
        for (const match of tail.matchAll(/\bout\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) touched.add(match[1]);
        const unclassified = [...touched].filter((f) => !classified.has(f) && f !== 'character').sort();
        assert.deepEqual(unclassified, [], 'top-level fields assigned in the sanitizer must be classified');
    });

    it('every manifest entry has a category, domain, and unique (scope, field) identity', () => {
        const seen = new Set<string>();
        for (const def of SAVE_FIELD_CONTRACT) {
            const key = `${def.scope}:${def.field}`;
            assert.ok(!seen.has(key), `duplicate manifest entry: ${key}`);
            seen.add(key);
            assert.ok(def.category.length > 0 && def.domain.length > 0, `${key} missing category/domain`);
        }
    });
});

// ── (b) Public projections cannot leak server-private state ─────────────────

const SERVER_PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankRyo', 'stats', 'unspentStats', 'inventory', 'itemStacks',
    'equipment', 'equippedJutsuIds', 'jutsuMastery', 'pets',
    'serverSettlementReceipts', 'petRankedSettlementStamp', 'playerRankedSettlementStamp', 'vanguardRewardSettlementStamp', 'settledHollowGateCombatIds', 'hollowGateCombatSettlements',
    'soloPveCompanionSettlements', 'soloPveItemSettlements', 'aiFightRewardSettlements',
    'weeklyBossStartSettlements', 'weeklyBossUsageSettlements', 'weeklyBossPayoutSettlements', 'combatMissionClaimSettlements', 'bountySagaStamp',
    'weaponElements', 'patreon',
    'rankedRating', 'petRankedRating', 'legacy', 'serverTitles',
    'unlockedAchievements', 'claimedAchievementRewards',
    ...Object.keys(CURRENCY_CAPS),
];

describe('projection safety invariants', () => {
    it('the public character DTO never includes server-private fields', () => {
        for (const field of SERVER_PRIVATE_CHAR_FIELDS) {
            assert.ok(!PUBLIC_CHAR_FIELDS.has(field), `${field} must not be publicly projected`);
        }
    });

    it('base public reads expose zero top-level fields', () => {
        assert.deepEqual([...PUBLIC_TOPLEVEL_FIELDS], []);
    });

    it('combat-scouting reads expose only authored-content/bloodline top-level fields', () => {
        for (const field of PUBLIC_COMBAT_TOPLEVEL_FIELDS) {
            const defs = definitionsFor(field).filter((d) => d.scope === 'top');
            assert.ok(defs.length === 1, `${field} must be a classified top-level field`);
            assert.ok(
                ['shared-admin-content', 'personal-authored'].includes(defs[0].category),
                `${field} (${defs[0].category}) is not authored content — it must not join the combat-public surface`,
            );
        }
    });

    it('the shared-content projection carries only shared-admin-content fields (plus the forge-stripped creatorItems)', () => {
        for (const field of SHARED_ADMIN_CONTENT_FIELDS) {
            const defs = definitionsFor(field).filter((d) => d.scope === 'top');
            assert.equal(defs.length, 1, `${field} must be classified at top scope`);
            const ok = defs[0].category === 'shared-admin-content'
                // creatorItems is personal-authored on player saves; its shared
                // projection is safe only because stripForgedItems runs on the
                // way out — pinned by the golden-master tests.
                || (field === 'creatorItems' && defs[0].category === 'personal-authored');
            assert.ok(ok, `${field} (${defs[0].category}) must not ride the shared-content projection`);
        }
    });

    it('combat projections keep every load-bearing combat field (manifest drift guard)', () => {
        const required = ['stats', 'equipment', 'equippedJutsuIds', 'jutsuMastery', 'level',
            'maxHp', 'maxChakra', 'maxStamina', 'hp', 'chakra', 'stamina', 'specialty', 'pets'];
        const stripped = new Set(COMBAT_STRIP_CHAR_FIELDS);
        for (const field of required) {
            assert.ok(!stripped.has(field), `${field} is required by combat rendering and must not be strip-listed`);
        }
    });

    it('strips private recovery and payout ledgers from combat projections', () => {
        const projected = combatProjection({
            character: {
                name: 'ProjectionProbe',
                petRankedSettlementStamp: { forged: true },
                playerRankedSettlementStamp: { forged: true },
                vanguardRewardSettlementStamp: { forged: true },
                settledHollowGateCombatIds: ['private-run-id'],
                hollowGateCombatSettlements: [{ private: true }],
                soloPveCompanionSettlements: [{ private: true }],
                soloPveItemSettlements: [{ private: true }],
                aiFightRewardSettlements: { private: true },
                weeklyBossStartSettlements: [{ private: true }],
                weeklyBossUsageSettlements: [{ private: true }],
                weeklyBossPayoutSettlements: [{ private: true }],
                combatMissionClaimSettlements: [{ private: true }],
                bountySagaStamp: { private: true },
            },
        });
        const character = projected.character as Record<string, unknown>;
        assert.equal(character.petRankedSettlementStamp, undefined);
        assert.equal(character.playerRankedSettlementStamp, undefined);
        assert.equal(character.vanguardRewardSettlementStamp, undefined);
        assert.equal(character.settledHollowGateCombatIds, undefined);
        assert.equal(character.hollowGateCombatSettlements, undefined);
        assert.equal(character.soloPveCompanionSettlements, undefined);
        assert.equal(character.soloPveItemSettlements, undefined);
        assert.equal(character.aiFightRewardSettlements, undefined);
        assert.equal(character.weeklyBossStartSettlements, undefined);
        assert.equal(character.weeklyBossUsageSettlements, undefined);
        assert.equal(character.weeklyBossPayoutSettlements, undefined);
        assert.equal(character.combatMissionClaimSettlements, undefined);
        assert.equal(character.bountySagaStamp, undefined);
    });
});

// ── (c) Autosave boundary: manifest-driven enforcement check ────────────────
// For every field whose boundary means "stored copy wins", prove an ordinary
// autosave cannot replace it: tamper each field and assert the stored value
// survives sanitization. This is derived FROM the manifest, so classifying a
// new field into one of these boundaries automatically extends the check.

function boundaryEnforcementFixture() {
    const storedChar: Record<string, unknown> = {
        name: 'RatchetProbe', level: 10, village: 'Ember',
        stats: { strength: 20, speed: 20, intelligence: 20, willpower: 20,
            bukijutsuOffense: 20, bukijutsuDefense: 20, taijutsuOffense: 20, taijutsuDefense: 20,
            genjutsuOffense: 20, genjutsuDefense: 20, ninjutsuOffense: 20, ninjutsuDefense: 20 },
        unspentStats: 0, createdAt: 1_600_000_000_000, levelLedgerMigrated: true,
        inventory: [], itemStacks: [], equipment: {}, pets: [], jutsuMastery: [],
    };
    return storedChar;
}

// A field may sit behind several copy-wins boundaries (e.g. claimedWarCrateIds
// is both payout-copied and array-ledger-copied); keep the first probe spec per
// field so stored/tampered/expected stay consistent.
const dedupeByField = (
    specs: ReadonlyArray<{ field: string; stored: unknown; tampered: unknown }>,
): ReadonlyArray<{ field: string; stored: unknown; tampered: unknown }> => {
    const seen = new Set<string>();
    return specs.filter((s) => !seen.has(s.field) && seen.add(s.field));
};

const COPY_WINS_FIELDS = dedupeByField([
    ...ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS.map((field) => ({
        field,
        stored: field === 'patreon' ? true
            : field === 'weaponElements' || field === 'serverSettlementReceipts' || field === 'soloPveCompanionSettlements' ? { probe: 'stored' }
            : 4242,
        tampered: field === 'patreon' ? false
            : field === 'weaponElements' || field === 'serverSettlementReceipts' || field === 'soloPveCompanionSettlements' ? { probe: 'tampered' }
            : 999_999,
    })),
    ...SERVER_PAYOUT_CHARACTER_FIELDS.map((field) => ({
        field, stored: `stored-${field}`, tampered: `tampered-${field}`,
    })),
    ...SERVER_OWNED_CLAN_POINT_FIELDS.map((field) => ({
        field, stored: `stored-${field}`, tampered: `tampered-${field}`,
    })),
    // Numeric sentinels where the field is ALSO lifetime-delta-clamped after
    // the mirror copy (string sentinels would go NaN through the clamp).
    ...SERVER_MIRRORED_CHARACTER_FIELDS.map((field) => (field in LIFETIME_COUNTERS
        ? { field, stored: 777, tampered: 999_999 }
        : { field, stored: `stored-${field}`, tampered: `tampered-${field}` })),
    ...PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS.map((field) => ({
        field, stored: `stored-${field}`, tampered: `tampered-${field}`,
    })),
    ...SERVER_ARRAY_LEDGER_CHARACTER_FIELDS.map((field) => ({
        field, stored: [`stored-${field}`], tampered: [`tampered-${field}`],
    })),
]);

describe('autosave cannot replace stored-copy-wins fields (manifest-driven)', () => {
    it('re-asserts the stored value for every copy-wins boundary field', () => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        delete process.env.STRICT_RAW_SAVE_LEDGER;
        try {
            const storedChar = boundaryEnforcementFixture();
            const incomingChar = boundaryEnforcementFixture();
            for (const { field, stored, tampered } of COPY_WINS_FIELDS) {
                storedChar[field] = stored;
                incomingChar[field] = tampered;
            }
            const out = sanitizeCharacterSave(
                { character: incomingChar },
                { character: structuredClone(storedChar) },
            );
            const outChar = out.character as Record<string, unknown>;
            for (const { field, stored } of COPY_WINS_FIELDS) {
                // professionXp/professionRank interact with the profession lock;
                // storing numbers keeps their copy semantics comparable.
                assert.deepEqual(
                    outChar[field],
                    stored,
                    `ordinary autosave must not replace server-owned field "${field}"`,
                );
            }
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });

    it('prevents add, change, deletion, and stale-autosave rollback of dedicated recovery ledgers in both flag states', () => {
        const protectedFields = [
            {
                field: 'petRankedSettlementStamp',
                stored: {
                    settlementId: `pet-ranked-${'a'.repeat(48)}`,
                    fingerprint: 'pet-rating-winner',
                    rating: { field: 'petRankedRating', value: 1012, delta: 12 },
                    settledAt: 1_750_000_000_000,
                },
                forged: {
                    settlementId: `pet-ranked-${'b'.repeat(48)}`,
                    fingerprint: 'pet-rating-loser',
                    rating: { field: 'petRankedRating', value: 999999, delta: 999999 },
                    settledAt: 1,
                },
            },
            {
                field: 'playerRankedSettlementStamp',
                stored: {
                    'player-ranked-12345678-1234-4123-8123-1234567890ab': {
                        fingerprint: 'a'.repeat(64),
                        seasonId: 1,
                        role: 'winner',
                        settledAt: 1_750_000_000_000,
                        ratingAfter: 1012,
                    },
                },
                forged: {
                    'player-ranked-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': {
                        fingerprint: 'b'.repeat(64),
                        seasonId: 99,
                        role: 'winner',
                        settledAt: 1,
                        ratingAfter: 999999,
                    },
                },
            },
            {
                field: 'vanguardRewardSettlementStamp',
                stored: {
                    version: 'vanguard-reward-settlement-v1', state: 'settled',
                    ownerId: '12345678-1234-4123-8123-1234567890ab',
                    fingerprint: 'a'.repeat(64), authorityFingerprint: 'b'.repeat(64),
                    battleId: 'pvp-server', winner: 'alice', loser: 'bob',
                    expectedSaveVersion: 7, createdAt: 1_750_000_000_000,
                    settledAt: 1_750_000_000_100, recoverUntil: 1_750_604_800_100,
                    outcome: { granted: true, seals: 2, xp: 100 },
                },
                forged: {
                    version: 'vanguard-reward-settlement-v1', state: 'settled',
                    ownerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    fingerprint: 'c'.repeat(64), authorityFingerprint: 'd'.repeat(64),
                    battleId: 'pvp-forged', winner: 'alice', loser: 'mallory',
                    expectedSaveVersion: 1, createdAt: 1, settledAt: 2, recoverUntil: 3,
                    outcome: { granted: true, seals: 999999, xp: 999999 },
                },
            },
            {
                field: 'settledHollowGateCombatIds',
                stored: ['sealed-hollow-run'],
                forged: ['forged-hollow-run'],
            },
            {
                field: 'hollowGateCombatSettlements',
                stored: [{ runId: 'sealed-hollow-run', fingerprint: '0'.repeat(64) }],
                forged: [{ runId: 'forged-hollow-run', fingerprint: '9'.repeat(64) }],
            },
            {
                field: 'soloPveCompanionSettlements',
                stored: [{ sessionId: 'solo-session', fingerprint: 'a'.repeat(64), chargedAt: 1_750_000_000_000 }],
                forged: [{ sessionId: 'forged-session', fingerprint: 'b'.repeat(64), chargedAt: 1 }],
            },
            {
                field: 'soloPveItemSettlements',
                stored: [{ markerId: 'solo-session:move-1', fingerprint: 'c'.repeat(64), chargedAt: 1_750_000_000_000 }],
                forged: [{ markerId: 'forged-session:move-x', fingerprint: 'd'.repeat(64), chargedAt: 1 }],
            },
            {
                field: 'aiFightRewardSettlements',
                stored: { version: 1, receipts: [{ token: 'ServerToken', settledAt: 1_750_000_000_000 }], dailyCounts: [{ date: '2026-08-10', count: 2 }] },
                forged: { version: 1, receipts: [{ token: 'ForgedToken', settledAt: 1 }], dailyCounts: [{ date: '2026-08-10', count: 999 }] },
            },
            {
                field: 'weeklyBossStartSettlements',
                stored: [{ runId: 'weekly-server', fingerprint: 'e'.repeat(64), chargedAt: 1_750_000_000_000, recoverUntil: 1_750_007_200_000 }],
                forged: [{ runId: 'weekly-forged', fingerprint: 'f'.repeat(64), chargedAt: 1, recoverUntil: 2 }],
            },
            {
                field: 'weeklyBossUsageSettlements',
                stored: [{ runId: 'weekly-server', fingerprint: 'e'.repeat(64), damage: 10, settledAt: 1_750_000_000_000 }],
                forged: [{ runId: 'weekly-forged', fingerprint: 'f'.repeat(64), damage: 999999, settledAt: 1 }],
            },
            {
                field: 'weeklyBossPayoutSettlements',
                stored: [{ weekKey: '2027-W03', private: true }],
                forged: [{ weekKey: '2099-W99', private: false }],
            },
            {
                field: 'combatMissionClaimSettlements',
                stored: [{ version: 1, runId: 'mission-server', missionId: 'mission-1', rewardFingerprint: '1'.repeat(64), settledAt: 1_750_000_000_000, result: { completion: 'daily' } }],
                forged: [{ version: 1, runId: 'mission-forged', missionId: 'mission-1', rewardFingerprint: '2'.repeat(64), settledAt: 1, result: { completion: 'daily' } }],
            },
            {
                field: 'bountySagaStamp',
                stored: { sagaId: 'bounty-saga-1', operation: 'PLACE', settledAt: 1_750_000_000_000 },
                forged: { sagaId: 'forged-saga', operation: 'CLAIM', settledAt: 1 },
            },
        ] as const;
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        try {
            for (const strict of [undefined, '1'] as const) {
                if (strict === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
                else process.env.STRICT_RAW_SAVE_LEDGER = strict;
                for (const { field, stored, forged } of protectedFields) {
                    const baseline = boundaryEnforcementFixture();

                    const added = sanitizeCharacterSave(
                        { character: { ...structuredClone(baseline), [field]: structuredClone(forged) } },
                        { character: structuredClone(baseline) },
                    ).character as Record<string, unknown>;
                    assert.equal(added[field], undefined, `${field} cannot be client-added`);

                    const storedCharacter = { ...structuredClone(baseline), [field]: structuredClone(stored) };
                    const changed = sanitizeCharacterSave(
                        { character: { ...structuredClone(baseline), [field]: structuredClone(forged) } },
                        { character: structuredClone(storedCharacter) },
                    ).character as Record<string, unknown>;
                    assert.deepEqual(changed[field], stored, `${field} cannot be client-replaced`);

                    const deleted = sanitizeCharacterSave(
                        { character: structuredClone(baseline) },
                        { character: structuredClone(storedCharacter) },
                    ).character as Record<string, unknown>;
                    assert.deepEqual(deleted[field], stored, `${field} cannot be client-cleared`);
                }
            }
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
});

// ── (d) Manifest-internal consistency ───────────────────────────────────────

describe('boundary consistency', () => {
    it('records generic-save ryo as zero-gain regardless of the strict-ledger flag', () => {
        const [ryo] = definitionsFor('ryo').filter((def) => def.scope === 'character');
        assert.ok(ryo, 'ryo must remain classified at character scope');
        assert.equal(
            ryo.note,
            'generic saves may decrease stored ryo for legacy client sinks; every increase must come from a server domain command',
        );
    });

    it('every zero-gain currency is also strict-ledger (the flip must cover it)', () => {
        const strict = new Set(STRICT_SERVER_LEDGER_CHARACTER_FIELDS);
        for (const field of Object.keys(CURRENCY_CAPS)) {
            assert.ok(strict.has(field), `${field} must be in the strict ledger set`);
        }
    });

    it('always-ledger is a subset of strict-ledger except explicit non-numeric vault fields', () => {
        const strict = new Set(STRICT_SERVER_LEDGER_CHARACTER_FIELDS);
        const vaultOnly = new Set(['serverSettlementReceipts', 'patreon', 'weaponElements']);
        for (const field of ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS) {
            assert.ok(strict.has(field) || vaultOnly.has(field), `${field} always-ledger but not strict — reconcile`);
        }
    });
});

// ── (e) Shadow-list drift guard ─────────────────────────────────────────────
// The handler must keep deriving these boundaries from the manifest: a
// re-declared literal with one of the historical names is exactly the drift
// this refactor removed.

describe('no shadow ownership lists in the save handler', () => {
    it('does not re-declare the extracted list names as literals', () => {
        const extractedNames = [
            'PUBLIC_CHAR_FIELDS', 'PUBLIC_TOPLEVEL_FIELDS', 'PUBLIC_COMBAT_TOPLEVEL_FIELDS',
            'SHARED_ADMIN_CONTENT_FIELDS', 'COMBAT_STRIP_CHAR_FIELDS', 'COMBAT_STRIP_TOPLEVEL_FIELDS',
            'STRICT_SERVER_LEDGER_CHARACTER_FIELDS', 'ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS',
            'SERVER_PAYOUT_CHARACTER_FIELDS', 'SERVER_LEDGER_TOPLEVEL_FIELDS',
            'SERVER_OWNED_CLAN_POINT_FIELDS', 'CURRENCY_CAPS', 'LIFETIME_COUNTERS',
            'PET_IDENTITY_FIELDS', 'DAILY_CLAIM_DATE_FIELDS',
        ];
        for (const name of extractedNames) {
            assert.doesNotMatch(
                handlerSource,
                new RegExp(`const ${name}\\s*[:=]`),
                `${name} must stay derived from _state-ownership.ts, not re-declared in the handler`,
            );
        }
        assert.match(
            handlerSource,
            /from '\.\/_state-ownership\.js'/,
            'the handler must import its boundaries from the ownership manifest',
        );
    });
});
