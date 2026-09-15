import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { HollowGateRunToken } from './_run-token.js';

// Actual authenticated treasury and Hollow Gate handlers against isolated memory KV.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;
delete process.env.ENABLE_LEGACY;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
type Save = { _saveVersion: number; character: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let settle: Handler;
let gift: Handler;
let normalizeLedger: typeof import('./_ledger.js').normalizeHollowGateLedger;
let validateFloor: typeof import('./_floor-manifest.js').validateHollowGateFloorManifest;


before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    settle = (await import('./settle.js')).default as unknown as Handler;
    gift = (await import('../clan/treasury/transfer.js')).default as unknown as Handler;
    normalizeLedger = (await import('./_ledger.js')).normalizeHollowGateLedger;
    validateFloor = (await import('./_floor-manifest.js')).validateHollowGateFloorManifest;
});


async function call(handler: Handler, name: string, body: Record<string, unknown>): Promise<Response> {
    const token = issuePlayerToken(name);
    assert.ok(token);
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', headers: { 'x-player-name': name, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' }, body,
    } as never, res as never);
    return result;
}

async function preparedWallet(label: string) {
    const { HG_CLAWBACK_KEYS } = await import('./_run-token.js');
    const playerName = `hgcredit${label}`;
    const token = `hgtoken${label}`;
    const runKey = `hg-run:${playerName}:${token}`;
    const saveKey = `save:${playerName}`;
    const amounts = (value: number) => Object.fromEntries(HG_CLAWBACK_KEYS.map(key => [key, value]));
    const run: HollowGateRunToken = {
        playerName, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
        seed: label, entryCurrencies: amounts(1000), entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: amounts(200), items: {}, sourceIds: ['prepared-server-reward'] },
    };
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character: {
        name: playerName, level: 20, hp: 1, maxHp: 500, ...amounts(1200), bankRyo: 100,
        inventory: [], itemStacks: [], hollowGateRun: { runToken: token, currentFloor: 1 },
    } });
    const { writeVersionedPlayerSave } = await import('../save/_mutate-player-save.js');
    const external = async (amount: number) => {
        const { withKvLock } = await import('../_lock.js');
        await withKvLock(saveKey, async () => {
            const before = (await kv.get<Save>(saveKey))!;
            await writeVersionedPlayerSave(saveKey, before, { ...before.character,
                ...Object.fromEntries(HG_CLAWBACK_KEYS.map(key => [key, Number(before.character[key]) + amount])),
            });
        }, { failClosed: true });
    };
    return { playerName, token, runKey, saveKey, run, amounts, external, keys: HG_CLAWBACK_KEYS };
}

test('external credit racing abandonment is retained in either save-lock order', async () => {
    for (const creditFirst of [false, true]) {
        const f = await preparedWallet(creditFirst ? 'racecredit' : 'racesettle');
        const end = () => call(settle, f.playerName, { playerName: f.playerName, token: f.token, action: 'abandon' });
        const results = creditFirst ? await Promise.all([f.external(90), end()]) : await Promise.all([end(), f.external(90)]);
        const response = results.find(value => value !== undefined) as Response;
        assert.equal(response.status, 200, String(response.body?.error));
        const after = (await kv.get<Save>(f.saveKey))!.character;
        for (const key of f.keys) assert.equal(after[key], 1190, key);
        assert.equal(after.hollowGateExternalCredits ?? null, null);
    }
});

test('mixed parked Kage refunds preserve per-entry run/checkpoint provenance and drain once', async () => {
    const f = await preparedWallet('parkedrefund');
    const { parkKageStakeRefund, drainKageStakeRefunds } = await import('../village/_kage-inactivity.js');
    const { recordHollowGateExternalCredits, hollowGateExternalCredits } = await import('./_external-credits.js');
    const record = (await kv.get<Save>(f.saveKey))!;
    record.character = recordHollowGateExternalCredits(record.character, record.character, 'checkpoint');
    await kv.set(f.saveKey, record);
    const entries = [
        { id: 'same-basis', amount: 40, chargedHollowGateCreditBasis: { runToken: f.token, checkpointVersion: 1 } },
        { id: 'older-checkpoint', amount: 20, chargedHollowGateCreditBasis: { runToken: f.token, checkpointVersion: 0 } },
        { id: 'older-dive', amount: 30, chargedHollowGateCreditBasis: { runToken: 'old-run', checkpointVersion: 1 } },
    ];
    for (const entry of entries) await parkKageStakeRefund(f.playerName, { ...entry, village: 'Frostfang', at: Date.now() });
    assert.equal(await drainKageStakeRefunds(f.playerName), 90);
    const saved = (await kv.get<Save>(f.saveKey))!;
    assert.equal(saved.character.ryo, 1290);
    assert.deepEqual(hollowGateExternalCredits(saved.character, f.token), { ryo: 50 });
    assert.equal(await drainKageStakeRefunds(f.playerName), 0);
    assert.deepEqual(await kv.get(f.saveKey), saved);
});

