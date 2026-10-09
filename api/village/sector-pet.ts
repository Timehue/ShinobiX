import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { normalizeVillageWarRecord, sectorConfigFor, villageWarKey } from '../_war-state.js';
import { sectorWarDamageMultiplier, defenderPointsMultiplier } from '../_war-structures.js';
import { sectorWarRoleOf, sectorControlSwing, ROLE_VILLAGER } from '../_war-role.js';
import { applyContestBattleByWinner, contestGarrisonReady, isSectorWarActive, lastGarrisonBattleAt, sectorWarGarrisonIdle, GARRISON_UNLOCK_IDLE_MS } from '../_sector-war.js';
import { fieldGarrisonDefender, maskedGarrisonDefenderName, NO_GARRISON_DEFENDER_ERROR } from '../_sector-war-garrison-defender.js';
import { commitSectorWarBattle, loadSectorWar, type SectorWarBattleCommit, type SectorWarBattleDecision } from '../_sector-war-store.js';
import { resolveWarDuel, type WarDuelInput } from '../_pet-showdown/war-duel.js';
import { sealWarTeam } from '../_pet-showdown/war-team.js';
import type { ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petStatCeil, type PetCeilStat } from '../_pet-stat-ceil.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import {
    claimOpenSectorBattle,
    endOwnOpenBattleProtection,
    gateOpenSectorBattle,
    newOpenBattleId,
    noticeOpenSectorBattle,
    protectOpenBattleLoser,
} from '../_sector-contest-engage.js';
import { endOwnFieldRecoveryShield } from '../_field-recovery-shield.js';

/*
 * /api/village/sector-pet — POST only. The sector-war "Pet" win-condition (Phase 7).
 *
 * A Pet sector-war is a deterministic 1v1 PET DUEL resolved SERVER-SIDE by the exact
 * engine the client renders — api/pet-sim/pet-duel-sim is a GENERATED copy of
 * lib/pet-duel-sim (scripts/gen-pet-sim.mjs; the parity test guards it byte-for-byte).
 * Two real players each bring a pet: the attacker opens, the defender joins, and the
 * duel auto-resolves the instant both pets are in — no turns, the sim is deterministic
 * from (both teams, seed). The winner maps onto the contest exactly like Combat/Card:
 * an attacker win scores the attacker's tally, a defender win the defender's, and a
 * draw nothing; settlement compares the tallies when the 72 hours close. The client
 * REPLAYS the same inputs to show the fight — identical to the server, so it can
 * never disagree on who won.
 *
 * Pet stats are clamped server-side (petStatCeil) so a tampered save can't seal an OP
 * pet. Server-gated by the default-on Sector Map campaign switch.
 *
 * Body: { action, sectorWarId, petId?, target?, engageId? }
 *   join    { petId }   attacker opens with a pet / defender joins with a pet → resolve
 *   engage  { target }  an OPEN-WORLD battle against an enemy standing in this
 *                       sector (api/_sector-contest-engage.ts): both sides' sealed
 *                       teams fight at once, the war scores it, the target is told
 *   state   {}          read the session AS THIS VIEWER MAY SEE IT (projectPetSession):
 *                       only the war's two villages, and never one side's team to the
 *                       other before the duel resolves. `engageId` reads an open-world
 *                       battle instead of the table.
 */

const SESSION_TTL_SEC = 30 * 60; // 30m hygiene — abandoned duels self-clean
const CEIL_STATS: readonly PetCeilStat[] = ['hp', 'attack', 'defense', 'speed'];

type SectorPetSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    // `pet` is the champion the player SENT; `team` is the full 2v2+bench roster
    // sealed from their save at submit time (owner ruling: war duels are 2v2
    // with two reserves). Sessions written before the team change carry only
    // `pet`, so every reader falls back to [pet].
    p1: { name: string; pet: Pet; team?: Pet[] };   // attacker-side opener
    p2?: { name: string; pet: Pet; team?: Pet[] };  // defender-side joiner
    status: 'awaiting-defender' | 'done';
    seed?: number;
    winner?: 'p1' | 'p2' | 'draw';
    /** Which combat engine decided this session. Absent = the retired sim;
     *  the watch action refuses those (a Showdown re-derivation could disagree
     *  with the recorded winner). New resolutions always stamp 'showdown'. */
    engine?: 'showdown';
    /** True when the defender seat was filled by the defending village's SEALED
     *  garrison team rather than a live player. Scores at garrison weight and
     *  never refreshes `lastLiveBattleAt` — see applySectorWarBattle. */
    garrison?: boolean;
    /** Server-only: whose sealed team the garrison fielded. Players see the
     *  masked defender name in `p2.name`, never this (projectPetSession). */
    garrisonDefenderSlug?: string;
    /** Set on an OPEN-WORLD battle: one player attacked an enemy in the sector
     *  (action `engage`), so both seats are named and it is not the war's table. */
    open?: { engageId: string; initiator: string };
    terrain?: string | null;   // defender sector terrain sealed at resolve → drives the home-ground element bonus in the (identical) client replay
    appliedToContest?: boolean;
    /** What the resolved duel did to the war, so the screen never claims a
     *  score for a duel the war could no longer count. */
    warResult?: WarResult;
    createdAt: number;
    updatedAt: number;
};

type WarResult = { scored: boolean; points?: number; reason?: string };
function warResultFrom(commit: SectorWarBattleCommit): WarResult {
    return commit.status === 'applied'
        ? { scored: true, points: commit.receipt.points }
        : { scored: false, reason: commit.status === 'skipped' ? commit.reason : 'missing' };
}

function sameName(a: string | undefined, b: string): boolean {
    return !!a && a.toLowerCase() === b.toLowerCase();
}

/**
 * The live duel's seed, fixed by the TABLE it is fought at.
 *
 * It used to be rolled from the defender's join time. The contest commit lands
 * before the session write, so when that write failed, the retry re-rolled a
 * new fight while the contest replayed the first one's receipt: the duel the
 * players watched could crown a different winner than the one the war scored.
 * Derived from the table's own identity (the war and the moment it was
 * opened, the same pair the battle id is built from), a retry fights the
 * scored duel again. It reveals nothing a defender could exploit: until the
 * duel resolves, nobody but the attacker sees the attacker's team.
 */
function petDuelSeed(sectorWarId: string, openedAt: number): number {
    return seedFromKey(`sector-pet:${sectorWarId}:${Math.floor(Number(openedAt) || 0)}`);
}

/** An open-world battle's seed, fixed by its own id for the same reason. */
function openPetDuelSeed(engageId: string): number {
    return seedFromKey(`sector-pet-open:${engageId}`);
}

