import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-contest-garrison-secret-32-bytes-ok';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * Card and Pet sector wars score nothing until a defender takes the other seat.
 * A village that simply never logged in therefore ran the 72h clock out at 0-0,
 * and settlement gives a tie to the defence — so the cheapest way to hold a
 * sector was to set it to Card or Pet and ignore it. These tests pin the
 * garrison that closes that: after the idle window the attacker fights the
 * defending village's SEALED deck / team instead of waiting forever.
 *
 * The invariants that matter are the ones that keep it from becoming a new hole:
 * attacker-only, locked while the defence is actually fighting, re-locked the
 * moment a live battle lands, scored at garrison weight, and never a substitute
 * for a defender who IS there.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const IDLE_MS = 2 * 60 * 60 * 1000;
const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'raider';
const HOLDOUT = 'holdout';
const ANBU = 'anbudefender';

let petHandler: Handler;
let cardHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let sectorWarKey: typeof import('../_sector-war.js').sectorWarKey;
let villageStateKey: typeof import('../_anbu-infiltration-store.js').villageStateKey;
let newSectorWarSession: typeof import('../_sector-war.js').newSectorWarSession;
let loadSectorWar: typeof import('../_sector-war-store.js').loadSectorWar;
let issuePlayerToken: (name: string) => string | null;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorWarKey, newSectorWarSession } = await import('../_sector-war.js'));
    ({ villageStateKey } = await import('../_anbu-infiltration-store.js'));
    ({ loadSectorWar } = await import('../_sector-war-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    const pet = await import('./sector-pet.js');
    petHandler = ((pet.default as unknown as { default?: Handler })?.default ?? pet.default) as unknown as Handler;
    const card = await import('./sector-card.js');
    cardHandler = ((card.default as unknown as { default?: Handler })?.default ?? card.default) as unknown as Handler;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function pet(id: string, name: string) {
    return { id, name, rarity: 'common', hp: 60, attack: 20, defense: 15, speed: 12, level: 5, element: 'None' };
}

async function seedPlayer(slug: string, village: string, pets: unknown[]) {
    await kv.set(`save:${slug}`, { character: { name: slug, village, pets, activePetId: (pets[0] as { id?: string })?.id } });
}

/** A contest whose last live battle is `idleMs` in the past. */
async function seedContest(winCondition: 'card' | 'pet', idleMs: number, now = Date.now()) {
    const contest = newSectorWarSession({
        sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition,
        now: now - 3 * 60 * 60 * 1000,
    });
    contest.lastLiveBattleAt = now - idleMs;
    await kv.set(sectorWarKey(contest.id), contest);
    return contest;
}

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
        // A real minted token, never the admin bypass: every ownership check in
        // these paths is `admin ? attackerVillage : villageOf(me)`, so calling as
        // admin would skip the very checks these tests exist to exercise.
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await seedPlayer(RAIDER, ATTACKER, [pet('atk1', 'Ashfang'), pet('atk2', 'Emberpaw')]);
    await seedPlayer(HOLDOUT, DEFENDER, [pet('def1', 'Frostmaw')]);
    await seedPlayer(ANBU, DEFENDER, [pet('anbu1', 'Wardenclaw'), pet('anbu2', 'Snowveil')]);
    // The defending village's appointed ANBU is who the garrison seals from.
    await kv.set(villageStateKey(DEFENDER), { anbuAppointees: [ANBU] });
});

