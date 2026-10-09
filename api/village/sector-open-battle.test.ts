import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-open-battle-secret-32-bytes-long';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * Open-world battles in a Pet or Card sector war (owner ruling 2026-10-08),
 * through the real handlers on the memory store. A member of either side who
 * attacks an enemy standing in the contested sector fights THAT player in the
 * war's own game, and the winner's village scores — the way a Combat war is
 * fought in the open. The war's table is untouched.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, any> };

const SECTOR = 44;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'openraider';
const SECOND = 'openwingman';
const HOLDOUT = 'openholdout';
const GUARD = 'openguard';
const BYSTANDER = 'openbystander';

let petHandler: Handler;
let cardHandler: Handler;
let OPEN_BATTLE_LOSER_SHIELD_MS: number;
let PVP_RAID_SHIELD_MS: number;
let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

function pet(id: string, name: string) {
    return { id, name, rarity: 'common', hp: 60, attack: 20, defense: 15, speed: 12, level: 5, element: 'None' };
}

const PLAYERS = [
    [RAIDER, ATTACKER, [pet('r1', 'Ashfang'), pet('r2', 'Emberpaw')]],
    [SECOND, ATTACKER, [pet('w1', 'Cinderjaw'), pet('w2', 'Smokecoat')]],
    [HOLDOUT, DEFENDER, [pet('h1', 'Frostmaw'), pet('h2', 'Glaciertail')]],
    [GUARD, DEFENDER, [pet('g1', 'Snowhide')]],
    [BYSTANDER, 'Stormveil Village', [pet('b1', 'Galehound')]],
] as const;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ OPEN_BATTLE_LOSER_SHIELD_MS } = await import('../_sector-contest-engage.js'));
    ({ PVP_RAID_SHIELD_MS } = await import('../pvp/_vitals-settlement.js'));
    const petModule = await import('./sector-pet.js');
    const cardModule = await import('./sector-card.js');
    petHandler = ((petModule.default as unknown as { default?: Handler })?.default ?? petModule.default) as unknown as Handler;
    cardHandler = ((cardModule.default as unknown as { default?: Handler })?.default ?? cardModule.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    resetRateLimits();
    for (const [slug, village, pets] of PLAYERS) {
        await kv.set(`save:${slug}`, { character: { name: slug, village, level: 30, pets, activePetId: pets[0].id } });
        stand(slug, village, SECTOR);
    }
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function stand(name: string, village: string, sector: number) {
    // A fresh presence row: an upsert does not move a player who is already
    // online to another sector (that is travel's job).
    onlineStore.remove(name);
    onlineStore.upsert({ name, sector, character: { name, village, level: 30 } } as never);
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
    await handler({
        method: 'POST', body,
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function seedContest(winCondition: 'pet' | 'card') {
    const contest = war.newSectorWarSession({
        sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition, now: Date.now() - 60 * 60 * 1000,
    });
    await kv.set(war.sectorWarKey(contest.id), contest);
    return contest;
}

async function ledgerOf(id: string) {
    const row = war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
    return { receipts: row.appliedBattles ?? [], row };
}

async function inboxOf(name: string): Promise<Array<Record<string, any>>> {
    return (await kv.get<Array<Record<string, any>>>(`challenges:${name}`)) ?? [];
}

/** Give a player a live post-defeat shield (Field Recovery), on a versioned save. */
async function shield(name: string) {
    const save = await kv.get<Record<string, any>>(`save:${name}`);
    await kv.set(`save:${name}`, {
        ...save, _saveVersion: 1, _saveAt: Date.now(),
        character: {
            ...save!.character, hp: 500, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            pvpShieldUntil: Date.now() + 90_000,
        },
    });
}

const STRONG = [1, 2].map((n) => ({ id: `titan${n}`, name: `Titan ${n}`, rarity: 'mythic', hp: 2310, attack: 300, defense: 215, speed: 225, level: 50, element: 'None' }));
const WEAK = [1, 2].map((n) => ({ id: `runt${n}`, name: `Runt ${n}`, rarity: 'common', hp: 20, attack: 2, defense: 1, speed: 1, level: 1, element: 'None' }));

/** Field a team that decides the next pet battle: STRONG wins it, WEAK loses it. */
async function field(name: string, pets: typeof STRONG) {
    const save = await kv.get<Record<string, any>>(`save:${name}`);
    await kv.set(`save:${name}`, { ...save, character: { ...save!.character, pets, activePetId: pets[0].id } });
}

/** The shield's clear is best-effort and non-blocking (as a Combat raid's), so let it land. */
async function shieldSpent(name: string): Promise<boolean> {
    for (let i = 0; i < 40; i += 1) {
        const until = Math.floor(Number((await kv.get<Record<string, any>>(`save:${name}`))?.character?.pvpShieldUntil ?? 0));
        if (!until) return true;
        await new Promise((resolve) => setImmediate(resolve));
    }
    return false;
}

describe('an open-world attack in a Pet war is a pet battle with that player', { concurrency: false }, () => {
    it('fights both sealed teams at once, scores it for the winner\'s village, and tells the target', async () => {
        const contest = await seedContest('pet');
        const out = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const engageId = String(out.body?.engageId ?? '');
        assert.match(engageId, /^[a-f0-9]{24}$/);
        const session = out.body?.session;
        assert.equal(session.status, 'done', 'a pet battle resolves at once');
        assert.equal(session.p1.name, RAIDER, 'seat p1 is the attacking village');
        assert.equal(session.p2.name, HOLDOUT);
        assert.equal(session.viewerSide, 'p1');
        assert.equal(session.warResult?.scored, true);

        const { receipts, row } = await ledgerOf(contest.id);
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].battleId, `pet-open:${contest.id}:${engageId}`);
        assert.equal(row.attackerPoints + row.defenderPoints > 0, true, 'the winner\'s village scored');
        assert.ok((row.lastLiveBattleAt ?? 0) > 0, 'two live players: it re-locks the garrison like any live battle');

        const notice = (await inboxOf(HOLDOUT)).find((entry) => entry.sectorContest?.engageId === engageId);
        assert.ok(notice, 'the target hears of it at once');
        assert.deepEqual(notice.sectorContest, { kind: 'pet', sectorWarId: contest.id, engageId });
        assert.equal(notice.sectorAttack, true);
        assert.equal(notice.fromName, RAIDER);
    });

    it('either side may start it, and the attacking village still holds seat p1', async () => {
        const contest = await seedContest('pet');
        const out = await call(petHandler, { action: 'engage', playerName: HOLDOUT, sectorWarId: contest.id, target: RAIDER });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.session.p1.name, RAIDER);
        assert.equal(out.body?.session.p2.name, HOLDOUT);
        assert.equal(out.body?.session.viewerSide, 'p2');
    });

    it('both fighters can watch it back; a village outside the war cannot', async () => {
        const contest = await seedContest('pet');
        const out = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        const engageId = out.body?.engageId;
        const watched = await call(petHandler, { action: 'watch', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal(watched.statusCode, 200, JSON.stringify(watched.body));
        assert.ok(watched.body?.script, 'the target replays the battle their pets fought');
        const state = await call(petHandler, { action: 'state', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal(state.body?.session.viewerSide, 'p2');
        const outsider = await call(petHandler, { action: 'state', playerName: BYSTANDER, sectorWarId: contest.id, engageId });
        assert.equal(outsider.statusCode, 403);
    });

    it('uses a Combat attack\'s gates: same sector, the war\'s two sides, a target who is online', async () => {
        const contest = await seedContest('pet');
        stand(HOLDOUT, DEFENDER, SECTOR + 1);
        const elsewhere = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(elsewhere.statusCode, 409, 'the target must be standing in your sector');
        stand(HOLDOUT, DEFENDER, SECTOR);

        const ally = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: SECOND });
        assert.equal(ally.statusCode, 403, 'two members of one village do not fight the war');
        const outsider = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: BYSTANDER });
        assert.equal(outsider.statusCode, 403, 'a third village is not in this war');

        onlineStore.remove(HOLDOUT);
        const offline = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(offline.statusCode, 404);
        assert.equal((await ledgerOf(contest.id)).receipts.length, 0, 'a refused attack scores nothing');
    });

    it('the winner may fight again at once; the loser cannot be challenged for two minutes', async () => {
        // Owner ruling 2026-10-09: no cooldown for the winner. The loser has a
        // Combat defeat's protection, which is what stops a strong team farming
        // one weaker player for uncapped points.
        const contest = await seedContest('pet');
        await field(RAIDER, STRONG);
        await field(HOLDOUT, WEAK);
        const first = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.session.winner, 'p1', 'the strong team won');
        // The target's heartbeat clears the "is attacking you" flag in play.
        onlineStore.clearPendingAttacker(HOLDOUT);

        const next = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: GUARD });
        assert.equal(next.statusCode, 200, `the winner fights again at once: ${JSON.stringify(next.body)}`);

        for (const challenger of [SECOND, RAIDER]) {
            const refused = await call(petHandler, { action: 'engage', playerName: challenger, sectorWarId: contest.id, target: HOLDOUT });
            assert.equal(refused.statusCode, 409, `${challenger} cannot challenge the loser yet`);
            assert.match(String(refused.body?.error), /just lost a battle/);
            assert.ok(refused.body?.retryAfterMs > 60_000 && refused.body?.retryAfterMs <= OPEN_BATTLE_LOSER_SHIELD_MS);
        }

        // Two minutes on, the protection has run out.
        const key = `sector-open-battle:shield:${contest.id}:${HOLDOUT}`;
        await kv.set(key, { until: Date.now() - 1 });
        const later = await call(petHandler, { action: 'engage', playerName: SECOND, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(later.statusCode, 200, JSON.stringify(later.body));
        assert.equal((await ledgerOf(contest.id)).receipts.length, 3, 'every battle fought scored');
    });

    it('a loser who starts a battle of their own ends their protection', async () => {
        const contest = await seedContest('pet');
        await field(RAIDER, STRONG);
        await field(HOLDOUT, WEAK);
        assert.equal((await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT })).statusCode, 200);
        onlineStore.clearPendingAttacker(HOLDOUT);

        await field(HOLDOUT, STRONG);
        await field(SECOND, WEAK);
        const revenge = await call(petHandler, { action: 'engage', playerName: HOLDOUT, sectorWarId: contest.id, target: SECOND });
        assert.equal(revenge.statusCode, 200, JSON.stringify(revenge.body));
        assert.equal(revenge.body?.session.winner, 'p2', 'the defender won this one');
        const back = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(back.statusCode, 200, `a player who chose to fight again can be fought: ${JSON.stringify(back.body)}`);
    });

    it('a fighter whose battle is still being decided is not drawn into another', async () => {
        // Two challengers at the same instant: the first holds the target while
        // its battle is decided. The hold is released the moment it is.
        const contest = await seedContest('pet');
        await kv.set(`sector-open-battle:hold:${contest.id}:${HOLDOUT}`, { until: Date.now() + 30_000 });
        const second = await call(petHandler, { action: 'engage', playerName: SECOND, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(second.statusCode, 409);
        assert.match(String(second.body?.error), /already in a battle/);
        await kv.del(`sector-open-battle:hold:${contest.id}:${HOLDOUT}`);
        const first = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(await kv.get(`sector-open-battle:hold:${contest.id}:${RAIDER}`), null, 'decided: no hold remains');
        assert.equal(await kv.get(`sector-open-battle:hold:${contest.id}:${HOLDOUT}`), null);
    });

    it('protects a loser exactly as long as a Combat defeat does', () => {
        assert.equal(OPEN_BATTLE_LOSER_SHIELD_MS, PVP_RAID_SHIELD_MS);
    });

    it('is only a Pet war\'s battle', async () => {
        const contest = await seedContest('card');
        const out = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(out.statusCode, 409);
    });

    it('starting one spends the challenger\'s own post-defeat shield, as a Combat raid does', async () => {
        // Otherwise a shielded player could start battles nobody could start back.
        const contest = await seedContest('pet');
        await shield(RAIDER);
        const out = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(await shieldSpent(RAIDER), true);
    });

    it('a refused one leaves the shield alone', async () => {
        const contest = await seedContest('pet');
        await shield(RAIDER);
        const ally = await call(petHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: SECOND });
        assert.equal(ally.statusCode, 403);
        assert.equal(await shieldSpent(RAIDER), false);
    });
});

