import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import type { HollowGateRunToken } from '../hollow-gate/_run-token.js';

// Real Tower reservation/recovery helpers and authenticated Hollow Gate settlement.
// Every save, lock and receipt belongs to this process's isolated memory store.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.VERCEL;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Character = Record<string, unknown>;
type Save = { _saveVersion: number; character: Character };
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let settle: Handler;
let entry: typeof import('./_party-entry.js');
let compensate: typeof import('./_entry-recovery.js').compensateConfirmedMissingTowerEntry;
let credits: typeof import('../hollow-gate/_external-credits.js');
let validateFloor: typeof import('../hollow-gate/_floor-manifest.js').validateHollowGateFloorManifest;

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    settle = (await import('../hollow-gate/settle.js')).default as unknown as Handler;
    entry = await import('./_party-entry.js');
    compensate = (await import('./_entry-recovery.js')).compensateConfirmedMissingTowerEntry;
    credits = await import('../hollow-gate/_external-credits.js');
    validateFloor = (await import('../hollow-gate/_floor-manifest.js')).validateHollowGateFloorManifest;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, playerName: string, body: Record<string, unknown>) {
    const session = issuePlayerToken(playerName);
    assert.ok(session);
    const response: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { response.status = status; return res; },
        json: (body: Record<string, unknown>) => { response.body = body; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', headers: { 'x-player-name': playerName, 'x-player-token': session },
        socket: { remoteAddress: '127.0.0.1' }, body: { ...body, playerName },
    } as never, res as never);
    assert.equal(response.status, 200, String(response.body?.error));
}

const endRun = (playerName: string, token: string, action: 'extract' | 'abandon') =>
    call(settle, playerName, { token, action });

for (const variant of ['direct', 'party'] as const) {
    for (const scenario of [
        { label: 'before dive, then extract', chargedBeforeDive: true, action: 'extract' },
        { label: 'before dive, then death', chargedBeforeDive: true, action: 'abandon' },
        { label: 'same checkpoint, then death', chargedBeforeDive: false, action: 'abandon' },
    ] as const) {
        test(`${variant} Tower refund charged ${scenario.label} preserves only legitimate external income`, async () => {
            const name = `towerrefund${variant}${scenario.chargedBeforeDive ? 'before' : 'same'}${scenario.action}`;
            const saveKey = `save:${name}`;
            const runId = `missing-tower-${name}`;
            const token = `hg-${name}`;
            const now = Date.now();
            const day = new Date(now).toISOString().slice(0, 10);
            let character: Character = { name, level: 20, hp: 500, maxHp: 500,
                ryo: 5000, dailyBattleDate: day, dailyBattleFloors: 3,
                battleTowerClearedFloors: [], inventory: [], itemStacks: [],
            };
            const reserve = () => variant === 'direct'
                ? entry.reserveTowerDirectEntry({ character, runId, day, floorId: 5, now })
                : entry.reserveTowerPartyEntry({ character, runId, day, floorId: 5, now, partyId: 'refund-party' });
            if (scenario.chargedBeforeDive) {
                const reserved = reserve();
                assert.equal(reserved.ok, true);
                if (!reserved.ok) return;
                assert.equal(reserved.charged, 1500);
                character = reserved.character;
            }
            const entryRyo = Number(character.ryo);
            character = credits.recordHollowGateExternalCredits(character, {
                ...character, ryo: entryRyo + 200, hollowGateRun: { runToken: token, currentFloor: 1 },
            }, 'run');
            if (!scenario.chargedBeforeDive) {
                const reserved = reserve();
                assert.equal(reserved.ok, true);
                if (!reserved.ok) return;
                assert.equal(reserved.charged, 1500);
                character = reserved.character;
            }

            const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
            let tileIndex = 20;
            for (const [kind, count] of [
                ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
                ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
            ] as const) for (let index = 0; index < count; index++) tiles[tileIndex++].kind = kind;
            tiles[136].kind = 'exit';
            tiles[148].kind = 'descend';
            const floor = validateFloor({ floor: 1, finalFloor: false, width: 15, height: 11, playerX: 1, playerY: 1, tiles });
            assert.equal(floor.ok, true);
            const run: HollowGateRunToken = {
                playerName: name, mintedAt: now - 240_000, floorDepth: 5, currentFloor: 1,
                seed: name, entryCurrencies: { ryo: entryRyo }, entryItems: {},
                offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
                rewardLedger: { currencies: { ryo: 200 }, items: {}, sourceIds: ['prepared-server-reward'] },
                position: { x: 1, y: 9 }, floorManifests: { '1': floor.manifest },
            };
            await kv.set(`hg-run:${name}:${token}`, run);
            await kv.set(saveKey, { _saveVersion: 2, character });

            const recoveryInput = { hostSlug: name, runId, ...(variant === 'party' ? { partyId: 'refund-party' } : {}) };
            assert.deepEqual(await compensate(recoveryInput), { found: true, changed: true });
            const refunded = (await kv.get<Save>(saveKey))!;
            assert.equal(refunded.character.ryo, 5200, 'the original debit is restored exactly once');
            assert.deepEqual(await compensate(recoveryInput), { found: true, changed: false });
            assert.deepEqual(await kv.get(saveKey), refunded, 'compensation replay is a no-op');
            assert.deepEqual((await kv.get<HollowGateRunToken>(`hg-run:${name}:${token}`))?.rewardLedger, run.rewardLedger,
                'Tower compensation is never a Hollow Gate run reward');

            await endRun(name, token, scenario.action);
            const after = (await kv.get<Save>(saveKey))!;
            const expected = scenario.action === 'extract' ? 5200 : 5100;
            assert.equal(after.character.ryo, expected, 'external refund survives; ordinary run income keeps its normal loss rule');
            assert.equal(Number(credits.hollowGateExternalCredits(refunded.character, token).ryo ?? 0),
                scenario.chargedBeforeDive ? 1500 : 0, 'same-checkpoint reversal must not become protected income');
            await endRun(name, token, scenario.action);
            assert.deepEqual(await kv.get(saveKey), after, 'settlement replay cannot credit or confiscate twice');
        });
    }
}

