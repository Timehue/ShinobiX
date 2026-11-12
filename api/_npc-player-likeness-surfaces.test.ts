import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// "As player-like as possible" on the surfaces other players read (owner,
// 2026-11-10): the portrait an online NPC shows, its real "last seen", the
// ranked standing a new character starts with, a duel listed for spectators
// like a player's, and a human pace at the duel and Chronicle tables.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-likeness-surfaces-session-secret-32';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let roster: typeof import('../shared/npc-village-roster.js');
let seed: typeof import('./_npc-village-seed.js');
let avatars: typeof import('./_npc-avatars.js');
let images: typeof import('./images.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    roster = await import('../shared/npc-village-roster.js');
    seed = await import('./_npc-village-seed.js');
    avatars = await import('./_npc-avatars.js');
    images = await import('./images.js') as unknown as typeof images;
    await kv.set('npc-village:state', { baseLevel: 40, target: 40, sample: 30, computedAt: Date.now() });
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

type Save = { character: Record<string, unknown> };
const saveOf = async (id: string) => (await kv.get<Save>(`save:${id}`))!;
const savesInOrder = async () => Promise.all(roster.NPC_VILLAGE_ROSTER.map((npc) => kv.get<Save>(`save:${npc.id}`)));

test('online, an NPC shows the portrait its save holds, under every id a viewer looks it up by', async () => {
    const listed = await images.scanCategoryIds('avatar');
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const character = (await saveOf(npc.id)).character;
        const value = avatars.npcAvatarRowValue(character.avatarImage);
        assert.ok(value, `${npc.id} has a portrait to publish`);
        for (const id of avatars.npcAvatarIds(String(character.name), npc.id)) {
            assert.equal(await kv.get(images.perImageKey(id)), value, `${id} holds the save's portrait`);
            assert.ok(listed.includes(id), `${id} is in the avatar manifest`);
        }
    }
    // The presence row stays image-free, as a player's does: the viewer resolves by name.
    const { toPlayerRecord } = await import('./_realtime/presence-input.js');
    const npc = roster.NPC_VILLAGE_ROSTER[0]!;
    online.upsert({ name: npc.name, sector: 67, character: (await saveOf(npc.id)).character });
    const record = toPlayerRecord(online.get(npc.name)!);
    assert.equal(record.character.avatarImage, '');
    assert.ok(await kv.get(images.perImageKey(`avatar:${record.name.toLowerCase()}`)), 'the name the roster carries finds the portrait');
    online.remove(npc.name);
    assert.deepEqual(await avatars.publishNpcAvatars(await savesInOrder()), [], 'an unchanged village writes nothing');
});

test('/api/img serves an NPC portrait from a site path by following it to our own host', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[1]!;
    const handler = (await import('./img.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const out: { status: number; location?: string } = { status: 0 };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.status = code; return res; },
        redirect(code: number, url: string) { out.status = code; out.location = url; return res; },
        json() { return res; }, send() { return res; }, end() { return res; },
    };
    await handler({ method: 'GET', query: { id: `avatar:${npc.id}` }, headers: {} } as never, res as never);
    const avatar = String((await saveOf(npc.id)).character.avatarImage);
    if (avatar.startsWith('/')) {
        assert.equal(out.status, 302);
        assert.equal(out.location, avatars.npcAvatarRowValue(avatar));
    } else {
        assert.ok(out.status === 200 || out.status === 302, `served (${out.status})`);
    }
});

