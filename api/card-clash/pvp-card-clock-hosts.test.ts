import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CHRONICLE_AI_DECKS } from './_ai-engine.js';
import {
    CHRONICLE_RULES_VERSION, TURN_TIMEOUT_MS, createMatch, type ChronicleMatch,
} from '../../shared/chronicle-duel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-card-clock-hosts-secret-32-bytes-ok';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * The war card hosts run the shared turn clock (advanceExpiredChronicleTurn) at
 * the top of every request, and it can end a duel on its own: two missed turns
 * in a row forfeit. That result used to live only in memory until something
 * saved it, so a request the host then refused threw it away. A refused move
 * only delayed it until the next poll. But a Sector War join REPLACES a
 * finished table, so an attacker opening the next battle erased a forfeit the
 * war had never scored. Each host now stores and scores what the clock
 * settled before it judges a duelist's request. Nobody else moves a duel's
 * clock: a stranger's request is refused and writes nothing. A Sector War join
 * scores a finished table before replacing it, whoever opens the next one.
 * (Free Play is covered in match.test.ts.)
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
type Stored = { p1Name: string; p2Name?: string; status: string; createdAt: number; state?: ChronicleMatch };

const SECTOR = 31;
const ATTACKER_VILLAGE = 'Moonshadow Village';
const DEFENDER_VILLAGE = 'Frostfang Village';
const RAIDER = 'raider';
const HOLDOUT = 'holdout';
/** An attacker from the same village who did not sit at the table. */
const SECOND_RAIDER = 'raidertwo';
const WAR_ID = 'alpha-clan__bravo-clan';
const CHALLENGE_ID = 'cw-clock-challenge';