function receiptValue(character: Character): Record<string, unknown> {
    return (character.serverSettlementReceipts as Array<{ value: Record<string, unknown> }>)[0].value;
}

for (const variant of ['direct', 'party'] as const) {
    const reserve = (character: Character) => {
        const input = { character, runId: 'basis-tower', day: '2026-09-14', floorId: 5, now: 1000 };
        const result = variant === 'direct' ? entry.reserveTowerDirectEntry(input)
            : entry.reserveTowerPartyEntry({ ...input, partyId: 'basis-party' });
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error('fixture reservation refused');
        return result.character;
    };
    const refund = (character: Character) => {
        const input = { character, runId: 'basis-tower', now: 2000 };
        return variant === 'direct' ? entry.refundTowerDirectEntryReservation(input)
            : entry.refundTowerPartyEntryReservation({ ...input, partyId: 'basis-party' });
    };
    const initial = (): Character => ({ name: 'basisplayer', ryo: 5200, level: 20,
        hp: 500, maxHp: 500, hollowShards: 100, inventory: [], itemStacks: [],
        dailyBattleDate: '2026-09-14', dailyBattleFloors: 3,
        hollowGateRun: { runToken: 'basis-hollow', currentFloor: 1 },
    });

    test(`${variant} Tower refund after real Sanctify preserves the pre-checkpoint debit`, async () => {
        const character = reserve(initial());
        const name = 'basisplayer';
        const token = 'basis-hollow';
        await kv.set(`save:${name}`, { _saveVersion: 1, character });
        await kv.set(`hg-run:${name}:${token}`, {
            playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
            seed: name, entryCurrencies: { ryo: 5000, hollowShards: 100 }, entryItems: {},
            offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
            rewardLedger: { currencies: { ryo: 200 }, items: {}, sourceIds: ['earned-before-sanctify'] },
        });
        const sanctify = (await import('../hollow-gate/use-consumable.js')).default as unknown as Handler;
        await call(sanctify, name, { token, action: 'sanctify', requestId: `tower-${variant}-sanctify` });
        const checkpoint = (await kv.get<Save>(`save:${name}`))!;
        assert.equal(checkpoint.character.ryo, 3700);
        assert.equal(credits.hollowGateCreditBasis(checkpoint.character)?.checkpointVersion, 1);
        await compensate({ hostSlug: name, runId: 'basis-tower', ...(variant === 'party' ? { partyId: 'basis-party' } : {}) });
        const refunded = (await kv.get<Save>(`save:${name}`))!;
        assert.equal(credits.hollowGateExternalCredits(refunded.character, token).ryo, 1500);
        await endRun(name, token, 'abandon');
        assert.equal((await kv.get<Save>(`save:${name}`))!.character.ryo, 5200);
    });

    test(`${variant} Tower immediate refund writer retains old-run provenance without double-counting`, async () => {
        const reserved = reserve(initial());
        const nextDive = credits.recordHollowGateExternalCredits(reserved, {
            ...reserved, hollowGateRun: { runToken: 'later-hollow' },
        }, 'run');
        const refunded = refund(nextDive);
        assert.equal(refunded.ok, true);
        if (!refunded.ok) return;
        // The immediate start.ts compensation uses these same real refund and
        // persistence functions. No full Tower admission/session is simulated here.
        const { bumpSaveVersion } = await import('../save/_save-version.js');
        const { writeSaveProjected } = await import('../save/_projected-write.js');
        const current = { _saveVersion: 1, character: nextDive };
        await kv.set('save:basisplayer', current);
        await writeSaveProjected('save:basisplayer', bumpSaveVersion({ ...current, character: refunded.character }), current);
        const stored = (await kv.get<Save>('save:basisplayer'))!;
        assert.equal(stored.character.ryo, 5200);
        assert.equal(credits.hollowGateExternalCredits(stored.character, 'later-hollow').ryo, 1500);
        const retry = refund(stored.character);
        assert.equal(retry.ok, true);
        if (retry.ok) assert.equal(retry.changed, false, 'refund replay must not mint a second credit');
    });

    test(`${variant} Tower reservation replay preserves the charge basis and re-reservation refreshes it`, () => {
        const charged = reserve(initial());
        const checkpoint = credits.recordHollowGateExternalCredits(charged, charged, 'checkpoint');
        const replay = reserve(checkpoint);
        assert.equal(replay.ryo, 3700);
        assert.deepEqual(receiptValue(replay).chargedHollowGateCreditBasis, { runToken: 'basis-hollow', checkpointVersion: 0 });
        const compensated = refund(replay);
        assert.equal(compensated.ok, true);
        if (!compensated.ok) return;
        const again = reserve(compensated.character);
        assert.equal(again.ryo, 3700);
        assert.deepEqual(receiptValue(again).chargedHollowGateCreditBasis, { runToken: 'basis-hollow', checkpointVersion: 1 });
        const secondRefund = refund(again);
        assert.equal(secondRefund.ok, true);
        if (!secondRefund.ok) return;
        assert.equal(credits.hollowGateExternalCredits(secondRefund.character, 'basis-hollow').ryo, 1500,
            'only the first, pre-checkpoint debit is an external refund');
    });

    test(`${variant} Tower legacy receipts restore the wallet but cannot invent protected income`, () => {
        const charged = reserve(initial());
        delete receiptValue(charged).chargedHollowGateCreditBasis;
        const nextDive = credits.recordHollowGateExternalCredits(charged, {
            ...charged, hollowGateRun: { runToken: 'later-hollow' },
        }, 'run');
        const refunded = refund(nextDive);
        assert.equal(refunded.ok, true);
        if (!refunded.ok) return;
        assert.equal(refunded.character.ryo, 5200);
        assert.deepEqual(credits.hollowGateExternalCredits(refunded.character, 'later-hollow'), {});
        assert.equal(Object.hasOwn(receiptValue(refunded.character), 'chargedHollowGateCreditBasis'), false);
        const retry = refund(refunded.character);
        assert.equal(retry.ok, true);
        if (retry.ok) assert.equal(retry.changed, false);
    });

    test(`${variant} Tower malformed debit bases fail closed without changing the receipt or wallet`, () => {
        for (const basis of [undefined, [], 'invalid', { runToken: '', checkpointVersion: 0 },
            { runToken: 'basis-hollow', checkpointVersion: -1 },
            { runToken: 'basis-hollow', checkpointVersion: '0' },
            { runToken: 'basis-hollow', checkpointVersion: 0.5 }]) {
            const charged = reserve(initial());
            receiptValue(charged).chargedHollowGateCreditBasis = basis;
            const before = structuredClone(charged);
            assert.deepEqual(refund(charged), { ok: false, code: 'invalid-receipt' });
            const input = { character: charged, runId: 'basis-tower', day: '2026-09-14', floorId: 5, now: 2000 };
            assert.deepEqual(variant === 'direct' ? entry.reserveTowerDirectEntry(input)
                : entry.reserveTowerPartyEntry({ ...input, partyId: 'basis-party' }), { ok: false, code: 'invalid-receipt' });
            assert.deepEqual(charged, before);
        }
    });
}
