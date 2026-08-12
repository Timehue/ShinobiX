import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Listener = (payload: unknown) => unknown;
type RoomEvent = { room: string; event: string; payload: Record<string, unknown> };

class FakeSocket {
    readonly data: { name: string };
    readonly handlers = new Map<string, Listener>();
    readonly emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
    readonly rooms: string[] = [];

    constructor(name: string) {
        this.data = { name };
    }

    on(event: string, listener: Listener): this {
        this.handlers.set(event, listener);
        return this;
    }

    emit(event: string, payload: Record<string, unknown>): this {
        this.emitted.push({ event, payload });
        return this;
    }

    join(room: string): void {
        this.rooms.push(room);
    }

    async trigger(event: string, payload: unknown): Promise<void> {
        const listener = this.handlers.get(event);
        assert.ok(listener, `missing listener for ${event}`);
        await listener(payload);
    }
}

class FakeIo {
    readonly events: RoomEvent[] = [];

    to(room: string) {
        return {
            emit: (event: string, payload: Record<string, unknown>) => {
                this.events.push({ room, event, payload });
            },
        };
    }
}

const CHALLENGER = 'duel-authority-one';
const DEFENDER = 'duel-authority-two';

const pet = (id: string, attack: number, stance: number) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 10,
    xp: 0,
    maxLevel: 100,
    hp: 100,
    attack,
    defense: 20,
    speed: 20,
    jutsus: [],
    unlockedForPve: true,
    doctrine: { stance, priority: [], breakAt: 'never' },
});

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('./online-store.js').onlineStore;
let resetSessions: typeof import('./pet-duel-session.js')._resetSessions;
let sealAuthoritativePetRoster: typeof import('./pet-duel-socket.js').sealAuthoritativePetRoster;
let wirePetDuel: typeof import('./pet-duel-socket.js').wirePetDuel;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('./online-store.js'));
    ({ _resetSessions: resetSessions } = await import('./pet-duel-session.js'));
    ({ sealAuthoritativePetRoster, wirePetDuel } = await import('./pet-duel-socket.js'));
});

beforeEach(async () => {
    resetSessions();
    onlineStore.remove(CHALLENGER);
    onlineStore.remove(DEFENDER);
    onlineStore.upsert({ name: CHALLENGER, sector: 40, character: null });
    onlineStore.upsert({ name: DEFENDER, sector: 40, character: null });
    await kv.set(`save:${CHALLENGER}`, {
        character: {
            activePetId: 'p1',
            activePetId2v2: 'p2',
            patreon: { active: false },
            pets: [pet('p1', 10, 1), pet('p2', 20, 2), pet('p3', 30, 3), pet('p4', 40, 4), pet('p5', 50, 5), pet('p6', 60, 6)],
        },
    });
    await kv.set(`save:${DEFENDER}`, {
        character: {
            activePetId: 'q1',
            activePetId2v2: 'q2',
            patreon: { active: true },
            pets: [pet('q1', 10, 1), pet('q2', 20, 2), pet('q3', 30, 3), pet('q4', 40, 4), pet('q5', 50, 5), pet('q6', 60, 6)],
        },
    });
});

