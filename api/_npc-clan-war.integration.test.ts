import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { PvpSession } from './pvp/session.js';
import type { ClanWar } from './clan/war/_storage.js';

// Cinderhold's three clans (owner rulings 2026-11-10), end to end through the
// real handlers on the in-memory store: the seed founds three clans of ten that
// the clan-war roster rule accepts; nobody can join one; an NPC token over HTTP
// cannot declare, surrender or leave; a player clan declares on one through the
// normal declare; an NPC answers a queued player in the Shinobi Duel (the server
// plays its seat and the duel scores), the Pet Showdown and the Chronicle
// Showdown; the NPC side is never paid and never ranks; and a Cinderhold clan
// never declares a clan war itself (owner ruling 2026-11-10).

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-clan-war-integration-secret-32chars';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
process.env.ADMIN_PASSWORD = 'npc-clan-war-admin';
delete process.env.DISABLE_NPC_VILLAGE;

const MOON = 'Moonshadow Village';
const DAY = 86_400_000;
const PLAYER_CLAN = 'Lunar Tide';
const SECOND_CLAN = 'Silver Owl';

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let clans: typeof import('../shared/npc-clans.js');
let tick: typeof import('./_npc-clan-war-campaign.js');
let driver: typeof import('./_npc-duel-driver.js');

function unwrap(mod: { default: unknown }) {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as (req: unknown, res: unknown) => Promise<unknown>;
}

let seq = 0;
async function call(handler: unknown, name: string | null, body: Record<string, unknown> | null, method = 'POST', query: Record<string, string> = {}, headers: Record<string, string> = {}) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, getHeader: () => undefined, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res, send: () => res };
    const ip = `10.93.${Math.floor(++seq / 250)}.${seq % 250}`;
    await (handler as (req: unknown, res: unknown) => Promise<unknown>)({
        method, body: body ?? undefined, query,
        headers: { ...(name ? { 'x-player-token': token(name), 'x-player-name': name } : {}), 'x-forwarded-for': ip, ...headers },
        socket: { remoteAddress: ip },
    }, res);
    return out;
}

function playerCharacter(name: string, clan: string, extra: Record<string, unknown> = {}) {
    return { name, level: 20, village: MOON, clan, ryo: 0, honorSeals: 300, unspentStats: 0, hp: 2000, maxHp: 2000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [], ...extra };
}

/** A player clan of four, founded ten days ago, every member war-eligible. */
async function seedPlayerClan(name: string, prefix: string, pets: unknown[] = []): Promise<string[]> {
    const now = Date.now(), createdAt = now - 10 * DAY;
    const names = Array.from({ length: 4 }, (_, i) => `${prefix}${i}`);
    await kv.set(`save:clan-${clans.npcClanBareSlug(name)}`, { name, founderName: names[0], village: MOON, createdAt, serverCreatedAt: createdAt,
        members: names.map((member) => ({ name: member, level: 20 })), memberJoinedAt: Object.fromEntries(names.map((member) => [member, createdAt])),
        xp: 0, level: 1, treasury: { ryo: 0, warSupply: 0, items: [] }, upgrades: {}, notices: [], joinRequests: [], warHistory: [] });
    const registry = (await kv.get<Record<string, unknown>>('player:registry')) ?? {};
    for (const member of names) {
        await kv.set(`save:${member}`, { _saveVersion: 1, character: playerCharacter(member, name, { clanFounder: member === names[0], pets, activePetId: (pets[0] as { id?: string } | undefined)?.id }) });
        await kv.set(`auth:${member}`, { createdAt: createdAt, hash: 'x', salt: 'y' });
        registry[member] = { lastSeen: now, village: MOON, level: 20 };
    }
    await kv.set('player:registry', registry);
    return names;
}

