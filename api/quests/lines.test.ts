import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'quest-lines-test-secret';

/*
 * The quest-line route, end to end against the in-memory store: real auth, the
 * real save writer, and the server's own presence store deciding where the
 * player stands. The catalogue is a test one, so this file proves the plumbing
 * and the trust boundary, not any shipped quest's content.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PREFIX = 'qlineplayer';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let lines: Handler;
let setCatalogue: typeof import('./lines.js').setQuestLineCatalogueForTest;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    const mod = await import('./lines.js');
    lines = mod.default as unknown as Handler;
    setCatalogue = mod.setQuestLineCatalogueForTest;
    // stronghold-2 is the North Docks duty house; its approach tile is 100.
    setCatalogue({
        lines: {
            errand: {
                id: 'errand', series: 'test', kind: 'quest', world: 'home', tier: 1, title: 'The Errand', marks: 1, giver: 'keeper',
                gate: { level: 50 },
                stages: [
                    { key: 'report', kind: 'enter', text: 'Report to the North Docks duty house.', buildingId: 'stronghold-2' },
                    { key: 'give', kind: 'deliver', text: 'Hand over two Binding Fiber.', buildingId: 'stronghold-2', itemId: 'gather-binding-fiber', count: 2 },
                    { key: 'path', kind: 'choice', text: 'Decide how to cross.', choice: { prompt: 'How?', options: [
                        { key: 'night', label: 'By night', blurb: 'Slow and unseen.' },
                        { key: 'day', label: 'By day', blurb: 'Fast and watched.', bonusRyoPct: 100 },
                    ] } },
                ],
                rewards: { weight: 4, statPoints: 5, fateShards: 1, title: 'Dock Runner', unlocks: ['boat'] },
            },
        },
        recipes: {},
        fights: {},
    });
});

beforeEach(async () => {
    for (const pattern of [`save:${PREFIX}*`, `ratelimit:*${PREFIX}*`, 'lock:*', `ledger:currency:${PREFIX}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    setCatalogue(null);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(playerName: string, body: Record<string, unknown>, token = issuePlayerToken(playerName) ?? ''): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await lines({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: `127.7.0.${playerName.length}` },
    } as never, res as never);
    return out;
}

async function seed(playerName: string, character: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 2,
        character: { name: playerName, village: 'Stormveil Village', level: 50, ryo: 1_000, fateShards: 0, inventory: [], itemStacks: [], ...character },
    });
}

const stand = (playerName: string, sector: number, tile: number) => onlineStore.upsert({ name: playerName, sector, tile, character: null });

describe('quest lines route', () => {
    it('pays each building from its own stock once, even for competing hand-ins, and resumes from the save', async () => {
        const { roomDuties } = await import('../../shared/coast-room-duties.js');
        const { coastSite } = await import('../../shared/coast-world.js');
        const { countOwned } = await import('../craft/_forge.js');
        for (const [index, [id, duty]] of Object.entries(roomDuties).entries()) {
            assert.ok(duty);
            const player = PREFIX + 'room' + index;
            const site = coastSite(id)!;
            await seed(player, { maxHp: 1000, hp: 100, maxStamina: 100, stamina: 10, maxChakra: 100, chakra: 15 });
            const job = (command: string, extra = {}) => call(player, { action: 'room-duty', questId: id, command, ...extra });
            assert.equal((await job('take', { tick: 0 })).statusCode, 409);
            stand(player, site.sector, site.approach);
            assert.deepEqual((await job('take', { tick: 0 })).body?.progress, { tick: 1 });
            assert.equal((await job('deliver', { tick: 1, station: duty.operate })).statusCode, 409);
            assert.equal((await job('inspect', { tick: 1, station: duty.operate })).statusCode, 409);
            assert.deepEqual((await job('inspect', { tick: 1, station: duty.inspect })).body?.progress, { tick: 2 });
            assert.deepEqual((await job('sync')).body?.progress, { tick: 2 });
            const handIn = (answer: string | number) => job('deliver', { tick: 2, station: duty.operate, answer, quantity: 99999, item: 'fake' });
            assert.equal((await handIn('wrong')).statusCode, 409);
            const samples: Record<string, [string | number, string][]> = {
                'saltstair-dock-101': [[0, 'Add a shim'], [3, 'Plane off a shaving']],
                'saltstair-houses-105': [[0, 'Stir in plain stock'], [-3, 'Add brine']],
                'hushcrown-fort-148': [['Hold Hold Flash', 'first beat'], ['Flash Flash Hold', 'second beat'], ['Flash Hold Hold', 'third beat']],
            };
            for (const [sample, hint] of samples[id] ?? []) {
                const miss = await handIn(sample);
                assert.equal(miss.statusCode, 409);
                assert.ok(String(miss.body?.error).includes(hint), hint);
            }
            const answer = id === 'saltstair-dock-101' ? 2 : id === 'saltstair-houses-105' ? -2 :
                id === 'hushcrown-fort-148' ? 'Flash Hold Flash' : duty.cases[0].action;
            const replies = await Promise.all([handIn(answer), handIn(answer)]);
            assert.ok(replies.some(response => response.statusCode === 200 && response.body?.ok));
            const after = await kv.get<{ character: Record<string, unknown> }>('save:' + player);
            assert.equal(countOwned(after!.character, duty.reward.item), duty.reward.quantity);
            const replay = await handIn(answer);
            assert.deepEqual(replay.body?.progress, { tick: 3, paidTick: 3 });
            const char = replay.body?.character as Record<string, unknown>;
            assert.equal(countOwned(char, duty.reward.item), duty.reward.quantity);
            assert.equal(countOwned(char, 'fake'), 0);
            assert.equal(char.ryo, 1000);
            if (duty.reward.meal) assert.deepEqual([char.hp, char.chakra, char.stamina], [200, 25, 20]);
            assert.deepEqual((await job('sync')).body?.progress, { tick: 3, paidTick: 3 });
            assert.deepEqual((await job('take', { tick: 3 })).body?.progress, { tick: 5, order: 1 });
            assert.deepEqual((await handIn(answer)).body?.progress, { tick: 5, order: 1 });
        }
    });
    it('imports both old notes and in-flight readings without paying or overwriting character work', async () => {
        const player = PREFIX + 'oldbook', dock = 'saltstair-dock-101', kitchen = 'saltstair-houses-105';
        await seed(player);
        const sync = (site: string, legacy?: Record<string, number>) => call(player, { action: 'room-duty', command: 'sync', questId: site, legacy });
        const imported = await sync(dock, { [dock]: 7, [kitchen]: 2, fake: 99 });
        assert.deepEqual(imported.body?.progress, { tick: 7 });
        assert.deepEqual((imported.body?.character as Record<string, unknown>).itemStacks, []);
        assert.deepEqual((await sync(kitchen)).body?.progress, { tick: 2 });
        const stale = await sync(dock, { [dock]: 33 });
        assert.deepEqual(stale.body?.progress, { tick: 7 });
        assert.equal(stale.body?._saveVersion, imported.body?._saveVersion);
        assert.equal((await sync('constructor')).statusCode, 400);
    });
    it('rotates three payable orders at every building and keeps the previous result during the next shift', async () => {
        const { roomDuties, dutyAnswer } = await import('../../shared/coast-room-duties.js');
        const { coastSite } = await import('../../shared/coast-world.js');
        const { countOwned } = await import('../craft/_forge.js');
        for (const [i, [id, duty]] of Object.entries(roomDuties).entries()) {
            assert.ok(duty);
            const player = PREFIX + 'shift' + i, site = coastSite(id)!;
            await seed(player);
            const job = (command: string, tick: number, extra = {}) => call(player, { action: 'room-duty', questId: id, command, tick, ...extra });
            let tick = 0;
            for (const [index, card] of duty.cases.entries()) {
                stand(player, site.sector, site.approach);
                const taken = await job('take', tick);
                tick = index * 4 + 1;
                assert.equal((taken.body?.progress as { tick: number }).tick, tick);
                if (index > 0) {
                    const list = await call(player, { action: 'list' });
                    const book = list.body?.notebook as Record<string, { result: string; active: boolean }>;
                    assert.deepEqual(book[id], { active: true, result: duty.cases[index - 1].result });
                }
                assert.equal((await job('inspect', tick++, { station: duty.inspect })).statusCode, 200);
                const answer = dutyAnswer(card);
                const adjustments = typeof answer === 'number'
                    ? Array.from({ length: Math.abs(answer) }, (_, step) => Math.sign(answer) * (step + 1))
                    : card.fitting ? [card.fitting[0], answer]
                    : card.answer ? answer.split(' ').map((_, end, pulses) => pulses.slice(0, end + 1).join(' ')) : [];
                for (const [revision, value] of adjustments.entries()) {
                    assert.equal((await job('adjust', tick, { revision, station: duty.operate, answer: value })).statusCode, 200);
                }
                const paid = await job('deliver', tick++, { revision: adjustments.length, station: duty.operate, answer });
                assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
                assert.equal(countOwned(paid.body?.character as Record<string, unknown>, duty.reward.item), duty.reward.quantity * (index + 1));
            }
            const again = await job('take', tick);
            assert.equal((again.body?.progress as { order: number }).order, 0);
        }
    });
    it('resumes bench edits, rejects stale changes from another device and clears the bench for a fresh order', async () => {
        const site = 'saltstair-dock-101', player = PREFIX + 'shims';
        const job = (command: string, extra = {}) => call(player, { action: 'room-duty', questId: site, command, ...extra });
        await seed(player);
        stand(player, 101, 123);
        await job('sync', { legacy: { [site]: 10 } }); // Third old shift still has its original two-shim reading.
        const edit = (answer: number, revision: number) => job('adjust', { tick: 10, revision, answer, station: 'Joiner’s bench' });
        assert.equal((await edit(4, 0)).statusCode, 400);
        assert.equal((await edit(2, 0)).statusCode, 409);
        assert.equal((await job('deliver', { tick: 10, revision: 0, station: 'Joiner’s bench', answer: 2 })).statusCode, 409);
        await edit(1, 0);
        const saved = (await job('sync')).body?.progress;
        assert.deepEqual(saved, { tick: 10, bench: { tick: 10, revision: 1, value: 1 } });
        assert.equal((await job('deliver', { tick: 10, station: 'Joiner’s bench', answer: 2 })).statusCode, 409);
        assert.deepEqual((await job('sync')).body?.progress, saved);
        assert.deepEqual((await edit(-1, 0)).body?.progress, saved);
        assert.deepEqual((await job('deliver', { tick: 10, station: 'Joiner’s bench', answer: 2, revision: 0 })).body?.progress, saved);
        await edit(2, 1);
        await job('deliver', { tick: 10, station: 'Joiner’s bench', answer: 2, revision: 2 });
        await job('take', { tick: 11 });
        assert.deepEqual((await job('inspect', { tick: 13, station: 'Ferry frame' })).body?.progress, { tick: 14, order: 1 });
    });
    it('keeps the latest public watch after another worker reopens an earlier receipt', async () => {
        const site = 'brackwater-counter-118', key = 'world:coast-watch:' + site;
        const a = PREFIX + 'watcha', b = PREFIX + 'watchb';
        for (const player of [a, b]) {
            await seed(player);
            stand(player, 118, 63);
            await call(player, { action: 'room-duty', command: 'sync', questId: site, legacy: { [site]: player === a ? 2 : 6 } });
        }
        const deliver = (player: string, tick: number, answer: string) => call(player, {
            action: 'room-duty', command: 'deliver', questId: site, station: 'Signal reel', tick, answer,
        });
        assert.equal((await deliver(a, 2, 'Hoist one pennant')).statusCode, 200);
        assert.deepEqual(await kv.get(key), { order: 0 });
        assert.equal((await deliver(b, 6, 'Cross the pennants')).statusCode, 200);
        await deliver(a, 2, 'Hoist one pennant');
        assert.deepEqual(await kv.get(key), { order: 1 });
    });
    it('keeps coastal work personal, position-checked and replayable after losing a reply', async () => {
        const { COAST_JOBS } = await import('../../shared/coast-work.js');
        for (const [n, job] of COAST_JOBS.entries()) {
            const player = PREFIX + 'work' + n;
            await seed(player);
            const work = (step: number, choice = 'work') => call(player, { action: 'work', questId: job.id, step, choice });
            stand(player, 2, 12);
            assert.equal((await work(0)).statusCode, 409);
            for (const [i, step] of job.steps.entries()) {
                onlineStore.remove(player);
                stand(player, step.sector, step.tile);
                if (step.alternative) assert.equal((await work(i, 'inspect')).statusCode, 409);
                assert.deepEqual((await work(i)).body?.coastWork, { [job.id]: i + 1 });
                assert.deepEqual((await work(i)).body?.coastWork, { [job.id]: i + 1 });
            }
            assert.deepEqual((await call(player, { action: 'list' })).body?.coastWork, { [job.id]: job.steps.length });
        }
    });
    it('refuses a caller acting for someone else, an unknown action and an unknown quest', async () => {
        const player = `${PREFIX}auth`;
        await seed(player);
        assert.equal((await call(player, { action: 'accept', questId: 'errand' }, 'not-a-token')).statusCode, 401);
        // Another player's valid token is not a credential for this account.
        assert.equal((await call(player, { action: 'accept', questId: 'errand' }, issuePlayerToken(`${PREFIX}other`) ?? '')).statusCode, 401);
        assert.equal((await call(player, { action: 'grant-everything', questId: 'errand' })).statusCode, 400);
        assert.equal((await call(player, { action: 'accept', questId: 'no-such-quest' })).statusCode, 400);
    });

    it('lists quests without writing the save', async () => {
        const player = `${PREFIX}list`;
        await seed(player, { level: 49 });
        const out = await call(player, { action: 'list' });
        assert.equal(out.body?.ok, true);
        assert.equal(out.body?.marks, 0);
        const [line] = out.body?.lines as Array<Record<string, unknown>>;
        assert.deepEqual([line.id, line.state, line.reason, line.needLevel], ['errand', 'locked', 'level', 50]);
        assert.equal(out.body?._saveVersion, undefined);
        assert.equal((await kv.get<Record<string, unknown>>(`save:${player}`))?._saveVersion, 1, 'a read changes nothing');
    });

    it('runs a quest from accept to a once-only claim, deciding every step on the server', async () => {
        const player = `${PREFIX}full`;
        await seed(player, { itemStacks: [{ itemId: 'gather-binding-fiber', count: 3 }] });

        const accepted = await call(player, { action: 'accept', questId: 'errand' });
        assert.equal(accepted.body?.ok, true, JSON.stringify(accepted.body));
        assert.ok(Number(accepted.body?._saveVersion) > 1);

        // The client cannot assert where it stands: the server's presence store decides.
        const offline = await call(player, { action: 'advance', questId: 'errand', sector: 2, tile: 100, presence: { sector: 2, tile: 100 } });
        assert.deepEqual([offline.body?.ok, offline.body?.reason], [false, 'presence']);
        stand(player, 2, 30);
        assert.equal((await call(player, { action: 'advance', questId: 'errand' })).body?.reason, 'wrong-place');
        stand(player, 2, 100);
        assert.equal((await call(player, { action: 'advance', questId: 'errand' })).body?.advanced, true);

        // deliver: the fiber leaves the stored save.
        assert.equal((await call(player, { action: 'advance', questId: 'errand' })).body?.advanced, true);
        const afterDelivery = await kv.get<{ character: { itemStacks: Array<{ itemId: string; count: number }> }; questLines: { active: Record<string, { took?: boolean }> } }>(`save:${player}`);
        assert.deepEqual(afterDelivery?.character.itemStacks, [{ itemId: 'gather-binding-fiber', count: 1 }]);
        assert.equal(afterDelivery?.questLines.active.errand.took, true);
        assert.deepEqual([(await call(player, { action: 'abandon', questId: 'errand' })).body?.reason], ['committed']);

        // A client cannot claim early or skip the choice.
        assert.equal((await call(player, { action: 'claim', questId: 'errand' })).body?.reason, 'not-final');
        assert.equal((await call(player, { action: 'advance', questId: 'errand' })).body?.reason, 'choose');
        assert.equal((await call(player, { action: 'choose', questId: 'errand', optionKey: 'day' })).body?.readyToClaim, true);
        // A quest's story is told again only once it is finished.
        assert.deepEqual([(await call(player, { action: 'recall', questId: 'errand' })).body?.ok, (await call(player, { action: 'recall', questId: 'errand' })).body?.reason], [false, 'unfinished']);

        const paid = await call(player, { action: 'claim', questId: 'errand', ryo: 9_999_999, statPoints: 999 });
        assert.equal(paid.body?.ok, true, JSON.stringify(paid.body));
        // weight 4 at level 50 is 1,160 ryo, doubled by the "By day" choice.
        assert.equal(paid.body?.ryo, 2_320);
        assert.equal(paid.body?.statPoints, 5);
        assert.equal(paid.body?.marks, 1);
        const stored = await kv.get<{ character: Record<string, unknown>; questLines: { active: object; done: Record<string, { marks: number; unlocks?: string[] }> } }>(`save:${player}`);
        assert.equal(stored?.character.ryo, 3_320);
        assert.equal(stored?.character.fateShards, 1);
        assert.deepEqual(stored?.character.serverTitles, ['Dock Runner']);
        // The save writer keeps keys a new value leaves out, so a finished quest
        // is stored as an explicit null and read back as gone.
        assert.deepEqual(stored?.questLines.active, { errand: null });
        assert.deepEqual([stored?.questLines.done.errand.marks, stored?.questLines.done.errand.unlocks], [1, ['boat']]);
        const listed = (await call(player, { action: 'list' })).body?.lines as Array<Record<string, unknown>>;
        assert.equal(listed[0].state, 'done', 'a claimed quest reads as finished, not as still under way');

        // A second claim pays nothing more.
        const again = await call(player, { action: 'claim', questId: 'errand' });
        assert.deepEqual([again.body?.ok, again.body?.replayed], [true, true]);
        assert.equal((await kv.get<{ character: Record<string, unknown> }>(`save:${player}`))?.character.ryo, 3_320);
        assert.equal((await call(player, { action: 'accept', questId: 'errand' })).body?.reason, 'done', 'a finished quest never repeats');

        // Its story can be heard again, with the choice that was made, and hearing it writes nothing.
        const version = (await kv.get<Record<string, unknown>>(`save:${player}`))?._saveVersion;
        const told = await call(player, { action: 'recall', questId: 'errand' });
        assert.deepEqual([told.body?.ok, told.body?.title, told.body?.talk], [true, 'The Errand', [{ speaker: '', text: 'You chose: By day.' }]]);
        assert.deepEqual([told.body?.character, told.body?._saveVersion], [undefined, undefined]);
        assert.equal((await kv.get<Record<string, unknown>>(`save:${player}`))?._saveVersion, version);
        assert.equal((await call(player, { action: 'recall', questId: 'no-such-quest' })).statusCode, 400);
    });

    it('lets a quest with nothing spent be abandoned and taken again', async () => {
        const player = `${PREFIX}leave`;
        await seed(player);
        assert.equal((await call(player, { action: 'accept', questId: 'errand' })).body?.ok, true);
        assert.equal((await call(player, { action: 'abandon', questId: 'errand' })).body?.ok, true);
        const listed = (await call(player, { action: 'list' })).body?.lines as Array<Record<string, unknown>>;
        assert.equal(listed[0].state, 'open', 'an abandoned quest is really gone from the stored record');
        const again = await call(player, { action: 'accept', questId: 'errand' });
        assert.deepEqual([again.body?.ok, again.body?.stage], [true, 0]);
    });

    it('ignores a quest record the client tries to write through its save body', async () => {
        const player = `${PREFIX}forge`;
        await seed(player);
        // The route reads only the stored record: a forged "done" entry in the
        // request cannot open the claim.
        const forged = await call(player, { action: 'claim', questId: 'errand', questLines: { done: {}, active: { errand: { stage: 3, at: 1 } } } });
        assert.deepEqual([forged.body?.ok, forged.body?.reason], [false, 'none']);
    });
});

describe('quest lines admin tools', () => {
    const ADMIN = 'quest-lines-admin';
    before(() => { process.env.ADMIN_PASSWORD = ADMIN; });
    after(() => { delete process.env.ADMIN_PASSWORD; });
    beforeEach(async () => { await kv.del('audit:reward'); });

    async function admin(playerName: string, body: Record<string, unknown>): Promise<Out> {
        const out: Out = { statusCode: 200 };
        const res = {
            setHeader: () => res,
            status: (statusCode: number) => { out.statusCode = statusCode; return res; },
            json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
            end: () => res,
        };
        await lines({ method: 'POST', body: { playerName, ...body }, headers: { 'x-admin-password': ADMIN }, socket: { remoteAddress: '127.7.1.1' } } as never, res as never);
        return out;
    }
    const audits = async () => (await kv.get<Array<Record<string, unknown>>>('audit:reward')) ?? [];

    it('is closed to players', async () => {
        const player = `${PREFIX}nosy`;
        await seed(player);
        assert.equal((await call(player, { action: 'inspect' })).statusCode, 403);
        assert.equal((await call(player, { action: 'reset', questId: 'errand', forget: true })).statusCode, 403);
        assert.equal((await admin(player, { action: 'reset' })).statusCode, 400, 'a reset names its quest');
    });

    it('unsticks a committed quest, and says so in the audit log', async () => {
        const player = `${PREFIX}stuck`;
        await seed(player, { itemStacks: [{ itemId: 'gather-binding-fiber', count: 2 }] });
        await call(player, { action: 'accept', questId: 'errand' });
        stand(player, 2, 100);
        await call(player, { action: 'advance', questId: 'errand' });
        await call(player, { action: 'advance', questId: 'errand' });
        assert.equal((await call(player, { action: 'abandon', questId: 'errand' })).body?.reason, 'committed');

        const seen = await admin(player, { action: 'inspect' });
        assert.deepEqual([seen.body?.marks, Object.keys(seen.body?.active as object), (seen.body?.active as Record<string, { stage: number; took?: boolean }>).errand.took], [0, ['errand'], true]);
        assert.equal(seen.body?._saveVersion, undefined, 'looking writes nothing');

        const reset = await admin(player, { action: 'reset', questId: 'errand' });
        assert.deepEqual([reset.statusCode, reset.body?.cleared, reset.body?.forgot], [200, true, false]);
        const again = await call(player, { action: 'accept', questId: 'errand' });
        assert.deepEqual([again.body?.ok, again.body?.stage], [true, 0], 'the player starts it over');

        const [entry] = await audits();
        assert.deepEqual([entry.action, entry.entityId, (entry.meta as Record<string, unknown>).questId, (entry.meta as Record<string, unknown>).forget], ['quest-line.reset', player, 'errand', false]);
        assert.equal((entry.before as { active: { stage: number } }).active.stage, 2, 'the log keeps where the run stood');

        // Resetting a quest that is not under way changes nothing and logs nothing.
        await call(player, { action: 'abandon', questId: 'errand' });
        const nothing = await admin(player, { action: 'reset', questId: 'errand' });
        assert.deepEqual([nothing.body?.cleared, nothing.body?._saveVersion, (await audits()).length], [false, undefined, 1]);
    });

    it('leaves a finished quest finished unless told to forget it', async () => {
        const player = `${PREFIX}redo`;
        await seed(player);
        await kv.set(`save:${player}`, { ...(await kv.get<Record<string, unknown>>(`save:${player}`)), questLines: { v: 1, active: {}, done: { errand: { at: 5, marks: 1, unlocks: ['boat'] } } } });

        const kept = await admin(player, { action: 'reset', questId: 'errand' });
        assert.deepEqual([kept.body?.cleared, kept.body?.forgot], [false, false]);
        assert.equal(((await admin(player, { action: 'inspect' })).body?.done as Record<string, unknown>).errand !== undefined, true);

        const forgotten = await admin(player, { action: 'reset', questId: 'errand', forget: true });
        assert.deepEqual([forgotten.body?.cleared, forgotten.body?.forgot], [false, true]);
        // The save writer keeps a dropped key, so the forgotten quest is stored as null.
        assert.deepEqual((await kv.get<{ questLines: { done: object } }>(`save:${player}`))?.questLines.done, { errand: null });
        const listed = (await call(player, { action: 'list' })).body;
        assert.deepEqual([listed?.marks, (listed?.lines as Array<Record<string, unknown>>)[0].state], [0, 'open']);
        assert.equal((await call(player, { action: 'accept', questId: 'errand' })).body?.ok, true, 'and it can be done again');
        assert.equal((await audits()).length, 1);
    });
});