after(() => {
    resetSessions();
    onlineStore.remove(CHALLENGER);
    onlineStore.remove(DEFENDER);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('authoritative roster projection keeps requested order and rejects duplicates or lapse overflow', () => {
    const character = {
        activePetId: 'p1',
        activePetId2v2: 'p2',
        patreon: { active: false },
        pets: [pet('p1', 10, 1), pet('p2', 20, 2), pet('p3', 30, 3), pet('p4', 40, 4), pet('p5', 50, 5), pet('p6', 60, 6)],
    };
    assert.deepEqual(
        sealAuthoritativePetRoster(character, [{ id: 'p4' }, { id: 'p1' }], '2v2')?.map(({ id }) => id),
        ['p4', 'p1'],
    );
    assert.equal(sealAuthoritativePetRoster(character, [{ id: 'p5' }], '1v1'), null);
    assert.equal(sealAuthoritativePetRoster(character, [{ id: 'p1' }, { id: 'p1' }], '2v2'), null);
    assert.equal(
        sealAuthoritativePetRoster(
            { ...character, pets: [pet('p1', 10, 1), { ...pet('p2', 20, 2), expedition: { endsAt: Date.now() + 60_000 } }] },
            [{ id: 'p2' }],
            '1v1',
        ),
        null,
        'a carried pet on an expedition is not combat-eligible',
    );
    assert.equal(
        sealAuthoritativePetRoster(
            { ...character, pets: [pet('p1', 10, 1), { ...pet('p2', 20, 2), training: { type: 'strength', endsAt: Date.now() + 60_000 } }] },
            [{ id: 'p2' }],
            '1v1',
        ),
        null,
        'a carried pet with uncollected training is not combat-eligible',
    );
    assert.equal(
        sealAuthoritativePetRoster(
            { ...character, petBreeding: { state: 'breeding', parentIds: ['p2', 'p3'], readyAt: Date.now() + 60_000 } },
            [{ id: 'p2' }],
            '1v1',
        ),
        null,
        'an active breeding parent is not combat-eligible',
    );
    assert.deepEqual(
        sealAuthoritativePetRoster(character, [{ id: 'p2' }], '2v2')?.map(({ id }) => id),
        ['p2'],
        'the existing optional reserve-slot protocol remains valid',
    );
});

test('live challenge and accept seal save-backed pet data for both players', async () => {
    const io = new FakeIo();
    const challenger = new FakeSocket(CHALLENGER);
    wirePetDuel(io as never, challenger as never);

    await challenger.trigger('petduel:challenge', {
        to: DEFENDER,
        mode: '2v2',
        pets: [{ id: 'p5', attack: 99_999 }, { id: 'p1' }],
    });
    assert.equal(challenger.emitted.at(-1)?.payload.error, 'Choose an eligible carried pet.');
    assert.equal(io.events.some(({ event }) => event === 'petduel:invite'), false);

    await challenger.trigger('petduel:challenge', {
        to: DEFENDER,
        mode: '2v2',
        pets: [
            { id: 'p4', attack: 99_999, doctrine: { stance: 999 } },
            { id: 'p1', attack: 99_999 },
        ],
    });
    const invite = io.events.find(({ event }) => event === 'petduel:invite');
    assert.ok(invite);

    const defender = new FakeSocket(DEFENDER);
    wirePetDuel(io as never, defender as never);
    await defender.trigger('petduel:accept', {
        id: invite.payload.id,
        pets: [
            { id: 'q6', attack: 99_999, doctrine: { stance: 999 } },
            { id: 'q5', attack: 99_999 },
        ],
    });

    const starts = io.events.filter(({ event }) => event === 'petduel:start');
    assert.equal(starts.length, 2);
    const start = starts[0].payload;
    const player = start.player as Array<Record<string, unknown>>;
    const enemy = start.enemy as Array<Record<string, unknown>>;
    assert.deepEqual(player.map(({ id }) => id), ['p4', 'p1']);
    assert.deepEqual(player.map(({ attack }) => attack), [40, 10]);
    assert.deepEqual(enemy.map(({ id }) => id), ['q6', 'q5']);
    assert.deepEqual(enemy.map(({ attack }) => attack), [60, 50]);
    assert.equal((player[0].doctrine as { stance: number }).stance, 4);
    assert.equal((enemy[0].doctrine as { stance: number }).stance, 6);

    await defender.trigger('petduel:resign', { id: invite.payload.id });
});

test('accept revalidates and cancels when the challenger pet became busy after invite', async () => {
    const io = new FakeIo();
    const challenger = new FakeSocket(CHALLENGER);
    wirePetDuel(io as never, challenger as never);
    await challenger.trigger('petduel:challenge', {
        to: DEFENDER,
        mode: '1v1',
        pets: [{ id: 'p3' }],
    });
    const invite = io.events.find(({ event }) => event === 'petduel:invite');
    assert.ok(invite);

    await kv.set(`save:${CHALLENGER}`, {
        character: {
            activePetId: 'p1',
            activePetId2v2: 'p2',
            patreon: { active: false },
            pets: [pet('p1', 10, 1), pet('p2', 20, 2), { ...pet('p3', 30, 3), expedition: { endsAt: Date.now() + 60_000 } }],
        },
    });

    const defender = new FakeSocket(DEFENDER);
    wirePetDuel(io as never, defender as never);
    await defender.trigger('petduel:accept', { id: invite.payload.id, pets: [{ id: 'q1' }] });

    assert.equal(io.events.some(({ event }) => event === 'petduel:start'), false);
    assert.match(String(defender.emitted.at(-1)?.payload.error), /challenger.*no longer available/i);
    assert.equal(io.events.some(({ room, event }) => room === `user:${CHALLENGER}` && event === 'petduel:error'), true);
});