describe('Pet sector garrison closes the absent-defence hold', { concurrency: false }, () => {
    it('resolves against the sealed garrison team and SCORES the contest', async () => {
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const session = out.body?.session as { status: string; winner: string; garrison: boolean; p2?: { name: string } };
        assert.equal(session.status, 'done');
        assert.equal(session.garrison, true);
        assert.ok(session.winner === 'p1' || session.winner === 'p2');
        assert.equal(session.p2?.name, ANBU, 'the garrison seals the appointed ANBU, not the absent defender');

        // The whole point: the war is no longer stuck at 0-0.
        const after = await loadSectorWar(contest.id);
        assert.ok((after!.attackerPoints + after!.defenderPoints) > 0, 'a garrison duel must move the tally');
        // WHICH side wins is decided by the sealed seed, so this asserts only
        // that the war moved. The garrison flag and credit are branch-checked in
        // the dedicated test below.
        assert.equal(after!.appliedBattles?.length, 1, 'exactly one battle receipt');
    });

    it('does NOT refresh lastLiveBattleAt — a real defender still re-locks the garrison', async () => {
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const before = (await loadSectorWar(contest.id))!.lastLiveBattleAt;
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 200, 'the duel must actually resolve, or this passes for the wrong reason');
        const after = (await loadSectorWar(contest.id))!;
        assert.ok((after.attackerPoints + after.defenderPoints) > 0, 'and it must have scored');
        assert.equal(after.lastLiveBattleAt, before);
    });

    it('stays locked while the defence is still fighting', async () => {
        const contest = await seedContest('pet', 10 * 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /still contesting/i, 'and it must say WHY — a live defender, not a cooldown');
        assert.equal((await loadSectorWar(contest.id))!.attackerPoints, 0);
    });

    it('is attacker-only — the defence cannot farm its own garrison', async () => {
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        assert.equal(out.statusCode, 403);
        assert.equal((await loadSectorWar(contest.id))!.defenderPoints, 0);
    });

    it('refuses on a Card sector — each engine owns only its own win-condition', async () => {
        const contest = await seedContest('card', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /not a Pet contest/i);
    });

    it('refuses when the village has no ANBU and no seated Kage to field one', async () => {
        await kv.del(villageStateKey(DEFENDER));
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /no ANBU or Kage/i);
    });

    it('cannot be spammed — the garrison re-forms on the same window it unlocks on', async () => {
        // A Pet garrison duel resolves in ONE request. Without a cooldown an
        // attacker could fire hundreds back to back: garrison points are capped
        // per war so the spam earns nothing, but each one still writes a battle
        // receipt, and that ledger is settlement authority with a hard cap that
        // THROWS when full — filling it would break scoring for every later
        // battle in the war, including real ones.
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const first = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));

        const second = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(second.statusCode, 409, 'a second duel must wait for the garrison to re-form');
        assert.match(String(second.body?.error), /re-forming/i);
        assert.equal((await loadSectorWar(contest.id))!.appliedBattles?.length, 1, 'and it must not have written a second receipt');
    });

    it('starts the re-form cooldown on a LOSS too, not just a win', async () => {
        // The cooldown keys on the `garrison` receipt flag. When that flag marked
        // only attacker WINS, losing left it unset — so an attacker could retry
        // instantly, and every retry both filled the settlement receipt ledger
        // and handed the absent defence more points. Whoever wins, the garrison
        // has to re-form.
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const first = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const receipt = (await loadSectorWar(contest.id))!.appliedBattles![0]!;

        const retry = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(retry.statusCode, 409,
            `a retry must be refused after ${receipt.attackerWon ? 'a win' : 'a LOSS'}`);
        assert.equal((await loadSectorWar(contest.id))!.appliedBattles?.length, 1);
    });

    it('credits an attacker win to the player, and a garrison hold to NOBODY', async () => {
        // `by` feeds the settlement capture credit. An AI holding ground must not
        // hand credit to the ANBU whose kit it borrowed — they never played.
        // This mirrors the Combat garrison's `by: attackerWon ? name : ''`.
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const receipt = (await loadSectorWar(contest.id))!.appliedBattles![0]!;
        // Either outcome is flagged `garrison` — that is what the re-form window
        // keys on. The CAP filters on attackerWon separately, so a hold never
        // eats the attacker's allowance.
        assert.equal(receipt.garrison, true, 'both outcomes are garrison battles');
        if (receipt.attackerWon) {
            assert.equal(receipt.by, RAIDER);
        } else {
            assert.equal(receipt.by, '', 'the AI credits nobody');
        }
    });

    it('never clobbers a pending live duel — the real seat stays open', async () => {
        // The garrison is what you do INSTEAD of waiting, not something that
        // cancels the seat a defender can still walk up and take. Sharing the
        // live table's storage key would have made an attacker's own garrison
        // duel overwrite their still-pending awaiting-defender session, and the
        // defender arriving afterwards would have been told to wait for an
        // attacker who was already there.
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const opened = await call(petHandler, { action: 'join', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.equal((opened.body?.session as { status: string }).status, 'awaiting-defender');

        const garrison = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(garrison.statusCode, 200, JSON.stringify(garrison.body));

        const live = await call(petHandler, { action: 'state', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal((live.body?.session as { status: string }).status, 'awaiting-defender', 'the live seat must survive');
        const held = await call(petHandler, { action: 'state', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal((held.body?.session as { status: string }).status, 'done', 'and the garrison duel reads back on its own key');

        // The defender can still answer the real table afterwards.
        const answered = await call(petHandler, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, petId: 'def1' });
        assert.equal(answered.statusCode, 200, JSON.stringify(answered.body));
        assert.equal((answered.body?.session as { status: string }).status, 'done');
    });

    it('falls back to the seated Kage when no ANBU are appointed', async () => {
        await kv.del(villageStateKey(DEFENDER));
        await kv.set(`village:kage:${DEFENDER.toLowerCase().replace(/\s+/g, '-')}`, { seatedKage: HOLDOUT });
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(petHandler, { action: 'garrison-duel', playerName: RAIDER, sectorWarId: contest.id, petId: 'atk1' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.garrisonDefendedByKage, true);
        assert.equal((out.body?.session as { p2?: { name: string } }).p2?.name, HOLDOUT);
    });
});

describe('Card sector garrison closes the same hole', { concurrency: false }, () => {
    it('opens a real Chronicle match against the defending village garrison deck', async () => {
        const contest = await seedContest('card', IDLE_MS + 60_000);
        const out = await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const session = out.body?.session as { status?: string; aiDeckName?: string };
        assert.ok(session, 'a garrison assault must return a projected match');
        assert.match(String(session.aiDeckName), new RegExp(DEFENDER, 'i'));
    });

    it('stays locked while the defence is still fighting', async () => {
        const contest = await seedContest('card', 10 * 60_000);
        const out = await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /still contesting/i);
    });

    it('is attacker-only', async () => {
        const contest = await seedContest('card', IDLE_MS + 60_000);
        const out = await call(cardHandler, { action: 'join', garrison: true, playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(out.statusCode, 403);
    });

    it('refuses on a Pet sector', async () => {
        const contest = await seedContest('pet', IDLE_MS + 60_000);
        const out = await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /not a Card contest/i);
    });

    it('never writes the DEFENDER\'s save — an assault must not mutate an uninvolved player', async () => {
        const contest = await seedContest('card', IDLE_MS + 60_000);
        const before = JSON.stringify(await kv.get(`save:${ANBU}`));
        await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(JSON.stringify(await kv.get(`save:${ANBU}`)), before);
    });

    it('makes the attacker provably IN A FIGHT while the assault is live', async () => {
        // A garrison assault is a real multi-turn Chronicle match, so it must
        // confer battle presence exactly like a live duel does (c998682d3) and
        // like the Combat garrison already does through its Solo-PvE session.
        // Without it the attacker could be roamed and attacked mid-match -- the
        // same gap that presence pass closed everywhere else.
        const { cardDuelEngages } = await import('../card-clash/_presence.js');
        const contest = await seedContest('card', IDLE_MS + 60_000);
        const out = await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const row = await kv.get(`sector-card-garrison:${contest.id}`);
        assert.ok(cardDuelEngages(row as never, RAIDER), 'the attacker must read as engaged');
        assert.equal(cardDuelEngages(row as never, HOLDOUT), false, 'nobody else is in this fight');
    });

    it('does not disturb the live two-player table — they are separate sessions', async () => {
        const contest = await seedContest('card', IDLE_MS + 60_000);
        await call(cardHandler, { action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.ok(await kv.get(`sector-card-garrison:${contest.id}`), 'the garrison lives under its own key');
        assert.equal(await kv.get(`sector-card:${contest.id}`), null, 'the live table must be untouched');
    });
});