test('a new portrait replaces the old row on the next rebuild; a renamed NPC leaves no row of ours behind', async () => {
    const index = 2;
    const npc = roster.NPC_VILLAGE_ROSTER[index]!;
    const saves = await savesInOrder();
    const character = saves[index]!.character;
    const { readImageVersion } = await import('./_image-version.js');
    const before = await readImageVersion('avatar');
    const repainted = saves.map((s, i) => (i === index ? { ...s, character: { ...character, avatarImage: '/portraits/repainted-test.webp' } } : s));
    const touched = await avatars.publishNpcAvatars(repainted);
    assert.deepEqual(touched.sort(), avatars.npcAvatarIds(String(character.name), npc.id).sort());
    assert.equal(await kv.get(images.perImageKey(`avatar:${npc.id}`)), avatars.npcAvatarRowValue('/portraits/repainted-test.webp'));
    assert.notEqual(await readImageVersion('avatar'), before, 'cached URLs of the old portrait are retired');
    // Renamed: the old display-name row goes, the account-slug row stays.
    const oldNameId = `avatar:${String(character.name).toLowerCase()}`;
    const renamed = saves.map((s, i) => (i === index ? { ...s, character: { ...character, name: 'Likeness Renamed Shinobi' } } : s));
    await avatars.publishNpcAvatars(renamed);
    if (oldNameId !== `avatar:${npc.id}`) assert.equal(await kv.get(images.perImageKey(oldNameId)), null);
    assert.ok(await kv.get(images.perImageKey('avatar:likeness renamed shinobi')));
    // Something else written to a row we once published is never removed.
    await kv.set(images.perImageKey('avatar:likeness renamed shinobi'), 'data:image/png;base64,AAAA');
    await avatars.publishNpcAvatars(saves);
    assert.equal(await kv.get(images.perImageKey('avatar:likeness renamed shinobi')), 'data:image/png;base64,AAAA');
    // And the real portrait is back where the roster looks.
    assert.equal(await kv.get(images.perImageKey(oldNameId)), avatars.npcAvatarRowValue(character.avatarImage));
    await kv.del(images.perImageKey('avatar:likeness renamed shinobi'));
});

test('a possessed NPC whose client saved the /api/img pointer keeps its roster portrait, never a row that redirects to itself', async () => {
    const index = 5;
    const npc = roster.NPC_VILLAGE_ROSTER[index]!;
    const pointer = `/api/img?id=avatar:${npc.name.toLowerCase()}&v=7`;
    assert.equal(avatars.npcAvatarRowValue(pointer), null);
    const saves = await savesInOrder();
    await avatars.publishNpcAvatars(saves);
    const pointed = saves.map((s, i) => (i === index ? { ...s!, character: { ...s!.character, avatarImage: pointer } } : s));
    await avatars.publishNpcAvatars(pointed);
    for (const id of avatars.npcAvatarIds(npc.name, npc.id)) {
        assert.equal(await kv.get(images.perImageKey(id)), avatars.npcAvatarRowValue(npc.avatar), `${id} keeps the roster portrait`);
    }
});

test('a rebuild after a duel win with every portrait unchanged reads no avatar row and takes no lock', async () => {
    await avatars.publishNpcAvatars(await savesInOrder()); // the village as it stands is published
    const npc = roster.NPC_VILLAGE_ROSTER[4]!;
    const get = mock.method(kv, 'get');
    const mget = mock.method(kv, 'mget');
    const set = mock.method(kv, 'set');
    let keysRead: string[] = [];
    let keysWritten: string[] = [];
    try {
        await seed.reseedNpc(npc.id); // what every NPC PvP win runs (api/_npc-duel-driver.ts claimAsNpc)
    } finally {
        keysRead = [...get.mock.calls.map((c) => String(c.arguments[0])), ...mget.mock.calls.flatMap((c) => (c.arguments as unknown[]).map(String))];
        keysWritten = set.mock.calls.map((c) => String(c.arguments[0]));
        get.mock.restore(); mget.mock.restore(); set.mock.restore();
    }
    assert.deepEqual(keysRead.filter((k) => k.startsWith('shared:img:avatar:')), [], 'no avatar row is read');
    assert.equal(keysRead.includes(avatars.NPC_AVATAR_INDEX_KEY), false, 'nor the index');
    assert.deepEqual(keysWritten.filter((k) => k === `lock:${avatars.NPC_AVATAR_INDEX_KEY}` || k.startsWith('shared:img:') || k.startsWith('npc-village:avatars')), [],
        'and no lock or avatar write');
    // A portrait that does change is still published by the same rebuild path.
    const saves = await savesInOrder();
    const repainted = saves.map((s, i) => (i === 4 ? { ...s!, character: { ...s!.character, avatarImage: '/portraits/hash-probe.webp' } } : s));
    assert.ok((await avatars.publishNpcAvatars(repainted)).includes(`avatar:${npc.id}`), 'a changed portrait is published');
    assert.deepEqual((await avatars.publishNpcAvatars(saves)).sort(), avatars.npcAvatarIds(String(saves[4]!.character.name), npc.id).sort(), 'and put back');
    assert.equal(await kv.get(images.perImageKey(`avatar:${npc.id}`)), avatars.npcAvatarRowValue(saves[4]!.character.avatarImage));
});