function seedFromKey(key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

type PetViewer = { side: 'p1' | 'p2' | null; village: string; admin: boolean };

/** Who is looking at a session: a duelist, a member of one of the war's two
 *  villages, an admin, or (village '') nobody this duel concerns. */
async function petViewerOf(session: SectorPetSession, me: string, admin: boolean): Promise<PetViewer> {
    const side = sameName(session.p1.name, me) ? 'p1'
        : session.p2 && !session.garrison && sameName(session.p2.name, me) ? 'p2'
            : null;
    return { side, village: admin || side ? '' : await villageOf(me), admin };
}

function petViewerAllowed(session: SectorPetSession, viewer: PetViewer): boolean {
    return viewer.admin || viewer.side !== null
        || (!!viewer.village && (viewer.village === session.attackerVillage || viewer.village === session.defenderVillage));
}

/**
 * A session as ONE viewer may see it.
 *
 * `state` used to hand any logged-in caller the whole row — both sealed teams —
 * so a defender could read the attacker's team (and the sector's terrain it
 * would fight on) before choosing what to answer with. Until the duel resolves
 * a side's team is shown only to that side's own duelist; once it resolves,
 * both are on the replay anyway. `viewerSide` tells the screen which seat (if
 * any) is the viewer's, and `canAnswer` whether they may take the open one.
 */
function projectPetSession(session: SectorPetSession, viewer: PetViewer): Record<string, unknown> {
    const { garrisonDefenderSlug: _sealedFrom, ...visible } = session;
    if (viewer.admin || session.status === 'done') {
        return { ...visible, viewerSide: viewer.side, canAnswer: false };
    }
    const own = viewer.side === 'p1';
    return {
        ...visible,
        p1: own ? visible.p1 : { name: visible.p1.name },
        ...(own ? {} : { createdAt: undefined, updatedAt: undefined }),
        viewerSide: viewer.side,
        canAnswer: viewer.side === null && !session.garrison && viewer.village === session.defenderVillage,
    };
}

function sessionKey(sectorWarId: string): string { return `sector-pet:${sectorWarId}`; }
/* The garrison duel gets its OWN key. Sharing the live table's key would let an
 * attacker who fights the garrison overwrite their own still-pending
 * awaiting-defender session, and a defender arriving afterwards would find a
 * finished duel and be told to wait for an attacker. Separate keys keep the two
 * independent: the garrison is what you do INSTEAD of waiting, not something
 * that cancels the seat a real defender can still take. */
function garrisonSessionKey(sectorWarId: string): string { return `sector-pet-garrison:${sectorWarId}`; }
/** An open-world battle (action `engage`) lives under its own id: many can be
 *  fought in one war, and none of them is the war's table. */
function openSessionKey(engageId: string): string { return `sector-pet-open:${engageId}`; }
function cleanEngageId(raw: unknown): string {
    const id = String(raw ?? '').trim();
    return /^[a-f0-9]{24}$/.test(id) ? id : '';
}
/** Which session a read addresses. `garrison` is a mode selector re-authorized
 *  server-side on every write; on a read it only chooses which row to project. */
function readKey(sectorWarId: string, garrison: boolean, engageId = ''): string {
    if (engageId) return openSessionKey(engageId);
    return garrison ? garrisonSessionKey(sectorWarId) : sessionKey(sectorWarId);
}

async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName.toLowerCase()}`);
    return String(save?.character?.village ?? '').trim();
}

// Seal a player's chosen pet from their save (by id, else active, else first), then
// CLAMP the four battle stats to the per-rarity anti-tamper ceiling so a tampered
// save can't field an absurd pet into a territory-flipping duel.
async function sealPlayerPet(playerName: string, petId: string): Promise<Pet | null> {
    const save = await kv.get<{ character?: { pets?: unknown[]; activePetId?: string; petBreeding?: unknown } }>(`save:${playerName.toLowerCase()}`);
    const pets = activeCarriedPets<Record<string, unknown>>(save?.character ?? {});
    if (!pets.length) return null;
    const activeId = String(save?.character?.activePetId ?? '');
    const raw = pets.find((p) => String(p.id) === petId)
        ?? pets.find((p) => String(p.id) === activeId)
        ?? pets[0];
    if (!raw) return null;
    if (petCombatBusyReason((save?.character ?? {}) as Record<string, unknown>, raw)) return null;
    const pet = { ...raw } as unknown as Pet;
    for (const stat of CEIL_STATS) {
        const v = Number(raw[stat]) || 0;
        (pet as unknown as Record<string, number>)[stat] = Math.min(v, petStatCeil(raw.rarity, stat));
    }
    return pet;
}

// Apply the duel winner to the sector-war contest — p1 = attacker, p2 = defender, so
// the winner maps straight on (attacker win → attacker points, defender win →
// defender points, draw → nothing). Exactly once through the contest's battle
// receipt; nested under the session lock the caller holds. Returns what it did.
async function applyPetOutcomeToContest(session: SectorPetSession): Promise<SectorWarBattleCommit> {
    // Role-scaled swing (§17.6): p1 = attacker, p2 = defender. Roles read outside the
    // contest lock (authoritative server state), then applied atomically inside it.
    const winnerName = session.winner === 'p1' ? session.p1.name : session.winner === 'p2' ? (session.p2?.name ?? '') : '';
    const loserName = session.winner === 'p1' ? (session.p2?.name ?? '') : session.winner === 'p2' ? session.p1.name : '';
    // A garrison is an AI holding ground, not the ANBU whose kit it borrowed, so
    // its side weighs as a plain villager and earns its "owner" no credit. This
    // mirrors api/village/sector-war.ts's Combat garrison exactly — reading the
    // sealed ANBU's real rank instead would inflate the swing and hand capture
    // credit to someone who never played.
    const attackerWonBattle = session.winner === 'p1';
    const [winnerRole, loserRole] = session.garrison
        ? (attackerWonBattle
            ? [await sectorWarRoleOf(session.p1.name), ROLE_VILLAGER] as const
            : [ROLE_VILLAGER, await sectorWarRoleOf(session.p1.name)] as const)
        : await Promise.all([sectorWarRoleOf(winnerName), sectorWarRoleOf(loserName)]);
    // The duel ended when it resolved; that stamp, not this request's clock,
    // decides whether the war could still count it.
    const endedAt = Math.floor(Number(session.updatedAt) || 0) || Date.now();
    return commitSectorWarBattle({
        contestId: session.sectorWarId,
        battleId: session.open
            ? `pet-open:${session.sectorWarId}:${session.open.engageId}`
            : `pet${session.garrison ? '-garrison' : ''}:${session.sectorWarId}:${session.createdAt}`,
        decide: async (contest): Promise<SectorWarBattleDecision> => {
            // A settled war's row is no longer written; a duel opened against
            // an earlier war on this sector never scores the one that replaced
            // it; and one that ended after the war stopped being live is past
            // the whistle — skipped, never a 0-point receipt that still logs a
            // score and still puts its winner on the capture credit.
            if (contest.flipped || contest.expiredAt) return { kind: 'skip', reason: 'terminal' };
            if (session.createdAt < contest.startedAt) return { kind: 'skip', reason: 'superseded' };
            if (!isSectorWarActive(contest, endedAt)) return { kind: 'skip', reason: 'superseded' };
            const at = endedAt;
            const [atkRaw, defRaw] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(session.attackerVillage)),
                kv.get<Record<string, unknown>>(villageWarKey(session.defenderVillage)),
            ]);
            const outcome = applyContestBattleByWinner(contest, session.winner ?? 'draw', {
                now: at,
                roleSwing: sectorControlSwing(winnerRole, loserRole),
                attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(session.attackerVillage, atkRaw ?? undefined)),
                defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(session.defenderVillage, defRaw ?? undefined)),
                // The AI's win is credited to nobody: `by` feeds the settlement
                // capture credit, and no player fought for it.
                by: session.garrison && !attackerWonBattle ? '' : winnerName,
                // Half-weight + war cap on an attacker win; merc-repel weight when
                // the garrison holds. Exactly Combat's split.
                ...(session.garrison ? { garrisonBattle: attackerWonBattle, mercBattle: !attackerWonBattle } : {}),
            });
            if (!outcome) return { kind: 'skip', reason: 'draw' }; // draw — nothing scores
            // Sectors never flip mid-war — settlement compares the tallies at 72h.
            return {
                kind: 'score',
                outcome,
                attackerWon: attackerWonBattle,
                by: session.garrison && !attackerWonBattle ? '' : winnerName,
                at,
                // Flagged on EITHER outcome: this is what the re-form window keys
                // on, and a loss must start that cooldown too. garrisonPointsInWar
                // filters on attackerWon, so a hold never eats the attacker's cap.
                ...(session.garrison ? { garrison: true } : {}),
            };
        },
    });
}

/** One derivation of the war-duel input for BOTH the resolve and the watch, so
 *  the fight a viewer watches is byte-for-byte the fight that was recorded. */
function sectorWarInput(args: {
    sectorWarId: string;
    seed: number;
    terrain: string | null;
    p1: { name: string; pet: Pet; team?: Pet[] };
    p2: { name: string; pet: Pet; team?: Pet[] };
}): WarDuelInput {
    return {
        sessionId: `sectorwar:${args.sectorWarId}:${args.seed}`,
        seed: args.seed,
        fromName: args.p1.name,
        toName: args.p2.name,
        // Full team when the session has one; a pre-team session falls back to
        // its single champion so old sessions still watch back correctly.
        fromPets: args.p1.team?.length ? args.p1.team : [args.p1.pet],
        toPets: args.p2.team?.length ? args.p2.team : [args.p2.pet],
        terrain: args.terrain,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-pet', 60, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body?.action ?? '').toLowerCase();
        const sectorWarId = String(body?.sectorWarId ?? '').trim();
        if (!sectorWarId) return res.status(400).json({ error: 'Missing sectorWarId.' });
        const me = identity.admin ? safeName(String(body?.playerName ?? '')) : identity.name;

        const wantsGarrison = body?.garrison === true;
        const engageId = cleanEngageId(body?.engageId);
        if (action === 'state' || action === 'watch') {
            const session = await kv.get<SectorPetSession>(readKey(sectorWarId, wantsGarrison, engageId));
            if (session && engageId && session.sectorWarId !== sectorWarId) return res.status(404).json({ error: 'No pet duel session yet.' });
            if (!session) return res.status(404).json({ error: 'No pet duel session yet.' });
            // Only the war's own two villages (and admins) read its duels.
            const viewer = await petViewerOf(session, me, identity.admin);
            if (!petViewerAllowed(session, viewer)) {
                return res.status(403).json({ error: 'Only the two sides of this sector war can see its pet duels.' });
            }
            if (action === 'state') return res.status(200).json({ session: projectPetSession(session, viewer) });
            if (session.status !== 'done' || !session.p2 || session.seed === undefined) {
                return res.status(409).json({ error: 'This pet duel has not been decided yet.' });
            }
            if (session.engine !== 'showdown') {
                return res.status(409).json({ error: 'This battle predates the new arena and cannot be replayed.' });
            }
            const script: ShowdownReplayScript = resolveWarDuel(sectorWarInput({
                sectorWarId, seed: session.seed, terrain: session.terrain ?? null,
                p1: session.p1, p2: session.p2,
            })).script;
            return res.status(200).json({ script });
        }
        // ── engage: an open-world pet battle against an enemy in this sector ──
        // Owner ruling 2026-10-08: in a Pet war, a battle the two villages'
        // members start in the open IS a pet battle. The same gates as a Combat
        // attack (api/_sector-contest-engage.ts), then both sealed teams fight at
        // once: a pet duel is decided by its two kits, with no turns to wait on,
        // so the target's team answers for them exactly as a defender's does at
        // the table. Either side may start it; the winner's village scores.
        if (action === 'engage') {
            if (identity.admin) return res.status(403).json({ error: 'Open-world battles are fought by players.' });
            if (!(await enforceRateLimitKv(req, res, 'sector-pet-engage', 6, 60_000, identity.name))) return;
            const now = Date.now();
            const gate = await gateOpenSectorBattle({ me, target: body?.target, sectorWarId, kind: 'pet', now });
            if (!gate.ok) {
                return res.status(gate.status).json({ error: gate.error, ...(gate.retryAfterMs ? { retryAfterMs: gate.retryAfterMs } : {}) });
            }
            // The active pet leads, as your loadout leads a Combat fight; the
            // rest of the 2v2+bench team fills from the same roster.
            const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
            if (!pet) return res.status(400).json({ error: 'You have no pet able to fight right now.' });
            const myTeam = (await sealWarTeam(me, [String(pet.id)])) ?? [pet];
            const theirTeam = await sealWarTeam(gate.target);
            if (!theirTeam?.length) return res.status(409).json({ error: `${gate.target} has no pet able to fight right now.` });
            // Read everything the battle needs before holding anyone, so a read
            // that fails leaves no hold behind.
            const terrain = gate.contest.terrain ?? sectorConfigFor(
                normalizeVillageWarRecord(gate.contest.defenderVillage, (await kv.get<Record<string, unknown>>(villageWarKey(gate.contest.defenderVillage))) ?? undefined),
                gate.contest.sector,
            ).terrain;
            const claim = await claimOpenSectorBattle({ contestId: sectorWarId, kind: 'pet', me, target: gate.target, now });
            if (!claim.ok) return res.status(claim.status).json({ error: claim.error, retryAfterMs: claim.retryAfterMs });

            const engageId = newOpenBattleId();
            const mine = { name: me, pet, team: myTeam };
            const theirs = { name: gate.target, pet: theirTeam[0]!, team: theirTeam };
            // Seat p1 is the attacking village's fighter, whoever started it.
            const p1 = gate.p1 === me ? mine : theirs;
            const p2 = gate.p1 === me ? theirs : mine;
            const seed = openPetDuelSeed(engageId);
            const duel = resolveWarDuel(sectorWarInput({ sectorWarId, seed, terrain, p1, p2 }));
            const session: SectorPetSession = {
                sectorWarId, sector: gate.contest.sector,
                attackerVillage: gate.contest.attackerVillage, defenderVillage: gate.contest.defenderVillage,
                p1, p2, status: 'done', seed,
                winner: duel.outcome === 'from' ? 'p1' : 'p2',
                terrain, engine: 'showdown', open: { engageId, initiator: me },
                createdAt: now, updatedAt: now,
            };
            // The battle is decided here, so both fighters' holds end with this
            // commit, whether it lands or fails (a failed commit scored nothing:
            // the contest receipt is written atomically or not at all).
            let commit: SectorWarBattleCommit;
            try {
                commit = await applyPetOutcomeToContest(session);
                // Starting it ends the challenger's own post-defeat shields, as
                // a Combat raid does: the target could not start one back while
                // they lasted. Then the loser, whoever that is, is protected
                // before the holds let anyone else in; the winner may fight
                // again at once (owner ruling 2026-10-09).
                endOwnFieldRecoveryShield(me);
                await endOwnOpenBattleProtection(sectorWarId, me);
                await protectOpenBattleLoser(sectorWarId, session.winner === 'p1' ? p2.name : p1.name, now);
            } finally {
                await claim.release();
            }
            session.warResult = warResultFrom(commit);
            session.appliedToContest = true;
            await kv.set(openSessionKey(engageId), session, { ex: SESSION_TTL_SEC });
            await noticeOpenSectorBattle({ kind: 'pet', from: me, fromCharacter: gate.myCharacter, to: gate.target, sectorWarId, engageId, now });
            return res.status(200).json({
                engageId,
                session: projectPetSession(session, { side: gate.p1 === me ? 'p1' : 'p2', village: gate.myVillage, admin: false }),
            });
        }

        // ── garrison: the sector's own defence stands in for an absent player ──
        // A Pet contest needs a defender to answer before anything scores, so a
        // village that simply never logs in used to run the 72h clock out at 0-0
        // and keep the sector on settlement's tie-to-the-defender rule. After
        // GARRISON_UNLOCK_IDLE_MS with no LIVE battle the attacker may instead
        // fight the defending village's SEALED garrison team. Same deterministic
        // engine, same replay, garrison weight and cap — and a real defender
        // turning up re-locks it, because only live battles move lastLiveBattleAt.
        if (action === 'garrison-duel') {
            // Fail closed: each garrison duel's battle id carries its own start
            // time, so two runs of this block at once (a double-tap that outwaits
            // the lock) would both pass the idle check and both score.
            const result = await withKvLock(garrisonSessionKey(sectorWarId), async () => {
                const now = Date.now();
                const contest = await loadSectorWar(sectorWarId);
                // An ended war fields no garrison, and says so plainly rather than
                // blaming a defender who is not there (the idle check below).
                if (!contest || !isSectorWarActive(contest, now)) return { status: 409 as const, body: { error: 'No active sector war for that id.' } };
                if (contest.winCondition !== 'pet') return { status: 409 as const, body: { error: 'That sector is not a Pet contest.' } };
                const myVillage = identity.admin ? contest.attackerVillage : await villageOf(me);
                if (myVillage !== contest.attackerVillage) {
                    return { status: 403 as const, body: { error: 'Only the attacking village can fight the garrison.' } };
                }
                if (!contestGarrisonReady(contest, now)) {
                    // Two different reasons, two different messages: "a defender is
                    // actually here" and "you just fought the garrison" are not the
                    // same news, and telling a player the wrong one is worse than
                    // telling them nothing.
                    const inMin = (from: number) => Math.max(1, Math.ceil((GARRISON_UNLOCK_IDLE_MS - (now - from)) / 60_000));
                    const error = sectorWarGarrisonIdle(contest, now)
                        ? `The garrison is still re-forming — you can fight it again in ${inMin(lastGarrisonBattleAt(contest))} min.`
                        : `The defence is still contesting this sector — the garrison can be fought in ${inMin(Math.max(contest.lastLiveBattleAt ?? 0, contest.startedAt))} min if no defender answers.`;
                    return { status: 409 as const, body: { error } };
                }
                const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
                if (!pet) return { status: 400 as const, body: { error: 'You have no pet to send into battle.' } };
                const team = (await sealWarTeam(me, [String(pet.id)])) ?? [pet];
                // The first ANBU in rotation (then the Kage) who can actually
                // field a team holds the garrison. One whose pets are all on an
                // expedition or breeding used to refuse the whole assault, every
                // time the rotation landed on them.
                const fielded = await fieldGarrisonDefender(contest.defenderVillage, async (slug) => {
                    const garrisonTeam = await sealWarTeam(slug);
                    return garrisonTeam?.length ? garrisonTeam : null;
                });
                if (!fielded.ok) {
                    return { status: 409 as const, body: { error: fielded.reason === 'no-defender'
                        ? NO_GARRISON_DEFENDER_ERROR
                        : 'The garrison has no pet able to hold this sector right now.' } };
                }
                const defender = fielded.defender;
                const garrisonTeam = fielded.fielded;

                // The terrain sealed into the contest at declaration (the
                // holder's current setting for a war declared before that).
                const terrain = contest.terrain ?? sectorConfigFor(
                    normalizeVillageWarRecord(contest.defenderVillage, (await kv.get<Record<string, unknown>>(villageWarKey(contest.defenderVillage))) ?? undefined),
                    contest.sector,
                ).terrain;
                const seed = (now ^ (contest.sector * 2654435761)) >>> 0;
                // The garrison fights under the defence's MASKED name, as the
                // Combat garrison does: it represents the village, not a callout
                // of which ANBU's kennel it borrowed.
                const p2 = { name: maskedGarrisonDefenderName(contest.defenderVillage, defender, fielded.appointees), pet: garrisonTeam[0]!, team: garrisonTeam };
                const p1 = { name: me, pet, team };
                const duel = resolveWarDuel(sectorWarInput({ sectorWarId, seed, terrain, p1, p2 }));
                const session: SectorPetSession = {
                    sectorWarId, sector: contest.sector,
                    attackerVillage: contest.attackerVillage, defenderVillage: contest.defenderVillage,
                    p1, p2, status: 'done', seed,
                    winner: duel.outcome === 'from' ? 'p1' : 'p2',
                    terrain, engine: 'showdown', garrison: true, garrisonDefenderSlug: defender.slug,
                    createdAt: now, updatedAt: now,
                };
                session.warResult = warResultFrom(await applyPetOutcomeToContest(session));
                session.appliedToContest = true;
                await kv.set(garrisonSessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
                return { status: 200 as const, body: {
                    session: projectPetSession(session, { side: 'p1', village: '', admin: identity.admin }),
                    garrisonDefendedByKage: defender.byKage,
                } };
            }, { failClosed: true });
            return res.status(result.status).json(result.body);
        }

        if (action !== 'join') return res.status(400).json({ error: `Unknown action: ${action}` });

        const result = await withKvLock(sessionKey(sectorWarId), async () => {
            const now = Date.now();
            const existing = await kv.get<SectorPetSession>(sessionKey(sectorWarId));
            const contest = await loadSectorWar(sectorWarId);
            // An ENDED war (captured, defended, abandoned, or past its 72 hours)
            // opens and answers no duels: a defended row lingers for a day, and a
            // duel on it used to resolve as if the war could still count it.
            if (!contest || !isSectorWarActive(contest, now)) return { status: 409 as const, body: { error: 'No active sector war for that id.' } };
            if (contest.winCondition !== 'pet') return { status: 409 as const, body: { error: 'That sector is not a Pet contest.' } };
            const { attackerVillage, defenderVillage } = contest;

            const myVillage = identity.admin
                ? (String(body?.side ?? 'p1') === 'p2' ? defenderVillage : attackerVillage)
                : await villageOf(me);
            const isAttacker = myVillage === attackerVillage;
            const isDefender = myVillage === defenderVillage;
            if (!isAttacker && !isDefender) return { status: 403 as const, body: { error: 'You are not a participant in this sector war.' } };
            const viewer = (side: PetViewer['side']): PetViewer => ({ side, village: myVillage, admin: identity.admin });

            const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
            if (!pet) return { status: 400 as const, body: { error: 'You have no pet to send into battle.' } };
            // The champion leads; the rest of the 2v2+bench team fills from the
            // same roster (owner ruling: war duels are 2v2 with two reserves).
            const team = (await sealWarTeam(me, [String(pet.id)])) ?? [pet];

            // Attacker opens a fresh duel (or re-opens after the last one finished).
            if (!existing || existing.status === 'done') {
                if (!isAttacker) return { status: 409 as const, body: { error: 'Waiting for an attacker to send a pet.' } };
                const session: SectorPetSession = {
                    sectorWarId, sector: contest.sector, attackerVillage, defenderVillage,
                    p1: { name: me, pet, team }, status: 'awaiting-defender', createdAt: now, updatedAt: now,
                };
                await kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
                return { status: 200 as const, body: { session: projectPetSession(session, viewer('p1')) } };
            }
            // Idempotent re-open by the same attacker (e.g. a retry before a defender answered).
            if (sameName(existing.p1.name, me)) {
                return { status: 200 as const, body: { session: projectPetSession(existing, viewer('p1')) } };
            }
            if (existing.status !== 'awaiting-defender') return { status: 409 as const, body: { error: 'This pet duel is no longer accepting a defender.' } };
            if (!isDefender) return { status: 409 as const, body: { error: 'A defender of this sector must answer the pet duel.' } };

            // Defender joins → resolve the deterministic duel SERVER-SIDE + apply it.
            // The defender sector's terrain is sealed on the session and becomes the
            // arena's STANDING WEATHER (§17.3's home-ground bonus in Showdown's native
            // terms: the sector's climate boosts its own element and hangs visibly
            // over the field). Neither owner is present, so both sides run the same
            // AI over their own sealed kits — symmetric by construction. The old
            // doctrine briefing was a legacy-sim concept and retires with it: a
            // garrison's plan is now its KIT, not a side-channel order.
            const terrain = contest.terrain ?? sectorConfigFor(
                normalizeVillageWarRecord(defenderVillage, (await kv.get<Record<string, unknown>>(villageWarKey(defenderVillage))) ?? undefined),
                contest.sector,
            ).terrain;
            // Fixed by the table, not this request: a retry after a lost session
            // write fights the duel the contest already scored (petDuelSeed).
            const seed = petDuelSeed(sectorWarId, existing.createdAt);
            const duel = resolveWarDuel(sectorWarInput({ sectorWarId, seed, terrain, p1: existing.p1, p2: { name: me, pet, team } }));
            // Showdown's judge always decides — 'draw' survives in the type only
            // for sessions the retired engine recorded.
            const winner: 'p1' | 'p2' = duel.outcome === 'from' ? 'p1' : 'p2';
            const session: SectorPetSession = { ...existing, p2: { name: me, pet, team }, status: 'done', seed, winner, terrain, engine: 'showdown', updatedAt: now };
            session.warResult = warResultFrom(await applyPetOutcomeToContest(session));
            session.appliedToContest = true;
            await kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
            return { status: 200 as const, body: { session: projectPetSession(session, viewer('p2')) } };
        }, { failClosed: true });

        return res.status(result.status).json(result.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'That pet duel is busy right now — try again in a moment.' });
        }
        console.error('[village/sector-pet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