test('real bank transfers preserve pre-run funds and cannot launder run loot through repeated round trips', async () => {
    const f = await preparedWallet('bank');
    const bank = (await import('../bank/transfer.js')).default as unknown as Handler;
    const move = async (action: string, amount: number, id: string) => {
        const request = { playerName: f.playerName, action, amount, requestId: `hg-bank-provenance-${id}` };
        const response = await call(bank, f.playerName, request);
        assert.equal(response.status, 200, String(response.body?.error));
        return request;
    };
    for (let cycle = 0; cycle < 3; cycle++) {
        await move('deposit', 200, `deposit${cycle}`);
        await move('withdraw', 200, `withdraw${cycle}`);
    }
    const withdrawal = await move('withdraw', 100, 'preexisting');
    assert.equal((await call(bank, f.playerName, withdrawal)).status, 200);
    const before = (await kv.get<Save>(f.saveKey))!;
    assert.equal(before.character.ryo, 1300);
    const { hollowGateExternalCredits } = await import('./_external-credits.js');
    assert.deepEqual(hollowGateExternalCredits(before.character, f.token), { ryo: 100 });
    const result = await call(settle, f.playerName, { playerName: f.playerName, token: f.token, action: 'abandon' });
    assert.equal(result.status, 200, String(result.body?.error));
    assert.equal((await kv.get<Save>(f.saveKey))!.character.ryo, 1200);
});