let sectorCard: Handler;
let tilecards: Handler;
let kv: typeof import('../_storage.js').kv;
let newSectorWarSession: typeof import('../_sector-war.js').newSectorWarSession;
let sectorWarKey: typeof import('../_sector-war.js').sectorWarKey;
let loadSectorWar: typeof import('../_sector-war-store.js').loadSectorWar;
let issuePlayerToken: (name: string) => string | null;
let tilecardsDamage: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ newSectorWarSession, sectorWarKey } = await import('../_sector-war.js'));
    ({ loadSectorWar } = await import('../_sector-war-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    tilecardsDamage = (await import('../clan/war/_storage.js')).CHALLENGE_DAMAGE.tilecards;
    const card = await import('../village/sector-card.js');
    sectorCard = ((card.default as unknown as { default?: Handler })?.default ?? card.default) as unknown as Handler;
    const clan = await import('../clan/war/tilecards.js');
    tilecards = ((clan.default as unknown as { default?: Handler })?.default ?? clan.default) as unknown as Handler;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, body: Record<string, unknown>): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    const playerName = String(body.playerName ?? '');
    const req = {
        method: 'POST',
        body,
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

/** The duelist on the clock has already missed `strikes` turns in a row and
 *  has now let this one run out without acting. */
async function expireActiveTurn(key: string, strikes: number) {
    const session = await kv.get<Stored>(key);
    assert.ok(session?.state, 'the duel must be live before its clock can run out');
    const absent = session.state.activePlayer;
    session.state.afkStrikes = { [absent]: strikes };
    session.state.actedThisTurn = false;
    session.state.turnStartedAt = Date.now() - TURN_TIMEOUT_MS - 1_000;
    await kv.set(key, session);
    const other = absent === 'p1' ? session.p2Name! : session.p1Name;
    return { absentName: absent === 'p1' ? session.p1Name : session.p2Name!, presentName: other, createdAt: session.createdAt };
}

describe('Sector War card table', { concurrency: false }, () => {
    const tableKey = (id: string) => `sector-card:${id}`;

    async function openLiveDuel() {
        await kv.set(`save:${RAIDER}`, { character: { name: RAIDER, village: ATTACKER_VILLAGE } });
        await kv.set(`save:${HOLDOUT}`, { character: { name: HOLDOUT, village: DEFENDER_VILLAGE } });
        const contest = newSectorWarSession({
            sector: SECTOR, attackerVillage: ATTACKER_VILLAGE, defenderVillage: DEFENDER_VILLAGE,
            winCondition: 'card', now: Date.now() - 60 * 60 * 1000,
        });
        await kv.set(sectorWarKey(contest.id), contest);
        const opened = await call(sectorCard, { action: 'join', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        const answered = await call(sectorCard, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(answered.statusCode, 200, JSON.stringify(answered.body));
        return contest.id;
    }

    it('scores the forfeit at once when the absent duelist\'s late move is refused', async () => {
        const id = await openLiveDuel();
        const { absentName, presentName } = await expireActiveTurn(tableKey(id), 1);

        const late = await call(sectorCard, { action: 'end-turn', playerName: absentName, sectorWarId: id });
        assert.equal(late.statusCode, 400);
        assert.equal(late.body?.error, 'The duel is over.');

        assert.equal((await kv.get<Stored>(tableKey(id)))?.status, 'done', 'the forfeit is stored without another poll');
        const war = (await loadSectorWar(id))!;
        assert.equal(war.appliedBattles?.length, 1, 'and the war scored it');
        assert.equal(war.appliedBattles![0]!.by, presentName);
        assert.equal(war.appliedBattles![0]!.attackerWon, presentName === RAIDER);
    });

    it('scores the forfeit before an attacker\'s join opens the next table over it', async () => {
        const id = await openLiveDuel();
        const { presentName, createdAt } = await expireActiveTurn(tableKey(id), 1);

        const next = await call(sectorCard, { action: 'join', playerName: RAIDER, sectorWarId: id });
        assert.equal(next.statusCode, 200, JSON.stringify(next.body));
        assert.equal((next.body?.session as { status?: string }).status, 'awaiting-defender', 'a new table opened');

        const war = (await loadSectorWar(id))!;
        assert.equal(war.appliedBattles?.length, 1, 'the ended duel counted before its table was replaced');
        assert.equal(war.appliedBattles![0]!.battleId, `card:${id}:${createdAt}`);
        assert.equal(war.appliedBattles![0]!.by, presentName);
    });

    it('scores it too when the attacker opening the next table never sat at this one', async () => {
        const id = await openLiveDuel();
        await kv.set(`save:${SECOND_RAIDER}`, { character: { name: SECOND_RAIDER, village: ATTACKER_VILLAGE } });
        const { presentName, createdAt } = await expireActiveTurn(tableKey(id), 1);

        const next = await call(sectorCard, { action: 'join', playerName: SECOND_RAIDER, sectorWarId: id });
        assert.equal(next.statusCode, 200, JSON.stringify(next.body));
        assert.equal((next.body?.session as { status?: string }).status, 'awaiting-defender');

        const war = (await loadSectorWar(id))!;
        assert.equal(war.appliedBattles?.length, 1, 'the finished duel is scored before its table is replaced');
        assert.equal(war.appliedBattles![0]!.battleId, `card:${id}:${createdAt}`);
        assert.equal(war.appliedBattles![0]!.by, presentName);
    });

    it('a player outside the duel cannot move its clock', async () => {
        const id = await openLiveDuel();
        await kv.set(`save:${SECOND_RAIDER}`, { character: { name: SECOND_RAIDER, village: ATTACKER_VILLAGE } });
        await expireActiveTurn(tableKey(id), 1);

        const poke = await call(sectorCard, { action: 'end-turn', playerName: SECOND_RAIDER, sectorWarId: id });
        assert.equal(poke.statusCode, 403);
        assert.equal((await kv.get<Stored>(tableKey(id)))?.status, 'active', 'the refused request wrote nothing');
        assert.equal((await loadSectorWar(id))!.appliedBattles?.length ?? 0, 0, 'and scored nothing on the war');
    });
});

describe('Clan War card duel', { concurrency: false }, () => {
    const tableKey = `cw-tilecards:${CHALLENGE_ID}`;

    async function seedLiveDuel() {
        const now = Date.now();
        await kv.set(`save:alpha`, { character: { name: 'alpha' } });
        await kv.set(`save:bravo`, { character: { name: 'bravo' } });
        await kv.set(`clan-war:${WAR_ID}`, {
            id: WAR_ID, clans: ['Alpha Clan', 'Bravo Clan'],
            villages: { 'Alpha Clan': ATTACKER_VILLAGE, 'Bravo Clan': DEFENDER_VILLAGE },
            hp: { 'Alpha Clan': 1000, 'Bravo Clan': 1000 },
            startedAt: now - 60 * 60 * 1000, updatedAt: now, declaredBy: 'alpha',
            pendingChallenges: [{
                id: CHALLENGE_ID, mode: 'tilecards', fromClan: 'Alpha Clan', fromPlayer: 'alpha',
                createdAt: now - 10 * 60_000, status: 'accepted', expiresAt: now + 60 * 60_000,
                acceptedAt: now - 5 * 60_000, acceptedPlayer: 'bravo',
            }],
            completedChallenges: [],
        });
        const p1Deck = [...CHRONICLE_AI_DECKS.hard];
        const p2Deck = [...CHRONICLE_AI_DECKS.medium];
        await kv.set(tableKey, {
            rulesVersion: CHRONICLE_RULES_VERSION, warId: WAR_ID, challengeId: CHALLENGE_ID,
            p1Name: 'alpha', p1Clan: 'Alpha Clan', p1Deck, p2Name: 'bravo', p2Clan: 'Bravo Clan', p2Deck,
            state: createMatch('alpha', p1Deck, 'bravo', p2Deck, Math.random, now),
            status: 'active', createdAt: now, updatedAt: now,
        });
    }

    it('settles the forfeit on the war at once when the absent duelist\'s late move is refused', async () => {
        await seedLiveDuel();
        const { absentName, presentName } = await expireActiveTurn(tableKey, 1);

        const late = await call(tilecards, { action: 'end-turn', playerName: absentName, warId: WAR_ID, challengeId: CHALLENGE_ID });
        assert.equal(late.statusCode, 400);
        assert.equal(late.body?.error, 'The duel is over.');

        assert.equal((await kv.get<Stored>(tableKey))?.status, 'done', 'the forfeit is stored without another poll');
        const war = await kv.get<{
            hp: Record<string, number>;
            pendingChallenges: unknown[];
            completedChallenges: Array<{ id: string; result?: string }>;
        }>(`clan-war:${WAR_ID}`);
        assert.equal(war?.pendingChallenges.length, 0);
        assert.equal(war?.completedChallenges[0]?.id, CHALLENGE_ID);
        assert.equal(war?.completedChallenges[0]?.result, presentName === 'alpha' ? 'from-wins' : 'to-wins');
        const loserClan = presentName === 'alpha' ? 'Bravo Clan' : 'Alpha Clan';
        assert.equal(war?.hp[loserClan], 1000 - tilecardsDamage, 'the walk-out cost its clan the card damage');
    });

    it('a player outside the duel cannot move its clock', async () => {
        await seedLiveDuel();
        await kv.set(`save:charlie`, { character: { name: 'charlie' } });
        await expireActiveTurn(tableKey, 1);

        const poke = await call(tilecards, { action: 'end-turn', playerName: 'charlie', warId: WAR_ID, challengeId: CHALLENGE_ID });
        assert.equal(poke.statusCode, 403);
        assert.equal((await kv.get<Stored>(tableKey))?.status, 'active', 'the refused request wrote nothing');
        const war = await kv.get<{ hp: Record<string, number>; pendingChallenges: unknown[] }>(`clan-war:${WAR_ID}`);
        assert.equal(war?.pendingChallenges.length, 1, 'the challenge is still waiting on its duelists');
        assert.deepEqual(war?.hp, { 'Alpha Clan': 1000, 'Bravo Clan': 1000 });
    });
});