const warOf = async (id: string) => (await kv.get<ClanWar>(`clan-war:${id}`))!;
/** Opens the campaign now (the QA harness's "advance", api/_qa-clan-campaign.ts). */
async function openCampaign(id: string) {
    const war = await warOf(id);
    const c = war.campaign!, delta = Date.now() - 1000 - c.startsAt;
    await kv.set(`clan-war:${id}`, { ...war, campaign: { ...c, startsAt: c.startsAt + delta, endsAt: c.endsAt + delta,
        shrines: c.shrines.map((s) => ({ ...s, opensAt: s.opensAt + delta + 10 * DAY, closesAt: s.closesAt + delta + 10 * DAY })) } });
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    clans = await import('../shared/npc-clans.js');
    tick = await import('./_npc-clan-war-campaign.js');
    tick.setNpcClanCardBeatForTest(0);
    driver = await import('./_npc-duel-driver.js');
    driver.setNpcActionBeatForTest(0);
    (await import('./_npc-presence.js')).setNpcTravelMsForTest(0);
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

describe('Cinderhold clans and clan wars', { concurrency: false }, () => {
    let warId = '';
    let players: string[] = [];

    it('the seed founds three clans of ten that the clan-war roster rule accepts, and a reseed keeps what the server wrote', async () => {
        const { loadClanWarEligibleRoster } = await import('./clan/war/_campaign-declare.js');
        const registry = (await kv.get<Record<string, { lastSeen?: unknown }>>('player:registry')) ?? {};
        const now = Date.now();
        for (const clan of clans.NPC_CLANS) {
            const record = (await kv.get<Record<string, any>>(`save:clan-${clans.npcClanBareSlug(clan.name)}`))!;
            assert.ok(record, clan.name);
            assert.ok(clans.isNpcClanRecord(record));
            assert.equal(record.members.length, 10);
            assert.equal(record.village, 'Cinderhold Village');
            assert.ok(now - record.serverCreatedAt >= 8 * DAY, 'founded at least eight days back');
            assert.deepEqual(record.upgrades, {});
            assert.equal(record.treasury.ryo, 0);
            const roster = await loadClanWarEligibleRoster(record, registry, now);
            assert.ok(roster.members.length >= 4, `${clan.name} fields ${roster.members.length} eligible members`);
            for (const id of clan.members) {
                const character = (await kv.get<Record<string, any>>(`save:${id}`))!.character;
                assert.equal(character.clan, clan.name);
                assert.equal(character.clanFounder, id === clan.founder);
            }
        }
        // Server-written state survives a rebuild; the founding date never moves.
        const key = 'save:clan-ashenfang';
        const before = (await kv.get<Record<string, any>>(key))!;
        await kv.set(key, { ...before, campaignHistory: [{ instanceId: 'kept' }], treasury: { ryo: 999 } });
        const { seedNpcClans } = await import('./_npc-village-seed.js');
        await seedNpcClans(Date.now() + DAY);
        const after = (await kv.get<Record<string, any>>(key))!;
        assert.deepEqual(after.campaignHistory, [{ instanceId: 'kept' }]);
        assert.equal(after.serverCreatedAt, before.serverCreatedAt);
        assert.deepEqual(after.memberJoinedAt, before.memberJoinedAt);
        assert.equal(after.treasury.ryo, 0, 'no treasury: Cinderhold clans hold nothing');
    });

    it('nobody can join, request to join, re-found or dissolve a Cinderhold clan', async () => {
        players = await seedPlayerClan(PLAYER_CLAN, 'tide');
        const save = unwrap(await import('./save/[name].js'));
        const record = (await kv.get<Record<string, any>>('save:clan-ashenfang'))!;
        const target = { name: 'clan-ashenfang' };
        const joinRequest = await call(save, 'tide1', { ...record, joinRequests: [{ name: 'tide1', level: 20, requestedAt: Date.now() }] }, 'POST', target);
        assert.equal(joinRequest.status, 403, JSON.stringify(joinRequest.body));
        const selfAdd = await call(save, 'tide1', { ...record, members: [...record.members, { name: 'tide1', level: 20 }] }, 'POST', target);
        assert.equal(selfAdd.status, 403);
        assert.equal((await kv.get<Record<string, any>>('save:clan-ashenfang'))!.members.length, 10);
        // No player clan can take a Cinderhold clan's name either.
        const squat = await call(save, 'tide2', { name: 'Ember Ward', founderName: 'tide2', village: MOON, members: [{ name: 'tide2' }] }, 'POST', { name: 'clan-emberward' });
        assert.equal(squat.status, 403);
        // Under admin control the founder cannot dissolve it either.
        const founder = clans.NPC_CLANS[0]!.founder;
        const dissolve = await call(save, founder, null, 'DELETE', target);
        assert.equal(dissolve.status, 403, JSON.stringify(dissolve.body));
        assert.notEqual(dissolve.status, 200);
        assert.ok(await kv.get('save:clan-ashenfang'), 'the clan still stands');
        // A player clan still cannot enlist an NPC.
        const { withoutNewNpcMembers } = await import('./save/[name].js');
        const enlisted = withoutNewNpcMembers({ members: [] }, { members: [{ name: founder }] });
        assert.deepEqual(enlisted.members, []);
    });

    it('a Cinderhold shinobi cannot leave its clan through its own save, even under admin control', async () => {
        const save = unwrap(await import('./save/[name].js'));
        const { npcPossessKey } = await import('./_npc-possession.js');
        const founder = clans.NPC_CLANS[0]!.founder;
        const now = Date.now();
        await kv.set(npcPossessKey(founder), { by: 'admin', at: now, expiresAt: now + 60 * 60_000 });
        try {
            const stored = (await kv.get<Record<string, any>>(`save:${founder}`))!;
            const leaving = { ...stored, _baseSaveVersion: Number(stored._saveVersion ?? 0), character: { ...stored.character, clan: '', clanFounder: false } };
            const out = await call(save, founder, leaving, 'POST', { name: founder });
            assert.equal(out.status, 200, JSON.stringify(out.body).slice(0, 300));
            const after = (await kv.get<Record<string, any>>(`save:${founder}`))!;
            assert.equal(after.character.clan, 'Ashen Fang', 'the clan is the server\'s, not the save\'s');
            assert.equal(after.character.clanFounder, true);
        } finally {
            await kv.del(npcPossessKey(founder));
        }
    });

    it('an NPC token over HTTP cannot declare, surrender, withdraw, leave or kick', async () => {
        const guard = await import('./_npc-guard.js');
        for (const route of ['/clan/war/declare', '/clan/leave', '/clan/kick', '/clan/upgrade/purchase', '/clan-boss/assault-start']) {
            assert.ok(guard.NPC_BLOCKED_ROUTES.includes(route), route);
        }
        const founder = clans.NPC_CLANS[0]!.founder;
        const leave = guard.refuseNpcAccounts(unwrap(await import('./clan/leave.js')) as never);
        assert.equal((await call(leave, founder, { clan: 'Ashen Fang' })).status, 403);
        // Even reached in-process, the declare refuses an NPC.
        const declare = unwrap(await import('./clan/war/declare.js'));
        const byHand = await call(declare, founder, { toClan: PLAYER_CLAN, funding: 'pool', requestId: 'npc-by-hand-declare-01' });
        assert.equal(byHand.status, 403, JSON.stringify(byHand.body));
        const queue = unwrap(await import('./clan/war/queue.js'));
        for (const action of ['surrender', 'withdraw', 'provisions']) {
            assert.equal((await call(queue, founder, { warId: 'ashenfang-vs-lunartide', action })).status, 403, action);
        }
    });

    it('a player clan declares on a Cinderhold clan through the normal declare', async () => {
        const declare = unwrap(await import('./clan/war/declare.js'));
        const declared = await call(declare, players[0]!, { toClan: 'Ashen Fang', funding: 'personal', requestId: 'player-declares-on-npc-01' });
        assert.equal(declared.status, 200, JSON.stringify(declared.body));
        warId = String(declared.body.war.id);
        const war = await warOf(warId);
        const npcRoster = war.campaign!.rosters.find((r) => r.clan === 'Ashen Fang')!;
        assert.ok(npcRoster.members.length >= 4);
        assert.ok(npcRoster.members.every((m) => clans.NPC_CLANS[0]!.members.includes(m.name)));
        assert.equal((await kv.get<Record<string, any>>(`save:${players[0]}`))!.character.honorSeals, 200, 'the player paid the normal fee');
    });

    it('an NPC answers a queued player in the Shinobi Duel; the server plays its seat and the duel scores the war', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.after(() => mock.timers.reset());
        await openCampaign(warId);
        const queue = unwrap(await import('./clan/war/queue.js'));
        const me = players[1]!;
        // Nobody waits, so no NPC queues.
        assert.deepEqual((await tick.runNpcClanWarCampaign()).joined, []);
        assert.equal((await call(queue, me, { warId, action: 'join', mode: 'pvp1v1' })).status, 200);
        const first = await tick.runNpcClanWarCampaign();
        const answer = first.joined.find((j) => j.ok);
        assert.ok(answer, `an NPC joins the duel queue: ${JSON.stringify(first.joined)}`);
        let war = await warOf(warId);
        const match = Object.values(war.campaign!.matches).find((m) => m.status === 'ready')!;
        assert.ok(match, 'the real queue paired them');
        assert.ok([...match.fromPlayers, ...match.toPlayers].includes(answer!.npc));
        const second = await tick.runNpcClanWarCampaign();
        assert.ok(second.ready.some((r) => r.ok && r.npc === answer!.npc), 'the NPC confirms the ready check');
        assert.equal((await call(queue, me, { warId, action: 'ready', matchId: match.id })).status, 200);
        war = await warOf(warId);
        const challenge = war.pendingChallenges.find((c) => c.id === match.id)!;
        assert.ok(challenge, 'the match is admitted');

        // The player's client opens the duel as always.
        const session = unwrap(await import('./pvp/session.js'));
        const created = await call(session, me, { clanWarId: warId, clanWarChallengeId: challenge.id, baseRewards: true,
            p1Character: { name: challenge.fromPlayer }, p2Character: { name: challenge.acceptedPlayer } });
        assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 400));
        const battleId = String(created.body.battleId);
        const sealed = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(sealed.rewardAuthority, 'clan-war');
        // The player gets the base purse a clan-war duel against a player clan
        // pays; the war's daily slots bound it, so no NPC paid slot is spent.
        assert.equal(sealed.npcDuel?.paid, true, 'a clan-war duel with an NPC pays the player like any clan-war duel');
        const { npcDuelDayKey } = await import('./_npc-duel.js');
        assert.equal(await kv.get(npcDuelDayKey(me, Date.now())), null, 'no NPC paid slot is spent');
        const mySeat = String(sealed.p1.name).toLowerCase() === me ? 'p1' : 'p2';
        const npcSeat = mySeat === 'p1' ? 'p2' : 'p1';
        const move = unwrap(await import('./pvp/move.js'));
        assert.equal((await call(move, me, { battleId, role: mySeat, action: 'join', moveToken: 'join-me' })).status, 200);
        await driver.driveNpcDuel(battleId, npcSeat);
        mock.timers.tick(10_000);
        for (let guard = 0; guard < 400; guard++) {
            const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
            if (live.status === 'done') break;
            if (live.activePlayer === mySeat && live.joined?.[npcSeat]) await call(move, me, { battleId, role: mySeat, action: 'wait', moveToken: `w${guard}` });
            else await driver.driveNpcDuel(battleId, npcSeat);
            mock.timers.tick(1_000);
        }
        const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(done.status, 'done');
        assert.equal(done.joined?.p1 && done.joined?.p2, true);
        // Whichever side won, it is scored and paid as a duel between two players.
        assert.ok(done.winner === 'p1' || done.winner === 'p2', `a decided fight: ${JSON.stringify(done.log.slice(-4))}`);
        assert.ok(Number(done.round) >= 1 && !('terminalReason' in done && (done as { terminalReason?: string }).terminalReason === 'no-show'), 'a played fight, not a no-show');
        const playerWon = done.winner === mySeat;
        const save = async (name: string) => (await kv.get<Record<string, any>>(`save:${name}`))!.character;
        const ryoBefore = Number((await save(me)).ryo) || 0, npcRyoBefore = Number((await save(answer!.npc)).ryo) || 0;        const claim = unwrap(await import('./pvp/claim-rewards.js'));
        const claimed = await call(claim, me, { playerName: me, battleId, outcome: playerWon ? 'win' : 'loss', completionVersion: 1 });
        assert.equal(claimed.status, 200, JSON.stringify(claimed.body).slice(0, 300));
        assert.equal(claimed.body.rewardAuthorized, true, 'the duel is reward-authorized, as a player-vs-player clan-war duel is');
        for (let i = 0; i < 5 && (await driver.driveNpcDuel(battleId, npcSeat)) !== 'finished'; i++) mock.timers.tick(1_000);
        // The purse (on a win) or the loss credit (on a loss) is exactly what the
        // shared PvP valid-fight rules price this fight at between two players.
        const vf = await import('./pvp/_valid-fight.js');
        const winnerSlug = playerWon ? me : answer!.npc, loserSlug = playerWon ? answer!.npc : me;
        const fight = await vf.resolvePvpFightCredit(kv, { session: done, battleId, winnerSlug, loserSlug,
            winnerChar: await save(winnerSlug), loserChar: await save(loserSlug), terminalAt: Number(done.endedAt), role: playerWon ? 'win' : 'loss', assignSlot: false });
        const expectedRyo = vf.pvpCreditRyo(fight, { role: playerWon ? 'win' : 'loss', sector: done.rewardSector, stronghold: done.rewardStronghold });
        assert.equal((Number((await save(me)).ryo) || 0) - ryoBefore, expectedRyo, `the player's ${playerWon ? 'purse' : 'loss credit'} is the PvP one: ${JSON.stringify(fight)}`);
        if (playerWon) assert.ok(expectedRyo > 0, 'a win over a higher-level shinobi pays a real purse');
        assert.equal(Number((await save(answer!.npc)).ryo) || 0, npcRyoBefore, 'the NPC is never paid');
        const { reconcileClanWarCampaign } = await import('./clan/war/_campaign-reconcile.js');
        await reconcileClanWarCampaign(warId);
        war = await warOf(warId);
        const scored = war.campaign!.matches[match.id]!;
        assert.equal(scored.status, 'completed', JSON.stringify(scored));
        const slug = (name: unknown) => String(name ?? '').toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        assert.equal(scored.result, slug(sealed[done.winner as 'p1' | 'p2'].name) === slug(challenge.fromPlayer) ? 'from-wins' : 'to-wins',
            `the real winner is scored: ${JSON.stringify({ winner: done.winner, p1: sealed.p1.name, p2: sealed.p2.name, from: challenge.fromPlayer, result: scored.result })}`);
        const winnerClan = scored.result === 'from-wins' ? scored.fromClan : scored.toClan;
        assert.equal(winnerClan, playerWon ? PLAYER_CLAN : 'Ashen Fang');
        assert.ok((war.campaign!.scores[winnerClan] ?? 0) > 0, 'the winner scored War Points');
        // The player gets the clan-war match reward a player-vs-player match pays; the NPC nothing.
        const { CLAN_WAR_RULES } = await import('../shared/clan-war-campaign.js');
        const mine = await save(me);
        assert.ok(Object.keys(mine.clanWarRewardReceipts ?? {}).length > 0, 'the player was credited the normal clan-war reward');
        const earned = (mine.clanPointHistory ?? []).filter((entry: { metadata?: { warId?: string } }) => entry.metadata?.warId === warId)
            .reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0);
        assert.equal(earned, CLAN_WAR_RULES.participationPoints + (playerWon ? CLAN_WAR_RULES.matchWinPoints : 0), 'participation, plus the win on a win');
        const npcSave = await save(answer!.npc);
        assert.equal(npcSave.clanWarRewardReceipts, undefined, 'the NPC was paid nothing');
        if (playerWon) assert.ok((await kv.get(`npc-village:wounded:${answer!.npc}`)), 'a beaten NPC goes to the hospital');
    });

    it('an NPC answers in the Pet Showdown, fields its own companion, and the duel scores', async () => {
        const queue = unwrap(await import('./clan/war/queue.js'));
        const pet = unwrap(await import('./clan/war/pet.js'));
        const me = players[2]!;
        // A companion for the player: a copy of a Cinderhold pet under a new id.
        const donor = (await kv.get<Record<string, any>>(`save:${clans.NPC_CLANS[1]!.members[5]}`))!.character.pets[0];
        const mine = { ...donor, id: `${donor.id}-player`, nickname: 'Moonfang' };
        const save = (await kv.get<Record<string, any>>(`save:${me}`))!;
        await kv.set(`save:${me}`, { ...save, character: { ...save.character, pets: [mine], activePetId: mine.id } });
        assert.equal((await call(queue, me, { warId, action: 'join', mode: 'pet1v1' })).status, 200);
        const joined = await tick.runNpcClanWarCampaign();
        const answer = joined.joined.find((j) => j.ok && j.mode === 'pet1v1');
        assert.ok(answer, JSON.stringify(joined.joined));
        await tick.runNpcClanWarCampaign();
        let war = await warOf(warId);
        const match = Object.values(war.campaign!.matches).find((m) => m.mode === 'pet1v1' && (m.status === 'ready' || m.status === 'active'))!;
        if (match.status === 'ready') assert.equal((await call(queue, me, { warId, action: 'ready', matchId: match.id })).status, 200);
        const fielded = await tick.runNpcClanWarCampaign({ now: Date.now() + tick.NPC_PET_THINK_MS + 1 });
        assert.ok(fielded.pets.some((p) => p.ok && p.npc === answer!.npc), `the NPC fields its pet: ${JSON.stringify(fielded.pets)}`);
        const sent = await call(pet, me, { action: 'submit', warId, challengeId: match.id, petId: mine.id });
        assert.equal(sent.status, 200, JSON.stringify(sent.body).slice(0, 300));
        assert.equal(sent.body.session.status, 'done');
        const { reconcileClanWarCampaign } = await import('./clan/war/_campaign-reconcile.js');
        await reconcileClanWarCampaign(warId);
        war = await warOf(warId);
        assert.equal(war.campaign!.matches[match.id]!.status, 'completed');
        const npcSave = (await kv.get<Record<string, any>>(`save:${answer!.npc}`))!.character;
        assert.equal(npcSave.clanWarRewardReceipts, undefined, 'the NPC was paid nothing');
    });

    type CardRow = { status: string; p1Name: string; p2Name?: string; npcControlled?: boolean; state?: import('../shared/chronicle-duel.js').ChronicleMatch;
        cpCredit?: { status: string; reason?: string; amounts?: { winner: number; loser: number }; pairWeight?: number; npcControlled?: boolean; winnerName: string } };
    const cardRow = async (id: string) => (await kv.get<CardRow>(`cw-tilecards:${id}`))!;
    const chroniclePoints = async (name: string) => Number((await kv.get<Record<string, any>>(`save:${name}`))!.character.chroniclePoints ?? 0);
    /** A fixed shuffle (mulberry32) for the duel, so a played-out card duel is the same duel on every run. */
    function seedShuffle(t: { mock: { method: (object: object, name: string, impl: () => number) => unknown } }, seed: number): void {
        let a = seed >>> 0;
        t.mock.method(Math, 'random', () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let x = Math.imul(a ^ (a >>> 15), 1 | a);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        });
    }
    /** Raises the player to the NPC's level, so the card share is not withheld for the level gap (as between two players). */
    async function matchLevel(me: string, npc: string): Promise<void> {
        const level = (await kv.get<Record<string, any>>(`save:${npc}`))!.character.level;
        const save = (await kv.get<Record<string, any>>(`save:${me}`))!;
        await kv.set(`save:${me}`, { ...save, character: { ...save.character, level } });
    }

    /** Queues `me` for a Chronicle Showdown, lets an NPC answer, and opens the duel with the NPC in seat p2. */
    async function openNpcCardDuel(me: string): Promise<{ matchId: string; npc: string }> {
        const queue = unwrap(await import('./clan/war/queue.js'));
        const cards = unwrap(await import('./clan/war/tilecards.js'));
        assert.equal((await call(queue, me, { warId, action: 'join', mode: 'tilecards' })).status, 200);
        const joined = await tick.runNpcClanWarCampaign();
        const answer = joined.joined.find((j) => j.ok && j.mode === 'tilecards');
        assert.ok(answer, JSON.stringify(joined.joined));
        await tick.runNpcClanWarCampaign();
        const war = await warOf(warId);
        const match = Object.values(war.campaign!.matches).find((m) => m.mode === 'tilecards' && (m.status === 'ready' || m.status === 'active')
            && [...m.fromPlayers, ...m.toPlayers].includes(me))!;
        if (match.status === 'ready') assert.equal((await call(queue, me, { warId, action: 'ready', matchId: match.id })).status, 200);
        const registered = await tick.runNpcClanWarCampaign();
        assert.ok(registered.cards.some((c) => c.matchId === match.id), 'the card seat takes the match');
        const opened = await call(cards, me, { action: 'join', warId, challengeId: match.id, deck: [] });
        assert.equal(opened.status, 200, JSON.stringify(opened.body).slice(0, 300));
        await tick.sweepNpcClanCardDuels();
        const live = await cardRow(match.id);
        assert.equal(live.status, 'active', 'the NPC joined the second seat');
        assert.equal(String(live.p2Name).toLowerCase().replace(/[^a-z0-9_-]/g, ''), answer!.npc);
        return { matchId: match.id, npc: answer!.npc };
    }

    /** Plays the duel to its end: the player (seat p1) passes and ends turns, the server's seat plays the NPC. */
    async function playCardDuelOut(me: string, matchId: string, onNpcTurn?: (row: CardRow) => Promise<void>): Promise<CardRow> {
        const cards = unwrap(await import('./clan/war/tilecards.js'));
        const { applyAction } = await import('../shared/chronicle-duel.js');
        // The player really plays (sets a monster each turn, ends its turns), so the
        // duel passes the free-play participation gate (api/card-clash/_freeplay-legacy.ts).
        type Intent = import('../shared/chronicle-duel.js').ChronicleActionIntent;
        const sets: Intent[] = (['set-monster', 'set-trap'] as const).flatMap((action) =>
            Array.from({ length: 10 }, (_, handIndex) => Array.from({ length: 5 }, (_, zoneIndex) => ({ action, handIndex, zoneIndex } as Intent))).flat());
        const intents = (phase: string): Intent[] => [{ action: 'pass-response' }, ...sets,
            ...(phase === 'draw' || phase === 'standby' ? [{ action: 'advance-phase' } as Intent] : []),
            { action: 'end-turn' }, { action: 'enter-end-phase' }, { action: 'advance-phase' }];
        let row = await cardRow(matchId);
        for (let guard = 0; guard < 600 && row.status === 'active'; guard++) {
            const state = row.state!;
            const mine = state.responseWindow ? state.responseWindow.responder === 'p1' : state.activePlayer === 'p1';
            if (mine) {
                const step = intents(state.phase).find((intent) => applyAction(state, 'p1', intent, Date.now()).ok);
                assert.ok(step, `the player always has a legal move (phase ${state.phase})`);
                const moved = await call(cards, me, { ...step, warId, challengeId: matchId });
                assert.equal(moved.status, 200, JSON.stringify(moved.body).slice(0, 300));
            } else {
                if (onNpcTurn) await onNpcTurn(row);
                await tick.sweepNpcClanCardDuels();
            }
            // Well under the 15 s response and 60 s turn clocks (a player turn here is
            // about ten steps), so nobody times out, and long enough over a duel of
            // three turns or more to pass the free-play 45 s participation gate.
            mock.timers.tick(4_000);
            row = await cardRow(matchId);
        }
        assert.equal(row.status, 'done', 'the duel was played to its end');
        // The card seat settles the finished duel and lets go of it.
        await tick.sweepNpcClanCardDuels();
        assert.equal((await tick.liveNpcClanCardDuels())[matchId], undefined);
        return cardRow(matchId);
    }

    it('an NPC takes the second seat of a Chronicle Showdown, plays it out, and the player is paid the PvP 20/8', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.after(() => mock.timers.reset());
        seedShuffle(t, 20261110);
        const me = players[3]!;
        const { matchId, npc } = await openNpcCardDuel(me);
        await matchLevel(me, npc);
        const before = await chroniclePoints(me);
        const row = await playCardDuelOut(me, matchId);
        const playerWon = row.state?.winner === 'p1';
        // Scored and paid like a Chronicle Showdown between two player clans:
        // the full 20/8 PvP share, the player's side paid, the NPC's never.
        assert.equal(row.cpCredit?.status, 'done', JSON.stringify(row.cpCredit) + JSON.stringify((row as { participation?: unknown }).participation));
        assert.deepEqual(row.cpCredit?.amounts, { winner: 20, loser: 8 });
        assert.equal(row.cpCredit?.pairWeight, 1, 'the normal first-of-the-day pair weight');
        const cards = unwrap(await import('./clan/war/tilecards.js'));
        const seen = await call(cards, me, { action: 'state', warId, challengeId: matchId });
        assert.equal(seen.status, 200);
        assert.equal(await chroniclePoints(me) - before, playerWon ? 20 : 8, 'the player gets the PvP share for the result');
        assert.equal(await chroniclePoints(npc), 0, 'the NPC is never paid');
        const { reconcileClanWarCampaign } = await import('./clan/war/_campaign-reconcile.js');
        await reconcileClanWarCampaign(warId);
        const war = await warOf(warId);
        const done = war.campaign!.matches[matchId]!;
        assert.equal(done.status, 'completed');
        const winnerClan = done.result === 'from-wins' ? done.fromClan : done.toClan;
        assert.equal(winnerClan, playerWon ? PLAYER_CLAN : 'Ashen Fang');
        assert.ok((war.campaign!.scores[winnerClan] ?? 0) > 0, 'the winner scored');
    });

    it('an admin who plays the NPC seat mid clan-war Chronicle Showdown makes it pay nobody', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: Date.now() });
        t.after(() => mock.timers.reset());
        seedShuffle(t, 20261111);
        const me = players[0]!;
        const { matchId, npc } = await openNpcCardDuel(me);
        await matchLevel(me, npc);
        assert.notEqual((await cardRow(matchId)).npcControlled, true, 'joined by the server, not an admin');
        const cards = unwrap(await import('./clan/war/tilecards.js'));
        const { applyAction } = await import('../shared/chronicle-duel.js');
        let tookOver = false;
        const before = await chroniclePoints(me);
        const row = await playCardDuelOut(me, matchId, async (live) => {
            if (tookOver) return;
            const state = live.state!;
            const step = (['pass-response', 'advance-phase', 'enter-end-phase', 'end-turn'] as const).find((action) => applyAction(state, 'p2', { action }, Date.now()).ok);
            if (!step) return;
            // The admin moves the NPC's seat once, by the admin password, partway through.
            const moved = await call(cards, null, { action: step, warId, challengeId: matchId, playerName: npc }, 'POST', {}, { 'x-admin-password': 'npc-clan-war-admin' });
            assert.equal(moved.status, 200, JSON.stringify(moved.body).slice(0, 300));
            tookOver = true;
            assert.equal((await cardRow(matchId)).npcControlled, true, 'from that action on, the duel is admin-played');
        });
        assert.ok(tookOver, 'the admin acted mid-duel');
        assert.equal(row.cpCredit?.npcControlled, true, JSON.stringify(row.cpCredit));
        assert.deepEqual(row.cpCredit?.amounts, { winner: 0, loser: 0 }, 'an admin-played duel pays nobody');
        await call(cards, me, { action: 'state', warId, challengeId: matchId });
        assert.equal(await chroniclePoints(me), before, 'the player is not paid');
        assert.equal(await chroniclePoints(npc), 0, 'nor the NPC');
    });

    it('the war ends with the player side rewarded as normal, nothing for the NPC side, and no Cinderhold clan in the rankings', async () => {
        const war = await warOf(warId);
        const endsAt = Date.now() - 1;
        await kv.set(`clan-war:${warId}`, { ...war, campaign: { ...war.campaign!, endsAt } });
        const { reconcileClanWarCampaign } = await import('./clan/war/_campaign-reconcile.js');
        // Cinderhold closed (the kill switch, or no session tokens): the war is
        // FROZEN past its end. No close, no war-end rewards (2026-11-11).
        for (const close of [() => { process.env.DISABLE_NPC_VILLAGE = '1'; }, () => { delete process.env.SESSION_SECRET; }]) {
            const secret = process.env.SESSION_SECRET;
            close();
            try {
                const frozen = (await reconcileClanWarCampaign(warId))!;
                assert.equal(frozen.endedAt, undefined, 'a frozen clan war is not closed');
                assert.equal(((await kv.get<Record<string, any>>('save:clan-lunartide'))!.campaignPrestige?.participations ?? 0), 0, 'nor settled');
            } finally { delete process.env.DISABLE_NPC_VILLAGE; process.env.SESSION_SECRET = secret; }
        }
        // Back on: it closes at its own sealed end time, as it would have.
        const ended = (await reconcileClanWarCampaign(warId))!;
        assert.equal(ended.endedAt, endsAt, 'the clock resumes coherently: ended at its own end');
        const npcClan = (await kv.get<Record<string, any>>('save:clan-ashenfang'))!;
        assert.ok((npcClan.campaignHistory ?? []).some((h: { instanceId: string }) => h.instanceId === ended.campaign!.instanceId), 'kept for display');
        assert.equal(npcClan.xp, 0, 'no clan XP');
        assert.equal(npcClan.campaignPrestige?.participations ?? 0, 0, 'no prestige');
        const playerClan = (await kv.get<Record<string, any>>('save:clan-lunartide'))!;
        assert.equal(playerClan.campaignPrestige?.participations, 1, 'the player clan records its war');
        assert.ok(Number(playerClan.xp) > 0, 'the player clan earns its clan XP');
        for (const id of clans.NPC_CLANS[0]!.members) {
            assert.equal((await kv.get<Record<string, any>>(`save:${id}`))!.character.clanWarRewardReceipts, undefined, `${id} was paid nothing`);
        }
        const { clanCampaignStandings } = await import('../shared/clan-campaign-standings.js');
        const rows = await kv.mget<Array<Record<string, any>>>(...(await kv.keys('save:clan-*')));
        const standings = clanCampaignStandings(rows.filter(Boolean) as never, 'lifetime', Date.now());
        assert.ok(standings.some((s) => s.name === PLAYER_CLAN));
        assert.ok(!standings.some((s) => clans.isNpcClanName(s.name)), 'Cinderhold clans never rank');
    });

    it('a Cinderhold clan never declares a clan war, even in-process with a funded Seal Pool; a player clan still declares on it', async () => {
        // DISABLE_NPC_VILLAGE stops every NPC action.
        process.env.DISABLE_NPC_VILLAGE = '1';
        assert.deepEqual((await tick.runNpcClanWarCampaign()).joined, []);
        delete process.env.DISABLE_NPC_VILLAGE;
        await seedPlayerClan(SECOND_CLAN, 'owl');
        const npcClan = clans.NPC_CLANS[1]!;
        const pairKey = `clan-war:${[npcClan.name, SECOND_CLAN].map(clans.npcClanBareSlug).sort().join('-vs-')}`;
        // The proposal flow is gone: no daily-pass step, no admin approval action.
        const scheduler = (await import('node:fs')).readFileSync(`${process.cwd()}/api/cron/_scheduler.ts`, 'utf8');
        assert.doesNotMatch(scheduler, /proposeNpcClanWar|_npc-clan-war\.js/, 'the daily pass proposes no clan war');
        const possess = unwrap(await import('./admin/npc-possess.js'));
        const admin = { 'x-admin-password': 'npc-clan-war-admin' };
        const approve = await call(possess, null, { action: 'clan-war-approve', proposalId: 'npc-clan-war-anything' }, 'POST', {}, admin);
        assert.equal(approve.status, 400, `no clan-war approval action: ${JSON.stringify(approve.body)}`);
        // The clan's founder, with its own server-minted token, called in-process,
        // the Seal Pool holding the whole fee: refused, nothing written or spent.
        const poolKey = `clan-seal-pool:${npcClan.name.toLowerCase()}`;
        await kv.set(poolKey, { clanName: npcClan.name, balance: 1_000, log: [] });
        const declare = unwrap(await import('./clan/war/declare.js'));
        for (const funding of ['pool', 'personal']) {
            const byNpc = await call(declare, npcClan.founder, { toClan: SECOND_CLAN, funding, requestId: `npc-never-declares-${funding}` });
            assert.equal(byNpc.status, 403, JSON.stringify(byNpc.body));
        }
        // Nor can an admin declare FOR a Cinderhold clan (the legacy admin path).
        const forNpc = await call(declare, null, { fromClan: npcClan.name, toClan: SECOND_CLAN }, 'POST', {}, admin);
        assert.equal(forNpc.status, 403, JSON.stringify(forNpc.body));
        assert.equal(await kv.get(pairKey), null, 'no war starts');
        assert.equal((await kv.get<{ balance: number }>(poolKey))?.balance, 1_000, 'the pool is untouched');
        await kv.del(poolKey);
        // A player clan declares on that Cinderhold clan exactly as before.
        const declared = await call(declare, 'owl0', { toClan: npcClan.name, funding: 'personal', requestId: 'owl-declares-on-npc-01' });
        assert.equal(declared.status, 200, JSON.stringify(declared.body));
        const war = await warOf(String(declared.body.war.id));
        assert.ok(war.campaign);
        assert.equal(war.campaign!.declarationPayment?.clan, SECOND_CLAN);
        assert.equal(`clan-war:${war.id}`, pairKey);
        shrineWarId = war.id;
        shrineClan = npcClan.name;
    });

    let shrineWarId = '';
    let shrineClan = '';
    it('during a golden-shrine window up to three free NPCs walk to the shrine, enter it and keep their visit', async () => {
        const war = await warOf(shrineWarId);
        const c = war.campaign!, now = Date.now(), shift = now - 1000 - c.startsAt;
        const shrines = c.shrines.map((s, i) => i === 0 ? { ...s, opensAt: now - 1000, closesAt: now + 2 * 60 * 60_000 } : { ...s, opensAt: s.opensAt + shift + 10 * DAY, closesAt: s.closesAt + shift + 10 * DAY });
        await kv.set(`clan-war:${shrineWarId}`, { ...war, campaign: { ...c, startsAt: c.startsAt + shift, endsAt: c.endsAt + shift, shrines } });
        const sector = shrines[0]!.sector;
        const presence = await import('./_npc-presence.js');
        await presence.refreshNpcPresence(now);
        const posted = await tick.runNpcClanWarCampaign({ now });
        const state = await (await import('./_npc-campaign-assignments.js')).readNpcClanWarState();
        const holders = Object.entries(state.posts).filter(([, post]) => post.warId === shrineWarId).map(([id]) => id);
        assert.ok(holders.length > 0 && holders.length <= tick.NPC_CLAN_SHRINE_SQUAD, `posted ${holders.length}: ${JSON.stringify(posted)}`);
        assert.ok(holders.every((id) => clans.npcClanByName(shrineClan)!.members.includes(id)));
        // The presence tick walks them there on the ordinary travel lease, and lands them.
        await presence.refreshNpcPresence(now + 1);
        await presence.refreshNpcPresence(now + 2);
        const kept = await tick.keepNpcClanShrineHolders({ now: Date.now() });
        assert.ok(kept.some((k) => k.action === 'shrine-enter' && k.ok), `a holder enters the shrine: ${JSON.stringify(kept)}`);
        const again = await tick.keepNpcClanShrineHolders({ now: Date.now() });
        assert.ok(again.some((k) => k.action === 'shrine-state' && k.ok), 'and keeps its visit');
        const holder = clans.npcClanByName(shrineClan)!.members.find((id) => again.some((k) => k.npc === id && k.ok))!;
        const name = (await kv.get<Record<string, any>>(`save:${holder}`))!.character.name;
        assert.equal(online.get(name)?.sector, sector, 'it stands in the shrine sector');
        online.list().forEach((row) => online.remove(row.name));
    });

    it('the tick reads only live NPC wars whole, writes nothing when nothing changed, and the card seat reads nothing while no duel is live', async () => {
        const { NPC_CLAN_WAR_STATE_KEY } = await import('./_npc-campaign-assignments.js');
        const now = Date.now();
        const deps = { now, fighterFree: async () => true, queue: async () => ({ status: 200, body: {} }), pet: async () => ({ status: 200, body: {} }) };
        tick.resetNpcClanWarIndexForTest();
        await tick.runNpcClanWarCampaign(deps); // builds the index and settles the state for this instant
        const mget = mock.method(kv, 'mget');
        const set = mock.method(kv, 'set');
        try {
            await tick.runNpcClanWarCampaign(deps);
            const wholeWarReads = mget.mock.calls.flatMap((c) => c.arguments as unknown[]).filter((key) => String(key).startsWith('clan-war:'));
            assert.ok(!wholeWarReads.includes(`clan-war:${warId}`), 'the ended war (and its history) is not read every tick');
            assert.deepEqual(wholeWarReads, [`clan-war:${shrineWarId}`], 'only the live NPC war is read whole');
            assert.equal(set.mock.calls.filter((c) => c.arguments[0] === NPC_CLAN_WAR_STATE_KEY).length, 0, 'nothing changed, nothing written');
        } finally { mget.mock.restore(); set.mock.restore(); }

        // The 1 s card seat: after one read of an empty registry it reads nothing more until a duel registers.
        tick.resetNpcClanCardDuelFlagForTest();
        const get = mock.method(kv, 'get');
        const registryReads = () => get.mock.calls.filter((c) => c.arguments[0] === tick.NPC_CLAN_CARD_DUEL_ACTIVE_KEY).length;
        try {
            await tick.sweepNpcClanCardDuels();
            assert.equal(registryReads(), 1, 'the first sweep after a start reads the registry once');
            for (let i = 0; i < 5; i++) await tick.sweepNpcClanCardDuels();
            assert.equal(registryReads(), 1, 'no duel registered: no read every second');
            await tick.registerNpcClanCardDuel('cw-sweep-probe', { npc: clans.NPC_CLANS[1]!.members[0]!, warId: shrineWarId, at: now });
            const before = registryReads();
            await tick.sweepNpcClanCardDuels();
            assert.ok(registryReads() > before, 'a registered duel is swept');
        } finally {
            get.mock.restore();
            const live = await tick.liveNpcClanCardDuels();
            delete live['cw-sweep-probe'];
            await kv.set(tick.NPC_CLAN_CARD_DUEL_ACTIVE_KEY, live);
        }
    });

    it('NPCs out of their daily slots never starve the rest of the roster from answering a waiting player', async () => {
        const { CLAN_WAR_RULES, clanWarCampaignDay, clanWarPlayerKey } = await import('../shared/clan-war-campaign.js');
        const queue = unwrap(await import('./clan/war/queue.js'));
        assert.equal((await call(queue, 'owl1', { warId: shrineWarId, action: 'join', mode: 'pvp1v1' })).status, 200);
        const now = Date.now();
        const war = await warOf(shrineWarId);
        const c = war.campaign!;
        const ids = c.rosters.find((r) => r.clan === shrineClan)!.members.map((m) => clanWarPlayerKey(m.name));
        const state = await (await import('./_npc-campaign-assignments.js')).readNpcClanWarState();
        // The answer order the tick uses (its rotation), shrine holders excluded.
        const hash32 = (input: string) => { let h = 2166136261; for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
        const salt = `${war.id}:${Math.floor(now / (30 * 60_000))}:pvp1v1`;
        const order = ids.filter((id) => !state.posts[id]).sort((a, b) => hash32(`${a}:${salt}`) - hash32(`${b}:${salt}`) || a.localeCompare(b));
        assert.ok(order.length >= 4, `enough answerers: ${order.length}`);
        const fresh = order[order.length - 1]!;
        const day = clanWarCampaignDay(c, now)!;
        const spent = Object.fromEntries(order.filter((id) => id !== fresh).map((id) => [id, CLAN_WAR_RULES.memberSlotsPerDay]));
        c.days[day] = { ...c.days[day]!, memberUses: { ...c.days[day]!.memberUses, ...spent } };
        await kv.set(`clan-war:${shrineWarId}`, war);
        const joins: string[] = [];
        const report = await tick.runNpcClanWarCampaign({ now, fighterFree: async () => true, pet: async () => ({ status: 200, body: {} }),
            queue: async (npc, body) => {
                if (body.action !== 'join') return { status: 200, body: {} };
                joins.push(npc.id);
                // The route's own refusal for a spent shinobi.
                return spent[npc.id] ? { status: 409, body: { error: 'A player has used their normal scored slots for this war day.' } } : { status: 200, body: {} };
            } });
        assert.deepEqual(joins, [fresh], `only the shinobi with slots left is asked, and it answers: ${JSON.stringify(report.joined)}`);
        assert.ok(report.joined.some((j) => j.ok && j.npc === fresh));
        await call(queue, 'owl1', { warId: shrineWarId, action: 'leave', mode: 'pvp1v1', scope: 'normal' });
    });
});