describe('an open-world attack in a Card war is a card duel with that player', { concurrency: false }, () => {
    async function engage(contestId: string, from = RAIDER, target = HOLDOUT) {
        const out = await call(cardHandler, { action: 'engage', playerName: from, sectorWarId: contestId, target });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        return String(out.body?.engageId ?? '');
    }

    it('names both seats, tells the target, and the target\'s join deals the match', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id);
        const waiting = await call(cardHandler, { action: 'state', playerName: RAIDER, sectorWarId: contest.id, engageId });
        assert.equal(waiting.body?.session.status, 'awaiting-target');
        assert.equal(waiting.body?.session.opponent, HOLDOUT);
        const notice = (await inboxOf(HOLDOUT)).find((entry) => entry.sectorContest?.engageId === engageId);
        assert.deepEqual(notice?.sectorContest, { kind: 'card', sectorWarId: contest.id, engageId });

        const stranger = await call(cardHandler, { action: 'join', playerName: SECOND, sectorWarId: contest.id, engageId });
        assert.equal(stranger.statusCode, 403, 'only the named duelists may take its seats');

        const joined = await call(cardHandler, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal(joined.statusCode, 200, JSON.stringify(joined.body));
        assert.equal(joined.body?.session.viewerSide, 'p2');
        assert.ok(joined.body?.session.p1, 'a real match projection');
        const live = await call(cardHandler, { action: 'state', playerName: RAIDER, sectorWarId: contest.id, engageId });
        assert.equal(live.body?.session.viewerSide, 'p1');
        assert.equal(live.body?.session.status, 'active');
    });

    it('a finished duel scores once, for the winner\'s village', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id, HOLDOUT, RAIDER);
        assert.equal((await call(cardHandler, { action: 'join', playerName: RAIDER, sectorWarId: contest.id, engageId })).statusCode, 200);
        const forfeited = await call(cardHandler, { action: 'forfeit', playerName: RAIDER, sectorWarId: contest.id, engageId });
        assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
        assert.equal(forfeited.body?.warResult?.scored, true);
        const { receipts, row } = await ledgerOf(contest.id);
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].battleId, `card-open:${contest.id}:${engageId}`);
        assert.equal(receipts[0].attackerWon, false, 'the defending village won it, though it started the fight');
        assert.ok(row.defenderPoints > 0);
        await call(cardHandler, { action: 'state', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal((await ledgerOf(contest.id)).receipts.length, 1, 'a later poll never scores it twice');
    });

    it('an unanswered challenge goes void and scores nothing', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id);
        const key = `sector-card-open:${engageId}`;
        const row = await kv.get<Record<string, any>>(key);
        await kv.set(key, { ...row, open: { ...row!.open, joinBy: Date.now() - 1 } });
        const late = await call(cardHandler, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal(late.body?.session.status, 'void', 'a target who never took their seat in time deals no match');
        assert.equal((await ledgerOf(contest.id)).receipts.length, 0);
    });

    it('the challenger walking away calls it off, so a late target never deals a match they would forfeit', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id);
        const cancelled = await call(cardHandler, { action: 'cancel', playerName: RAIDER, sectorWarId: contest.id, engageId });
        assert.equal(cancelled.body?.session.status, 'void');
        const late = await call(cardHandler, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, engageId });
        assert.equal(late.body?.session.status, 'void');
    });

    it('neither duelist can be drawn into a second duel before the first one starts', async () => {
        // Until the challenged player sits down, neither counts as in a battle.
        // A second challenge then would pull the target out of the first duel,
        // which their absence would then forfeit.
        const contest = await seedContest('card');
        await engage(contest.id);
        onlineStore.clearPendingAttacker(HOLDOUT); // the target's next heartbeat
        const second = await call(cardHandler, { action: 'engage', playerName: SECOND, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(second.statusCode, 409, JSON.stringify(second.body));
        assert.match(String(second.body?.error), /card duel waiting to begin/);
        const elsewhere = await call(cardHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: GUARD });
        assert.equal(elsewhere.statusCode, 409, 'the challenger cannot open a second duel meanwhile');
        assert.match(String(elsewhere.body?.error), /You already have a card duel waiting/);
    });

    it('a duel its challenger calls off frees both at once; only that challenger waits to ask that player again', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id);
        await call(cardHandler, { action: 'cancel', playerName: RAIDER, sectorWarId: contest.id, engageId });
        onlineStore.clearPendingAttacker(HOLDOUT);
        const sameAgain = await call(cardHandler, { action: 'engage', playerName: RAIDER, sectorWarId: contest.id, target: HOLDOUT });
        assert.equal(sameAgain.statusCode, 409, 'no pulling a player into a duel and out of it on repeat');
        assert.match(String(sameAgain.body?.error), /called off a duel with them/);
        assert.ok(await engage(contest.id, SECOND, HOLDOUT), 'another challenger may take the freed target');
        onlineStore.clearPendingAttacker(GUARD);
        assert.ok(await engage(contest.id, RAIDER, GUARD), 'the challenger is free to fight someone else');
    });

    it('a live duel holds nobody, and once decided only its loser is protected', async () => {
        const contest = await seedContest('card');
        const engageId = await engage(contest.id);
        assert.equal((await call(cardHandler, { action: 'join', playerName: HOLDOUT, sectorWarId: contest.id, engageId })).statusCode, 200);
        assert.equal(await kv.get(`sector-open-battle:hold:${contest.id}:${RAIDER}`), null, 'the live match itself keeps them out of other fights');
        assert.equal(await kv.get(`sector-open-battle:hold:${contest.id}:${HOLDOUT}`), null);

        const forfeited = await call(cardHandler, { action: 'forfeit', playerName: RAIDER, sectorWarId: contest.id, engageId });
        assert.equal(forfeited.body?.warResult?.scored, true, JSON.stringify(forfeited.body));
        onlineStore.clearPendingAttacker(HOLDOUT);
        onlineStore.clearPendingAttacker(SECOND);
        assert.ok(await engage(contest.id, HOLDOUT, SECOND), 'the winner duels again at once');
        const loser = await call(cardHandler, { action: 'engage', playerName: GUARD, sectorWarId: contest.id, target: RAIDER });
        assert.equal(loser.statusCode, 409);
        assert.match(String(loser.body?.error), /just lost a battle/);
    });

    it('challenging one spends the challenger\'s own post-defeat shield', async () => {
        const contest = await seedContest('card');
        await shield(HOLDOUT);
        await engage(contest.id, HOLDOUT, RAIDER);
        assert.equal(await shieldSpent(HOLDOUT), true);
    });

    it('the war\'s table still works as before', async () => {
        const contest = await seedContest('card');
        await engage(contest.id);
        const table = await call(cardHandler, { action: 'join', playerName: SECOND, sectorWarId: contest.id });
        assert.equal(table.statusCode, 200, JSON.stringify(table.body));
        assert.equal(table.body?.session.status, 'awaiting-defender', 'an attacker can still open the war\'s table');
    });
});
