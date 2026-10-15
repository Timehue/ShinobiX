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

    it('a PvP receipt past its retention stays dropped once the writer drops it', async () => {
        // embedPvpSettlementReceipt rebuilds the keyed map without entries
        // older than two days. The key-union merge used to put each one back,
        // so the map only grew until its reader failed closed at 2,048.
        const { embedPvpSettlementReceipt, inspectPvpCredit } = await import('../pvp/_reward-settlement.js');
        const name = `${PREFIX}pvpmap`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: settledCharacter(name) });
        const credit = async (id: string, now: number) => {
            const out = await mutatePlayerSave(name, ({ character }) => {
                const decision = inspectPvpCredit(character, id, `fp-${id}`);
                assert.equal(decision.fresh, true);
                return { ok: true, character: embedPvpSettlementReceipt(character, decision.receipts, id, `fp-${id}`, now), value: null };
            });
            assert.equal(out.ok, true);
        };
        const t0 = Date.now();
        await credit('pvp-settlement-old-0001', t0 - 3 * 24 * 60 * 60 * 1_000);
        await credit('pvp-settlement-new-0001', t0);
        const map = ((await kv.get<Json>(`save:${name}`))!.character as Json).pvpRewardSettlementReceipts as Json;
        assert.deepEqual(Object.keys(map), ['pvp-settlement-new-0001']);
    });

    it('the admin save path keeps PvP receipts an older posted body lacks', async () => {
        const { keepStoredPvpRewardReceipts } = await import('../pvp/_reward-settlement.js');
        const stored = { name: 'admin-edit', pvpRewardSettlementReceipts: {
            'battle-settled-before-0001': { fingerprint: 'fp-a', settledAt: 1 },
            'battle-settled-since-00001': { fingerprint: 'fp-b', settledAt: 2 },
        } };
        // The admin posts a copy read before the second battle settled.
        const posted = { name: 'admin-edit', pvpRewardSettlementReceipts: { 'battle-settled-before-0001': { fingerprint: 'fp-a', settledAt: 1 } } };
        const merged = mergePreservingImages({ character: posted }, { character: stored }) as Json;
        assert.deepEqual(Object.keys((merged.character as Json).pvpRewardSettlementReceipts as Json), ['battle-settled-before-0001'],
            'the generic merge alone now takes the posted map verbatim');
        const kept = keepStoredPvpRewardReceipts(merged.character as Json, stored);
        assert.deepEqual(kept.pvpRewardSettlementReceipts, stored.pvpRewardSettlementReceipts);
        // Nothing stored, or a body with no map: unchanged.
        assert.equal(keepStoredPvpRewardReceipts(posted, {}), posted);
        assert.deepEqual(keepStoredPvpRewardReceipts({ name: 'x' }, stored).pvpRewardSettlementReceipts, stored.pvpRewardSettlementReceipts);

        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const src = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        const start = src.indexOf('// ── Admin save path (?signal=1)');
        const end = src.indexOf("if (req.method === 'DELETE')");
        assert.ok(start >= 0 && end > start, 'admin branch located');
        const adminBranch = src.slice(start, end);
        assert.match(adminBranch, /keepStoredPvpRewardReceipts\(/, 'the admin write keeps the stored PvP receipt journal');
    });

    it('ownReceiptValue keeps only the keys a replay asks for', () => {
        // A receipt stored before the fix: its own keys plus inherited ones.
        const blended = { cooked: 2, dailyCooked: 3, dailyCap: 10, kind: 'pve-outcome', runId: 'run-1', recipe: 'other' };
        assert.deepEqual(receipts.ownReceiptValue(blended, ['cooked', 'dailyCooked', 'dailyCap']), { cooked: 2, dailyCooked: 3, dailyCap: 10 });
        // An optional key the receipt never had stays absent rather than undefined.
        assert.deepEqual(Object.keys(receipts.ownReceiptValue({ ryo: 1 }, ['ryo', 'gearDrop'])), ['ryo']);
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