test('an NPC that leaves the map is "last seen" at that moment, and a rebuild while it is away keeps it', async () => {
    const presence = await import('./_npc-presence.js');
    const { REGISTRY_KEY, parsePublicPlayerIndexEntry } = await import('./player/_public-index.js');
    const t0 = Date.now();
    const HOUR = 3_600_000;
    let npc: (typeof roster.NPC_VILLAGE_ROSTER)[number] | undefined;
    let t1 = 0;
    for (let k = 1; k <= 30 && !npc; k++) {
        npc = roster.NPC_VILLAGE_ROSTER.find((n) => !presence.npcOffDuty(n.id, t0) && presence.npcOffDuty(n.id, t0 + k * HOUR));
        t1 = t0 + k * HOUR;
    }
    assert.ok(npc, 'some NPC logs off within a day');
    await presence.refreshNpcPresence(t0);
    assert.ok(online.get(npc!.name), 'on the map first');
    await presence.refreshNpcPresence(t1);
    assert.equal(online.get(npc!.name), null, 'logged off');
    const seenAt = async () => parsePublicPlayerIndexEntry(((await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY)) ?? {})[npc!.id], npc!.id)!.lastSeen;
    assert.equal(await seenAt(), t1, 'last seen when it left');
    await seed.indexNpcVillage(t1 + 13 * HOUR);
    assert.equal(await seenAt(), t1, 'a rebuild while it is away keeps the real stamp');
    // Still away a tick later: nothing is written again (one write on the way out, never per tick).
    const sentinel = t1 - 1;
    await kv.hset(REGISTRY_KEY, { [npc!.id]: { ...(parsePublicPlayerIndexEntry(((await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY)) ?? {})[npc!.id], npc!.id)!), lastSeen: sentinel } });
    await presence.refreshNpcPresence(t1 + presence.NPC_PRESENCE_TICK_MS);
    assert.equal(await seenAt(), sentinel, 'written once, on the way out');
});

test('an NPC starts at the unranked standing a new character has, and its profile shows it', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[3]!;
    const built = seed.buildNpcSave(npc, 30, null, 20) as Save;
    for (const [field, value] of Object.entries(seed.NPC_UNRANKED_DEFAULTS)) assert.equal(built.character[field], value, field);
    const stored = (await saveOf(npc.id)).character;
    assert.equal(stored.rankedRating, 1000);
    assert.equal(stored.petRankedRating, 1000);
    const { slimPresenceCharacter } = await import('./_realtime/presence-input.js');
    assert.equal(slimPresenceCharacter(stored)!.rankedRating, 1000, 'online too');
});

test('the shinobi seat takes a seeded few seconds to join and to think, and tests can zero both', async () => {
    const driver = await import('./_npc-duel-driver.js');
    const joins = new Set<number>();
    for (let i = 0; i < 40; i++) {
        const ms = driver.npcJoinDelayMs(`join-${i}`, 'p2');
        assert.ok(ms >= driver.NPC_JOIN_MIN_MS && ms <= driver.NPC_JOIN_MAX_MS, `${ms} ms`);
        assert.equal(driver.npcJoinDelayMs(`join-${i}`, 'p2'), ms, 'the same after a restart');
        joins.add(ms);
    }
    assert.ok(joins.size > 20, 'it varies duel to duel');
    const { PVP_JOIN_WINDOW_MS } = await import('../shared/pvp-cancellation.js');
    assert.ok(driver.NPC_JOIN_MAX_MS + 20_000 < PVP_JOIN_WINDOW_MS, 'never near a no-show, even after its join retries');
    driver.setNpcActionBeatForTest(0);
    assert.equal(driver.npcJoinDelayMs('join-0', 'p2'), 0);
    driver.setNpcActionBeatForTest(driver.NPC_ACTION_BEAT_MS);
});