test('sanctify absorbs existing external credits once, including a lost commit acknowledgement', async () => {
    const f = await preparedWallet('checkpoint');
    await f.external(90);
    const consumable = (await import('./use-consumable.js')).default as unknown as Handler;
    const originalCompare = kv.compareSet.bind(kv);
    let lost = false;
    kv.compareSet = async (...args: Parameters<typeof kv.compareSet>) => {
        const committed = await originalCompare(...args);
        if (args[0] === f.saveKey && committed && !lost) { lost = true; throw new Error('test acknowledgement lost'); }
        return committed;
    };
    const request = { playerName: f.playerName, token: f.token, action: 'sanctify', requestId: 'hg-sanctify-provenance' };
    try {
        const response = await call(consumable, f.playerName, request);
        assert.equal(response.status, 200, String(response.body?.error));
        assert.equal(lost, true);
    } finally { kv.compareSet = originalCompare; }
    const { hollowGateExternalCredits } = await import('./_external-credits.js');
    const checkpoint = (await kv.get<Save>(f.saveKey))!;
    assert.deepEqual(hollowGateExternalCredits(checkpoint.character, f.token), {});
    assert.equal(checkpoint.character.hollowShards, 1276);
    assert.equal((await kv.get<HollowGateRunToken>(f.runKey))!.entryCurrencies.ryo, 1290);
    assert.equal((await call(consumable, f.playerName, request)).status, 200);
    assert.equal((await kv.get<Save>(f.saveKey))!._saveVersion, checkpoint._saveVersion);
    await f.external(20);
    const ended = await call(settle, f.playerName, { playerName: f.playerName, token: f.token, action: 'abandon' });
    assert.equal(ended.status, 200, String(ended.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!.character;
    for (const key of f.keys) assert.equal(after[key], key === 'hollowShards' ? 1296 : 1310);
});

test('trap death retains all seven external currencies and clears their provenance', async () => {
    const f = await preparedWallet('trap');
    await f.external(90);
    // A server-sealed resolved roll whose wallet commit was interrupted is
    // the existing recovery path; it bypasses only fixture floor generation.
    const nodeId = 'floor:1:tile:26';
    const sourceId = `event:1:trap:${nodeId}`;
    await kv.set(f.runKey, { ...f.run, resolvedEventIds: [sourceId] });
    await kv.set(`hg-event-roll:${f.playerName}:${f.token}:${sourceId}`, { action: 'trap', credit: {} });
    const event = (await import('./event.js')).default as unknown as Handler;
    const result = await call(event, f.playerName, { playerName: f.playerName, token: f.token, action: 'trap', nodeId });
    assert.equal(result.status, 200, String(result.body?.error));
    assert.equal(result.body?.ended, true);
    const after = (await kv.get<Save>(f.saveKey))!.character;
    for (const key of f.keys) assert.equal(after[key], 1190, key);
    assert.equal(after.hollowGateExternalCredits, null);
});

test('verified Solo PvE death retains external credits once across a lost save acknowledgement and replay', async () => {
    const f = await preparedWallet('combat');
    await f.external(90);
    const { createHollowGateCombatBinding, hollowGateCombatBindingKey } = await import('./_combat-session.js');
    const { createSoloPveSession } = await import('../solo-pve/_session.js');
    const { soloPveSessionKey } = await import('../solo-pve/_store.js');
    const binding = createHollowGateCombatBinding({ playerName: f.playerName, token: f.token, floor: 1, nodeId: 'floor:1:tile:20', kind: 'battle', runId: 'hg-credit-combat-death' });
    const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, shield: 0, statuses: [], character: { name, level: 20, stats: {}, jutsu: [], jutsuMastery: [] }, pos: 0 });
    const session = createSoloPveSession({ sessionId: binding.runId, ownerSlug: f.playerName, now: Date.now(),
        encounter: { kind: 'hollow-gate', id: 'gate', bindingId: binding.runId, sourceId: binding.enemyProfileId, metadata: { floor: 1, nodeId: binding.nodeId, combatKind: binding.kind } },
        player: fighter(f.playerName, 0), enemy: fighter('hound', 500),
    });
    session.status = 'done'; session.outcome = 'loss'; session.winner = 'enemy'; session.settlementState = 'pending';
    session.terminalEvidence = { finishedAt: Date.now(), finalMoveToken: 'prepared-terminal-proof', finalVersion: session.version, finalEventSeq: 0, winner: 'enemy', outcome: 'loss', itemsUsed: {}, settlementState: 'pending' };
    await kv.set(f.runKey, { ...f.run, activeEncounter: binding });
    await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
    await kv.set(soloPveSessionKey(binding.runId), session);
    const combat = (await import('./combat-settle.js')).default as unknown as Handler;
    const originalCompare = kv.compareSet.bind(kv);
    let lost = false;
    kv.compareSet = async (...args: Parameters<typeof kv.compareSet>) => {
        const committed = await originalCompare(...args);
        if (args[0] === f.saveKey && committed && !lost) { lost = true; throw new Error('test acknowledgement lost'); }
        return committed;
    };
    const request = { playerName: f.playerName, token: f.token, runId: binding.runId };
    try {
        const result = await call(combat, f.playerName, request);
        assert.equal(result.status, 200, String(result.body?.error));
        assert.equal(lost, true);
    } finally { kv.compareSet = originalCompare; }
    const saved = (await kv.get<Save>(f.saveKey))!;
    for (const key of f.keys) assert.equal(saved.character[key], 1190, key);
    assert.equal(saved.character.hollowGateExternalCredits, null);
    assert.equal((await call(combat, f.playerName, request)).status, 200);
    assert.deepEqual(await kv.get(f.saveKey), saved);
});

const scenarios = [
    { action: 'extract', external: true, greedyHands: 0, spend: 0 },
    { action: 'abandon', external: true, greedyHands: 0, spend: 0 },
    { action: 'abandon', external: true, greedyHands: 3, spend: 0 },
    { action: 'extract', external: false, greedyHands: 0, spend: 0 },
    { action: 'abandon', external: false, greedyHands: 0, spend: 0 },
    { action: 'abandon', external: false, greedyHands: 0, spend: 150 },
] as const;

