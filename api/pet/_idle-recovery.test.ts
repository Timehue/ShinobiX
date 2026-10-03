import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-idle-recovery-memory-only';
delete process.env.SESSION_SECRET;

/*
 * Every pet write to a save keeps the idle recovery the player earned since
 * their last save.
 *
 * mutatePlayerSave credits the HP, chakra and stamina recovered since the
 * regeneration cursor before it writes, and carries the cursor forward. These
 * routes ran the same owned-pet migration and breeding settle under their own
 * save lock but skipped that step, so each write fenced the cursor to "now"
 * and threw the recovery away. Each step below first leaves the save untouched
 * for 30 s at HP 10/100, chakra 20/100 and stamina 0/100, then drives the real
 * code and checks that the recovery and the carried cursor survived.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };
type Route = 'start' | 'status' | 'hatch' | 'sanctuary';

let kv: typeof import('../_storage.js').kv;
let createOwnedPet: typeof import('./_owned-pet.js').createOwnedPet;
let settleShowdownWin: typeof import('./showdown.js').settleShowdownWin;
let createShowdownSession: typeof import('../_pet-showdown/engine.js').createShowdownSession;
const handlers = {} as Record<Route, Handler>;

const PLAYER = 'petrester';
let tiredAt = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ createOwnedPet } = await import('./_owned-pet.js'));
    ({ settleShowdownWin } = await import('./showdown.js'));
    ({ createShowdownSession } = await import('../_pet-showdown/engine.js'));
    handlers.start = (await import('./breeding-start.js')).default as unknown as Handler;
    handlers.status = (await import('./breeding-status.js')).default as unknown as Handler;
    handlers.hatch = (await import('./breeding-hatch.js')).default as unknown as Handler;
    handlers.sanctuary = (await import('./sanctuary-transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

async function call(route: Route, request: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> }): Promise<Reply> {
    const output: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { output.status = n; return res; },
        json(payload: Record<string, any>) { output.body = payload; return res; },
        end() { return res; },
    };
    await handlers[route]({
        method: request.method ?? 'POST',
        body: request.body ?? {},
        query: request.query ?? {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res as never);
    return output;
}

/** A breedable companion, old enough to breed. */
function companion(templateId: string): Record<string, unknown> {
    return { ...createOwnedPet(templateId, { origin: 'wild' }), level: 50 };
}

async function seed(pets: Array<Record<string, unknown>>): Promise<void> {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, level: 60, ryo: 0, pets } });
}

async function editCharacter(edit: (character: Record<string, any>) => Record<string, any>): Promise<void> {
    const record = (await kv.get<Record<string, any>>(`save:${PLAYER}`))!;
    await kv.set(`save:${PLAYER}`, { ...record, character: edit(record.character) });
}

/** Leave the save untouched for 30 s, tired enough to show any recovery. */
async function tire(): Promise<void> {
    tiredAt = Date.now() - 30_000;
    await editCharacter((character) => ({
        ...character, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
    }));
    const record = (await kv.get<Record<string, any>>(`save:${PLAYER}`))!;
    await kv.set(`save:${PLAYER}`, { ...record, _saveAt: tiredAt, _regenAt: tiredAt });
}

/** The saved character, after asserting it kept the recovery and the cursor. */
async function recovered(): Promise<Record<string, any>> {
    const saved = (await kv.get<Record<string, any>>(`save:${PLAYER}`))!;
    const character = saved.character;
    assert.ok(character.hp >= 40, `hp ${character.hp} lost the idle recovery`);
    assert.ok(character.chakra >= 50, `chakra ${character.chakra} lost the idle recovery`);
    assert.ok(character.stamina >= 30, `stamina ${character.stamina} lost the idle recovery`);
    // None of these writes moves a vital, so each carries the settled cursor:
    // whole ticks from where it was, never the write's own instant.
    const cursor = Number(saved._regenAt);
    assert.ok(cursor >= tiredAt + 30_000 - 1_000, `cursor ${cursor} fell behind the recovery`);
    assert.equal((cursor - tiredAt) % 1_000, 0, `cursor ${cursor} was fenced to the write, not carried`);
    return character;
}

describe('pet writes keep the idle recovery a player earned', { concurrency: false }, () => {
    test('breeding: the start, the egg settling on a status read, and the hatch', async () => {
        const first = companion('standard-0');
        const second = companion('standard-6');
        await seed([first, second]);

        await tire();
        const started = await call('start', {
            body: { playerName: PLAYER, parent1Id: first.id, parent2Id: second.id, requestId: 'idle-recovery-breeding-01' },
        });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal((await recovered()).petBreeding?.state, 'breeding', 'the barn was still filled');

        // The barn finishes; the next status read settles the egg and writes it.
        await editCharacter((character) => ({ ...character, petBreeding: { ...character.petBreeding, readyAt: Date.now() - 1_000 } }));
        await tire();
        const status = await call('status', { method: 'GET', query: { playerName: PLAYER } });
        assert.equal(status.status, 200, JSON.stringify(status.body));
        assert.ok(status.body.character, 'the status read wrote the settled egg');
        const egg = (await recovered()).petBreeding;
        assert.equal(egg?.state, 'egg');

        await editCharacter((character) => ({
            ...character,
            petBreeding: {
                ...character.petBreeding,
                requirements: character.petBreeding.requirements.map((requirement: Record<string, number>) => ({ ...requirement, progress: requirement.target })),
            },
        }));
        await tire();
        const hatched = await call('hatch', { body: { playerName: PLAYER, sessionId: egg.sessionId } });
        assert.equal(hatched.status, 200, JSON.stringify(hatched.body));
        assert.equal((await recovered()).petBreeding, null, 'the egg still hatched');
    });

    test('a companion moved to the Sanctuary and back', async () => {
        const pet = companion('standard-0');
        await seed([pet]);

        await tire();
        const stored = await call('sanctuary', { body: { playerName: PLAYER, petId: pet.id, action: 'to-sanctuary' } });
        assert.equal(stored.status, 200, JSON.stringify(stored.body));
        assert.equal((await recovered()).pets.length, 0, 'the companion still left the roster');

        await tire();
        const back = await call('sanctuary', { body: { playerName: PLAYER, petId: pet.id, action: 'to-roster' } });
        assert.equal(back.status, 200, JSON.stringify(back.body));
        assert.equal((await recovered()).pets.length, 1, 'the companion still came back');
    });

    test('a paid Showdown win', async () => {
        const fighter = (id: string) => ({
            id, name: `Pet ${id}`, element: 'Fire', role: 'assassin', rarity: 'standard',
            level: 30, hp: 400, attack: 50, defense: 30, speed: 35,
            jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }],
        });
        await seed([]);
        await tire();
        const session = createShowdownSession({
            sessionId: 'sd-idle-recovery', playerName: PLAYER, format: '1v1', tier: 'scrapper', seed: 7,
            playerPets: [fighter('p1')] as never, enemyPets: [fighter('e1')] as never, enemyTeamName: 'Foes',
            rewardEligible: true,
        });
        const out = await settleShowdownWin(PLAYER, session);
        assert.ok(Number(out.reward) > 0, 'the win still paid');
        assert.equal(Number((await recovered()).ryo), Number(out.reward));
    });
});
