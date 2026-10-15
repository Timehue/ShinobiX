import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let mutatePlayerSave: typeof import('./_mutate-player-save.js').mutatePlayerSave;
let receipts: typeof import('../_settlement-receipts.js');
let mergePreservingImages: typeof import('../_utils.js').mergePreservingImages;
let sanitizeCharacterSave: typeof import('./[name].js').sanitizeCharacterSave;
let PET_BREEDING_MIGRATION_VERSION: number;

const PREFIX = 'receiptmergeqa';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ mutatePlayerSave } = await import('./_mutate-player-save.js'));
    receipts = await import('../_settlement-receipts.js');
    ({ mergePreservingImages } = await import('../_utils.js'));
    ({ sanitizeCharacterSave } = await import('./[name].js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
});

function settledCharacter(name: string): Json {
    return {
        name,
        level: 12,
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        pets: [],
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        ryo: 50,
    };
}

async function settle(name: string, requestId: string, value: Json): Promise<void> {
    const out = await mutatePlayerSave(name, ({ character }) => {
        const inspected = receipts.inspectSettlementReceipt(character, requestId, `fp-${requestId}`);
        assert.equal(inspected.status, 'fresh');
        const next = receipts.appendSettlementReceipt(character, inspected.receipts, {
            requestId,
            fingerprint: `fp-${requestId}`,
            value,
            settledAt: Date.now(),
        });
        return { ok: true, character: next, value: null };
    });
    assert.equal(out.ok, true);
}

function storedReceipts(record: Json | null): Array<{ requestId: string; value: Json }> {
    const character = (record?.character ?? {}) as Json;
    return character[receipts.SERVER_SETTLEMENT_RECEIPTS_FIELD] as Array<{ requestId: string; value: Json }>;
}

describe('serverSettlementReceipts through the save merge', { concurrency: false }, () => {
    it('keeps each receipt value exactly as its settlement wrote it', async () => {
        const name = `${PREFIX}seq`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: settledCharacter(name) });

        // The order the world boss raid writes them: an outcome receipt, then
        // the reward receipt. A new receipt is prepended, so the generic merge
        // used to pair it by POSITION with the previous first receipt and
        // blend that receipt's value keys into it.
        await settle(name, 'pve-outcome-request-0001', { kind: 'pve-outcome', runId: 'run-1', outcome: 'win', applied: true, replayed: false });
        await settle(name, 'world-boss-reward-req-0001', { ryo: 120, xp: 40 });

        const list = storedReceipts(await kv.get<Json>(`save:${name}`));
        assert.deepEqual(list.map((r) => r.requestId), ['world-boss-reward-req-0001', 'pve-outcome-request-0001']);
        assert.deepEqual(list[0]!.value, { ryo: 120, xp: 40 }, 'the reward receipt inherits nothing from the outcome receipt');
        assert.deepEqual(list[1]!.value, { kind: 'pve-outcome', runId: 'run-1', outcome: 'win', applied: true, replayed: false });

        // A third settlement must leave both earlier receipts untouched too.
        await settle(name, 'third-settlement-req-0001', { pending: true });
        const after3 = storedReceipts(await kv.get<Json>(`save:${name}`));
        assert.deepEqual(after3.map((r) => r.value), [
            { pending: true },
            { ryo: 120, xp: 40 },
            { kind: 'pve-outcome', runId: 'run-1', outcome: 'win', applied: true, replayed: false },
        ]);
    });

    it('a mentor student receipt keeps none of the teacher receipt before it, and vice versa', async () => {
        // A player can be one sensei's student and another student's sensei.
        // Mentor receipts carry `settlementId`, not `id`, and are prepended
        // (api/clan/_mentor-settlement.ts), so the merge used to pair them by
        // position: the student receipt gained the teacher's seals/contrib/
        // clanPoints, and the next teacher receipt the student's ryo.
        const name = `${PREFIX}mentor`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: settledCharacter(name) });
        const base = (settlementId: string, role: 'teacher' | 'student') => ({
            v: 1, settlementId, role, fingerprint: `fp-${settlementId}`, senseiSlug: 'sensei',
            pairingId: 'pairing', milestones: ['academy'], appliedAt: Date.now(),
        });
        const teacher = { ...base('s1', 'teacher'), seals: 10, contrib: 2, clanPoints: { requested: 25, awarded: 25, weekKey: '2026-W42', reason: null } };
        const student = { ...base('s2', 'student'), ryo: 100 };
        const teacher2 = { ...base('s3', 'teacher'), seals: 10, contrib: 2, clanPoints: { requested: 25, awarded: 0, weekKey: '2026-W42', reason: 'cap' } };
        for (const receipt of [teacher, student, teacher2]) {
            const out = await mutatePlayerSave(name, ({ character }) => {
                const list = Array.isArray(character.mentorRewardReceipts) ? character.mentorRewardReceipts as Json[] : [];
                return { ok: true, character: { ...character, mentorRewardReceipts: [receipt, ...list] }, value: null };
            });
            assert.equal(out.ok, true);
        }
        const stored = ((await kv.get<Json>(`save:${name}`))!.character as Json).mentorRewardReceipts;
        assert.deepEqual(stored, [teacher2, student, teacher]);
    });

    it('a client autosave can neither shrink, reorder nor rewrite the stored receipts', () => {
        const stored = [
            { requestId: 'world-boss-reward-req-0001', fingerprint: 'fp-b', value: { ryo: 120 }, settledAt: 2 },
            { requestId: 'pve-outcome-request-0001', fingerprint: 'fp-a', value: { kind: 'pve-outcome' }, settledAt: 1 },
        ];
        const existing = { _saveVersion: 5, character: { ...settledCharacter('autosave'), [receipts.SERVER_SETTLEMENT_RECEIPTS_FIELD]: stored } };
        for (const forged of [
            [],
            [stored[1]],
            [{ ...stored[0], value: { ryo: 1 } }],
            [{ requestId: 'forged-request-id-0001', fingerprint: 'x', value: {}, settledAt: 3 }, ...stored],
        ]) {
            const incoming = { _saveVersion: 5, character: { ...settledCharacter('autosave'), [receipts.SERVER_SETTLEMENT_RECEIPTS_FIELD]: forged } };
            const safe = sanitizeCharacterSave(structuredClone(incoming), structuredClone(existing));
            const merged = mergePreservingImages(safe, existing) as Json;
            assert.deepEqual(storedReceipts(merged), stored);
        }
        // A payload that omits the field keeps the stored list.
        const { [receipts.SERVER_SETTLEMENT_RECEIPTS_FIELD]: _omitted, ...withoutField } = existing.character;
        const safe = sanitizeCharacterSave({ _saveVersion: 5, character: withoutField }, structuredClone(existing));
        assert.deepEqual(storedReceipts(mergePreservingImages(safe, existing) as Json), stored);
    });
});