test('the Chronicle seat reads each turn, weighs a response, and keeps clear of every clock', async () => {
    const card = await import('./_npc-card-duel-driver.js');
    const { TURN_TIMEOUT_MS, RESPONSE_TIMEOUT_MS } = await import('../shared/chronicle-duel.js');
    const T = 1_800_000_000_000;
    const turn = (turnNumber: number, extra: Record<string, unknown> = {}) => ({ activePlayer: 'p2', actedThisTurn: false, turnStartedAt: T, turnNumber, responseWindow: null, ...extra }) as never;
    const thinks = new Set<number>();
    for (let n = 1; n <= 40; n++) {
        const at = card.npcChronicleReadyAt('cw-duel', turn(n), 'p2');
        assert.ok(at - T >= card.NPC_CARD_THINK_MIN_MS && at - T <= card.NPC_CARD_THINK_MAX_MS, `${at - T} ms`);
        assert.equal(card.npcChronicleReadyAt('cw-duel', turn(n), 'p2'), at, 'seeded');
        thinks.add(at - T);
    }
    assert.ok(thinks.size > 20);
    assert.ok(card.NPC_CARD_THINK_MAX_MS + 24 * card.NPC_CARD_BEAT_MAX_MS < TURN_TIMEOUT_MS, 'the whole turn fits its clock');
    assert.equal(card.npcChronicleReadyAt('cw-duel', turn(1, { actedThisTurn: true }), 'p2'), 0, 'mid-turn it only keeps its pace');
    assert.equal(card.npcChronicleReadyAt('cw-duel', turn(1, { activePlayer: 'p1' }), 'p2'), 0, 'not its turn');
    const window = { id: 'rw-1', responder: 'p2', openedAt: T, expiresAt: T + RESPONSE_TIMEOUT_MS };
    const react = card.npcChronicleReadyAt('cw-duel', turn(1, { activePlayer: 'p1', responseWindow: window }), 'p2') - T;
    assert.ok(react >= card.NPC_CARD_REACT_MIN_MS && react <= RESPONSE_TIMEOUT_MS - 4_000, `responds after ${react} ms`);
    for (let i = 0; i < 50; i++) {
        const beat = card.npcCardBeatMs();
        assert.ok(beat >= 450 && beat <= 1_200, `${beat} ms between actions`);
    }
    const joinAt = card.npcCardJoinAt('open-1', T) - T;
    assert.ok(joinAt >= card.NPC_CARD_JOIN_MIN_MS && joinAt <= card.NPC_CARD_JOIN_MAX_MS);
    assert.equal(card.npcCardJoinAt('open-1', T, T + 15_000), Math.min(T + joinAt, T + 5_000), 'always well before the join deadline');
    card.setNpcCardBeatForTest(0);
    assert.equal(card.npcChronicleReadyAt('cw-duel', turn(1), 'p2'), 0);
    assert.equal(card.npcCardJoinAt('open-1', T), T);
    assert.equal(card.npcCardBeatMs(), 0);
    card.setNpcCardBeatForTest(card.NPC_CARD_ACTION_BEAT_MS);
    const clan = await import('./_npc-clan-war-campaign.js');
    clan.setNpcClanCardBeatForTest(0); // the clan-war seat's hook zeroes its own pace
    clan.setNpcClanCardBeatForTest(450);
});