for (const [index, scenario] of scenarios.entries()) {
    test(`issue178 ${scenario.action}: external=${scenario.external}, greedy=${scenario.greedyHands}, spending=${scenario.spend}`, async () => {
        const playerName = `hg178player${index}`;
        const founderName = `hg178founder${index}`;
        const clanName = `HG178Clan${index}`;
        const clanKey = `save:clan-hg178clan${index}`;
        const token = `HG178PreparedRun${index}`;
        const runKey = `hg-run:${playerName}:${token}`;
        const saveKey = `save:${playerName}`;
        const baseline = 1000;
        const earned = 200;
        const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
        let tileIndex = 20;
        for (const [kind, count] of [
            ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
            ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
        ] as const) {
            for (let i = 0; i < count; i++) tiles[tileIndex++].kind = kind;
        }
        tiles[136].kind = 'exit';
        tiles[148].kind = 'descend';
        const floor = validateFloor({ floor: 1, finalFloor: false, width: 15, height: 11, playerX: 1, playerY: 1, tiles });
        assert.equal(floor.ok, true);
        const run: HollowGateRunToken = {
            playerName, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
            seed: `issue178-prepared${index}`, entryCurrencies: { ryo: baseline }, entryItems: {},
            offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
            rewardLedger: { currencies: { ryo: earned }, items: {}, sourceIds: ['prepared-server-reward'] },
            position: { x: 1, y: 9 },
            floorManifests: { '1': floor.manifest },
        };
        await kv.set(runKey, run);
        await kv.set(saveKey, { _saveVersion: 1, character: {
            name: playerName, clan: clanName, level: 20, hp: 500, maxHp: 500,
            ryo: baseline + earned - scenario.spend, inventory: [], itemStacks: [],
            hollowGateAttunement: { 'greedy-hands': scenario.greedyHands },
            hollowGateRun: { runToken: token, currentFloor: 1 },
        } });
        await kv.set(`save:${founderName}`, { _saveVersion: 1, character: { name: founderName, clan: clanName, level: 20, ryo: 100 } });
        await kv.set(clanKey, { founderName, members: [{ name: founderName }, { name: playerName }], treasury: { ryo: 2000 } });

        const initialLedger = normalizeLedger(run);
        let externalCredit = 0;
        if (scenario.external) {
            const donated = await call(gift, founderName, {
                clanName, recipientName: playerName, currency: 'ryo', amount: 100,
                requestId: `issue178-external-gift-${index}`,
            });
            assert.equal(donated.status, 200, String(donated.body?.error));
            const duplicate = await call(gift, founderName, { clanName, recipientName: playerName, currency: 'ryo', amount: 100, requestId: `issue178-external-gift-${index}` });
            assert.equal(duplicate.status, 200);
            externalCredit = Number(donated.body?.amount);
            assert.equal(externalCredit, 90);
            assert.equal(donated.body?.burned, 10);
            assert.equal((await kv.get<{ treasury: { ryo: number } }>(clanKey))?.treasury.ryo, 1900);
        }
        const before = (await kv.get<Save>(saveKey))!;
        assert.equal(before.character.ryo, baseline + earned - scenario.spend + externalCredit);
        const storedRun = (await kv.get<HollowGateRunToken>(runKey))!;
        assert.deepEqual(normalizeLedger(storedRun), initialLedger, 'the external endpoint credit is not a run reward');
        const result = await call(settle, playerName, { playerName, token, action: scenario.action });
        assert.equal(result.status, 200, String(result.body?.error));
        const after = (await kv.get<Save>(saveKey))!;
        const retention = scenario.action === 'extract' ? 1 : 0.5 + scenario.greedyHands * 0.1;
        const expected = Math.min(baseline + earned - scenario.spend, baseline + Math.floor(earned * retention)) + externalCredit;
        const replay = await call(settle, playerName, { playerName, token, action: scenario.action });
        assert.equal(replay.status, 200);
        assert.equal((await kv.get<Save>(saveKey))?.character.ryo, after.character.ryo, 'settlement replay must not cause a second mutation');

        assert.equal(after.character.ryo, expected, 'a credited external gift must survive the run settlement');
        assert.equal(after.character.hollowGateExternalCredits ?? null, null, 'terminal settlement clears the run-scoped counter');
    });
}