// ── A world duel through the real handlers ────────────────────────────────────
let seq = 0;
async function post(handler: (req: never, res: never) => unknown, name: string, body: Record<string, unknown>) {
    const { issuePlayerToken } = await import('./_auth.js');
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.83.${Math.floor(++seq / 250)}.${seq % 250}`;
    await handler({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': issuePlayerToken(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

async function openDuel(human: string, npc: (typeof roster.NPC_VILLAGE_ROSTER)[number], { join = true } = {}) {
    const SECTOR = 67;
    const npcSave = await saveOf(npc.id);
    const character = { name: human, level: Number(npcSave.character.level), village: 'Frostfang Village', ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name: human, sector: SECTOR, character });
    online.remove(npc.name); // an earlier presence tick may have posted it elsewhere
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    const attack = (await import('./player/attack.js')).default as never;
    const create = (await import('./pvp/session.js')).default as never;
    const move = (await import('./pvp/move.js')).default as never;
    const admission = await post(attack, human, { targetName: npc.name, attacker: { name: human } });
    assert.equal(admission.status, 200, JSON.stringify(admission.body));
    const made = await post(create, human, { p1Character: { name: human }, p2Character: npcSave.character,
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const session = made.body.session as PvpSession;
    if (join) assert.equal((await post(move, human, { battleId: session.battleId, role: 'p1', action: 'join', moveToken: `join-${session.battleId}` })).status, 200);
    return session;
}

const boardHas = async (battleId: string) =>
    ((await kv.get<Array<{ battleId?: string }>>('game:arena:active-fights')) ?? []).some((f) => f.battleId === battleId);

/** A duel the human joined and the NPC sat down in, so the seat has listed it. */
async function listedDuel(human: string, npc: (typeof roster.NPC_VILLAGE_ROSTER)[number]) {
    const driver = await import('./_npc-duel-driver.js');
    const session = await openDuel(human, npc);
    driver.setNpcActionBeatForTest(0);
    try { await driver.driveNpcDuel(session.battleId, 'p2'); } finally { driver.setNpcActionBeatForTest(driver.NPC_ACTION_BEAT_MS); }
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.joined?.p2, true);
    assert.ok(await boardHas(session.battleId), 'listed once both fighters are seated');
    return session;
}

test('a duel the player never joins is never listed for spectators', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 16, 0, 0) });
    t.after(() => mock.timers.reset());
    const driver = await import('./_npc-duel-driver.js');
    const npc = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'genin')[0]!;
    const session = await openDuel('likenessnoshow1', npc, { join: false });
    // As in a duel the NPC opened (a hunt, a war strike): the other fighter has not stepped in.
    const opened = (await kv.get<PvpSession>(`pvp:${session.battleId}`))!;
    await kv.set(`pvp:${session.battleId}`, { ...opened, joined: { p1: false, p2: false } });
    mock.timers.tick(driver.NPC_JOIN_MAX_MS + 1);
    await driver.driveNpcDuel(session.battleId, 'p2');
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.joined?.p2, true, 'the NPC took its seat');
    assert.equal(await boardHas(session.battleId), false, 'nobody to watch while the challenger has not stepped in');
    for (let i = 0; i < 5; i++) {
        mock.timers.tick(1_000);
        await driver.driveNpcDuel(session.battleId, 'p2');
        assert.equal(await boardHas(session.battleId), false);
    }
    // The join window lapses: the duel is settled as a no-show, still never listed.
    const { PVP_JOIN_WINDOW_MS } = await import('../shared/pvp-cancellation.js');
    mock.timers.tick(PVP_JOIN_WINDOW_MS + 1_000);
    for (let i = 0; i < 3; i++) { await driver.driveNpcDuel(session.battleId, 'p2'); mock.timers.tick(1_000); }
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.status, 'done', 'settled as a no-show');
    assert.equal(await boardHas(session.battleId), false);
});

test('a duel whose session is gone leaves the live-fights board', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 17, 0, 0) });
    t.after(() => mock.timers.reset());
    const driver = await import('./_npc-duel-driver.js');
    const npc = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'genin')[1]!;
    const session = await listedDuel('likenessgone1', npc);
    await kv.del(`pvp:${session.battleId}`);
    assert.equal(await driver.driveNpcDuel(session.battleId, 'p2'), 'gone');
    assert.equal(await boardHas(session.battleId), false, 'no session, no listing');
});

test('a finished duel leaves the board before the NPC claims, even when the claim keeps failing', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 18, 0, 0) });
    t.after(() => mock.timers.reset());
    const driver = await import('./_npc-duel-driver.js');
    const npc = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'genin')[2]!;
    const session = await listedDuel('likenessclaim1', npc);
    // Over, but with no terminal time the claim route refuses it (409), every time.
    const live = (await kv.get<PvpSession>(`pvp:${session.battleId}`))!;
    await kv.set(`pvp:${session.battleId}`, { ...live, status: 'done', winner: 'p1', endedAt: undefined });
    assert.equal(await driver.driveNpcDuel(session.battleId, 'p2'), 'idle', 'the claim failed; it is tried again later');
    assert.equal(await boardHas(session.battleId), false, 'a finished duel is not left listed behind a failing claim');
    mock.timers.tick(1_000);
    const reads = mock.method(kv, 'get');
    try { await driver.driveNpcDuel(session.battleId, 'p2'); } finally { reads.mock.restore(); }
    assert.equal(reads.mock.calls.filter((c) => c.arguments[0] === 'game:arena:active-fights').length, 0, 'a retried claim does not re-read the board');
    await kv.del(`pvp:${session.battleId}`);
    await driver.driveNpcDuel(session.battleId, 'p2');
});

test('the NPC steps into a world duel after a few seconds, and lists it for spectators like a fighter\'s client', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 12, 0, 0) });
    t.after(() => mock.timers.reset());
    const driver = await import('./_npc-duel-driver.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    const session = await openDuel('likenesswatcher1', npc);
    await driver.driveNpcDuel(session.battleId, 'p2');
    assert.notEqual((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.joined?.p2, true, 'not the instant it is published');
    mock.timers.tick(driver.NPC_JOIN_MAX_MS + 1);
    await driver.driveNpcDuel(session.battleId, 'p2');
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.joined?.p2, true, 'seated within the join window');
    const board = (await kv.get<Array<{ id: string; battleId: string; fighters: string[]; mode: string }>>('game:arena:active-fights')) ?? [];
    const fight = board.find((f) => f.battleId === session.battleId);
    assert.ok(fight, 'on the live-fights board the roster\'s Spectate reads');
    assert.deepEqual(fight!.fighters.sort(), ['likenesswatcher1', npc.name].sort());
    assert.equal(fight!.mode, 'PvP');
    // That board is what the roster's Spectate reads (shinobij.client/src/lib/sector-spectate.ts).
    const gameState = (await import('./game-state.js')).default as never;
    const out = { body: {} as Record<string, any> };
    const res = { setHeader: () => res, status: () => res, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    await (gameState as (req: never, res: never) => Promise<unknown>)({ method: 'GET', query: { activeFights: '1' }, headers: {} } as never, res as never);
    assert.ok((out.body.arenaActiveFights as Array<{ battleId: string }>).some((f) => f.battleId === session.battleId));
});

test('a duel the player already listed is left as the player listed it', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 11, 14, 0, 0) });
    t.after(() => mock.timers.reset());
    const driver = await import('./_npc-duel-driver.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'chunin')!;
    // The player's screen lists the duel while the NPC is still stepping in.
    const session = await openDuel('likenesswatcher2', npc);
    const gameState = (await import('./game-state.js')).default as never;
    const listed = await post(gameState, 'likenesswatcher2', { kind: 'arenaActiveFight', action: 'register',
        fight: { id: `pvp-${session.battleId}`, battleId: session.battleId, mode: 'PvP', biome: 'player-biome' } });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    driver.setNpcActionBeatForTest(0);
    t.after(() => driver.setNpcActionBeatForTest(driver.NPC_ACTION_BEAT_MS));
    await driver.driveNpcDuel(session.battleId, 'p2');
    assert.equal((await kv.get<PvpSession>(`pvp:${session.battleId}`))!.joined?.p2, true);
    const board = (await kv.get<Array<{ battleId: string; biome?: string }>>('game:arena:active-fights')) ?? [];
    assert.equal(board.filter((f) => f.battleId === session.battleId).length, 1);
    assert.equal(board.find((f) => f.battleId === session.battleId)!.biome, 'player-biome');
});
