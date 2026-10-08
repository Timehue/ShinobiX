import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { syncCardDuelPresence } from '../card-clash/_presence.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { normalizeVillageWarRecord, villageWarKey } from '../_war-state.js';
import { sectorWarDamageMultiplier, defenderPointsMultiplier } from '../_war-structures.js';
import { sectorWarRoleOf, sectorControlSwing, ROLE_VILLAGER } from '../_war-role.js';
import { applyContestBattleByWinner, contestGarrisonReady, isSectorWarActive, lastGarrisonBattleAt, sectorWarGarrisonIdle, GARRISON_UNLOCK_IDLE_MS } from '../_sector-war.js';
import { fieldGarrisonDefender, NO_GARRISON_DEFENDER_ERROR } from '../_sector-war-garrison-defender.js';
import {
    applyPlayerAction, createAiMatch, forfeit as forfeitAiMatch, isDone as aiMatchIsDone,
    projectAiMatch, type AiMatchSession,
} from '../card-clash/_ai-engine.js';
import { commitSectorWarBattle, loadSectorWar, type SectorWarBattleCommit, type SectorWarBattleDecision } from '../_sector-war-store.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import { resolveChronicleDeckMutation, resolveChronicleDeckWithSave, type ChronicleDeckResolution } from '../card-clash/_deck.js';
import {
    CHRONICLE_RULES_VERSION, advanceExpiredChronicleTurn, applyAction, createMatch,
    projectMatchForViewer,
    type ChronicleActionIntent, type ChronicleMatch, type ChronicleSideKey,
} from '../../shared/chronicle-duel.js';

const SESSION_TTL_SEC=2*60*60;
/** How often a waiting attacker's own poll keeps their open table alive. The
 *  table used to be rewritten (session + presence) on EVERY 2-second poll just
 *  to refresh its TTL; once per this window keeps the same seat open. */
const AWAITING_SEAT_REFRESH_MS=10*60_000;
const ACTIONS=new Set(['normal-summon','set-monster','flip-summon','change-position','activate-magic','set-trap','activate-trap','pass-response','advance-phase','start-battle','attack','enter-main-2','enter-end-phase','end-turn','forfeit']);
/** What the finished duel did to the war, so the table can say so truthfully:
 *  a duel that ended after the war did ("past the whistle"), or that belongs to
 *  an earlier war on the sector, scores nothing and must not read as scored. */
type WarResult={scored:boolean;points?:number;reason?:string};
type Session={rulesVersion:typeof CHRONICLE_RULES_VERSION;sectorWarId:string;sector:number;attackerVillage:string;defenderVillage:string;p1Name:string;p1Deck:string[];p2Name?:string;p2Deck?:string[];state?:ChronicleMatch;status:'awaiting-defender'|'active'|'done';createdAt:number;updatedAt:number;appliedToContest?:boolean;warResult?:WarResult};
function warResultFrom(commit:SectorWarBattleCommit):WarResult{return commit.status==='applied'?{scored:true,points:commit.receipt.points}:{scored:false,reason:commit.status==='skipped'?commit.reason:'missing'}}
function warResultOf(session:{warResult?:WarResult}):{warResult?:WarResult}{return session.warResult?{warResult:session.warResult}:{}}
/** When the duel ended: the session's last change, stamped by the move (or the
 *  clock) that finished it. Scoring reads THIS, never the request that happens
 *  to apply it, exactly like the world-PvP continuation's `endedAt`. */
function battleEndedAt(session:{updatedAt:number}):number{return Math.floor(Number(session.updatedAt)||0)||Date.now()}
const sessionKey=(id:string)=>`sector-card:${id}`;
function ids(value:unknown):string[]{if(!Array.isArray(value))return[];return value.flatMap((entry)=>typeof entry==='string'?[entry]:entry&&typeof entry==='object'&&typeof(entry as{id?:unknown}).id==='string'?[String((entry as{id:string}).id)]:[])}
function idx(value:unknown):number|undefined{const n=Number(value);return Number.isFinite(n)?Math.floor(n):undefined}
async function villageOf(name:string){const save=await kv.get<{character?:{village?:string}}>(`save:${safeName(name)}`);return String(save?.character?.village??'').trim()}
// Deck resolution writes the player's save (starter grants + approved deck) and
// bumps `_saveVersion`. Echo the new version on every join response so the
// client's authFetch observer advances its base version; otherwise the next
// autosave echoes a stale version, 409s, and reconciles local progress away.
async function resolveDeck(name:string,requested:string[],admin:boolean):Promise<ChronicleDeckResolution|null>{return resolveChronicleDeckWithSave(name,requested,admin)}
function versionEcho(resolution:ChronicleDeckResolution):Record<string,number>{return resolution.saveVersion===undefined?{}:{_saveVersion:resolution.saveVersion}}
async function saveSession(session:Session){await kv.set(sessionKey(session.sectorWarId),session,{ex:SESSION_TTL_SEC});await syncCardDuelPresence(kv,sessionKey(session.sectorWarId),session,SESSION_TTL_SEC)}
async function applyOutcome(session:Session){if(!session.state?.winner||session.appliedToContest)return;const winner=session.state.winner;const winnerName=winner==='p1'?session.p1Name:winner==='p2'?(session.p2Name??''):'';const loserName=winner==='p1'?(session.p2Name??''):winner==='p2'?session.p1Name:'';const[winnerRole,loserRole]=await Promise.all([sectorWarRoleOf(winnerName),sectorWarRoleOf(loserName)]);const endedAt=battleEndedAt(session);/* One CAS commits the receipt with the tally (deduped past the in-row ledger). A settled war is no longer written, a duel opened before this contest instance belongs to an earlier war on the sector, and a duel that ENDED after the war stopped being live is past the whistle: it is skipped, never scored as a 0-point receipt (which still logged `battle-scored` and still put its winner on the capture credit). */const commit=await commitSectorWarBattle({contestId:session.sectorWarId,battleId:`card:${session.sectorWarId}:${session.createdAt}`,decide:async(contest):Promise<SectorWarBattleDecision>=>{if(contest.flipped||contest.expiredAt)return{kind:'skip',reason:'terminal'};if(session.createdAt<contest.startedAt)return{kind:'skip',reason:'superseded'};if(!isSectorWarActive(contest,endedAt))return{kind:'skip',reason:'superseded'};const[atkRaw,defRaw]=await Promise.all([kv.get<Record<string,unknown>>(villageWarKey(session.attackerVillage)),kv.get<Record<string,unknown>>(villageWarKey(session.defenderVillage))]);const outcome=applyContestBattleByWinner(contest,winner,{now:endedAt,roleSwing:sectorControlSwing(winnerRole,loserRole),attackerMult:sectorWarDamageMultiplier(normalizeVillageWarRecord(session.attackerVillage,atkRaw??undefined)),defenderMult:defenderPointsMultiplier(normalizeVillageWarRecord(session.defenderVillage,defRaw??undefined)),by:winnerName});if(!outcome)return{kind:'skip',reason:'draw'};/* sectors never flip mid-war — settlement compares the tallies at 72h */return{kind:'score',outcome,attackerWon:winner==='p1',by:winnerName,at:endedAt}}});session.appliedToContest=true;session.warResult=warResultFrom(commit)}
async function persist(session:Session){if(session.status==='done')await applyOutcome(session);await saveSession(session)}
// The shared clock: passes expired turns, and forfeits a duelist who misses two in
// a row (shared/chronicle-duel.ts advanceExpiredChronicleTurn); applyOutcome then
// scores that forfeit on the contest like any other result. Returns whether the
// clock settled anything, so the handler can keep it even when it refuses the request.
function timeout(session:Session,now:number):boolean{if(!session.state||session.state.status!=='active')return false;const state=advanceExpiredChronicleTurn(session.state,now);const advanced=state!==session.state;if(!advanced)return false;session.state=state;session.status=state.status==='complete'?'done':'active';session.updatedAt=now;return true}
function intent(body:Record<string,unknown>,action:string):ChronicleActionIntent{return{action,handIndex:idx(body.handIndex),zoneIndex:idx(body.zoneIndex),tributeZoneIndexes:Array.isArray(body.tributeZoneIndexes)?body.tributeZoneIndexes.map(idx).filter((n):n is number=>n!==undefined):undefined,attackerZoneIndex:idx(body.attackerZoneIndex),targetZoneIndex:body.targetZoneIndex===null?null:idx(body.targetZoneIndex),targetSide:body.targetSide==='p1'||body.targetSide==='p2'?body.targetSide:undefined,graveyardIndex:idx(body.graveyardIndex),...(body.position==='attack'||body.position==='defense'?{position:body.position}:{})}}


// --- Garrison: the sector's own defence stands in for an absent player ------
//
// A Card contest scores nothing until a defender takes the other seat, so a
// village that simply never logs in used to run the 72h clock out at 0-0 and
// keep the sector on settlement's tie-to-the-defender rule. After
// GARRISON_UNLOCK_IDLE_MS with no LIVE battle the attacker may instead play the
// defending village's SEALED deck, driven by the server-owned Chronicle AI
// (api/card-clash/_ai-engine.ts) in `external` settlement mode -- this endpoint
// settles the contest, and the AI path pays no reward of its own.
//
// The AI plays at GARRISON_AI_DIFFICULTY over the defence's REAL deck. The
// balance lever here is deliberately the payout, not a deliberately weak
// opponent: applySectorWarBattle already halves a garrison win and caps the
// war-wide total, so a garrison that folded on sight would just be a different
// free-points hole. One constant, easy to turn down.
const GARRISON_AI_DIFFICULTY = 'hard' as const;
const garrisonKey = (id: string) => `sector-card-garrison:${id}`;

type GarrisonSession = {
    // `p1Name` and `status` exist so this row satisfies CardDuelSessionShape
    // (api/card-clash/_presence.ts) and the heartbeat resolver can read it. The
    // garrison is an AI, so there is no p2 to enrol -- cardDuelParticipants drops
    // the empty seat and the lone attacker is the duelist.
    p1Name: string;
    status: 'active' | 'done';
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    attackerName: string;
    /** safeName of the player whose sealed deck the garrison is playing. */
    defenderSlug: string;
    defendedByKage: boolean;
    match: AiMatchSession;
    createdAt: number;
    updatedAt: number;
    appliedToContest?: boolean;
    warResult?: WarResult;
};

/** Read a player's server-approved Chronicle deck WITHOUT writing their save.
 *  resolveChronicleDeckWithSave grants starter cards and bumps `_saveVersion`;
 *  running that on the DEFENDER as a side effect of someone else's assault
 *  would mutate an uninvolved player's save, so the garrison uses the pure half
 *  and simply refuses a defender who has no legal deck of their own yet. */
async function sealedGarrisonDeck(slug: string): Promise<string[] | null> {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(slug)}`);
    const character = save?.character;
    if (!character) return null;
    const resolved = resolveChronicleDeckMutation(character, []);
    return resolved.ok ? resolved.value.deck : null;
}

/** Apply a finished garrison match to the contest at garrison weight. Idempotent
 *  through the contest's own battle receipt, under the contest lock. */
async function applyGarrisonOutcome(session: GarrisonSession): Promise<void> {
    if (session.appliedToContest) return;
    const result = session.match.winner;
    if (!result) return;
    const winner: 'p1' | 'p2' | 'draw' = result === 'player' ? 'p1' : result === 'opponent' ? 'p2' : 'draw';
    const attackerWon = winner === 'p1';
    // The garrison is an AI holding ground, not the ANBU whose deck it borrowed:
    // it weighs as a plain villager and credits nobody. Mirrors the Combat
    // garrison in api/village/sector-war.ts.
    const winnerName = attackerWon ? session.attackerName : '';
    const attackerRole = await sectorWarRoleOf(session.attackerName);
    const [winnerRole, loserRole] = attackerWon
        ? [attackerRole, ROLE_VILLAGER] as const
        : [ROLE_VILLAGER, attackerRole] as const;
    const endedAt = battleEndedAt(session);
    const commit = await commitSectorWarBattle({
        contestId: session.sectorWarId,
        battleId: `card-garrison:${session.sectorWarId}:${session.createdAt}`,
        decide: async (contest): Promise<SectorWarBattleDecision> => {
            // A settled war's row is no longer written; an assault opened
            // against an earlier war on this sector never scores this one; and
            // one that ended after the war stopped being live is past the
            // whistle — skipped, never a 0-point receipt.
            if (contest.flipped || contest.expiredAt) return { kind: 'skip', reason: 'terminal' };
            if (session.createdAt < contest.startedAt) return { kind: 'skip', reason: 'superseded' };
            if (!isSectorWarActive(contest, endedAt)) return { kind: 'skip', reason: 'superseded' };
            const at = endedAt;
            const [atkRaw, defRaw] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(session.attackerVillage)),
                kv.get<Record<string, unknown>>(villageWarKey(session.defenderVillage)),
            ]);
            const outcome = applyContestBattleByWinner(contest, winner, {
                now: at,
                roleSwing: sectorControlSwing(winnerRole, loserRole),
                attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(session.attackerVillage, atkRaw ?? undefined)),
                defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(session.defenderVillage, defRaw ?? undefined)),
                by: winnerName,
                // Half-weight + war cap on an attacker win; merc-repel weight when
                // the garrison holds. Exactly Combat's split.
                garrisonBattle: attackerWon,
                mercBattle: !attackerWon,
            });
            if (!outcome) return { kind: 'skip', reason: 'draw' }; // draw -- nothing scores
            return {
                kind: 'score', outcome, attackerWon, by: winnerName, at,
                // Flagged on EITHER outcome: the re-form window keys on it, and a
                // loss must start that cooldown too. garrisonPointsInWar filters on
                // attackerWon, so a hold never eats the attacker's cap.
                garrison: true,
            };
        },
    });
    session.appliedToContest = true;
    session.warResult = warResultFrom(commit);
}

/** Persist the garrison row AND its battle presence together.
 *
 *  A garrison assault is a real multi-turn Chronicle match, so it makes the
 *  attacker provably in a fight exactly like a live duel does (c998682d3) and
 *  like the Combat garrison already does through its Solo-PvE session. Without
 *  this the attacker could be roamed and attacked mid-match -- the same gap the
 *  presence pass closed everywhere else. `status` mirrors the match so the row
 *  retires its own projection the moment the assault finishes. */
async function saveGarrison(session: GarrisonSession): Promise<void> {
    session.status = session.match.status === 'done' ? 'done' : 'active';
    const key = garrisonKey(session.sectorWarId);
    await kv.set(key, session, { ex: SESSION_TTL_SEC });
    await syncCardDuelPresence(kv, key, session, SESSION_TTL_SEC);
}

type GarrisonReply = { status: 200 | 400 | 403 | 404 | 409; body: Record<string, unknown> };

/** Act on the attacker's OWN live garrison match. No contest gate: a match in
 *  progress always finishes (the war ending mid-match only means the result
 *  will not score — applyGarrisonOutcome reads the battle's own clock). */
async function actOnOwnGarrison(session: GarrisonSession, action: string, body: Record<string, unknown>, now: number): Promise<GarrisonReply> {
    if (action === 'join' || action === 'state') {
        return { status: 200, body: { session: projectAiMatch(session.match), garrisonDefendedByKage: session.defendedByKage } };
    }
    if (!ACTIONS.has(action)) return { status: 400, body: { error: `Unknown action: ${action}` } };
    if (action === 'forfeit') {
        forfeitAiMatch(session.match);
    } else {
        const applied = applyPlayerAction(session.match, intent(body, action), now);
        if (!applied.ok) return { status: 400, body: { error: applied.error } };
    }
    session.updatedAt = now;
    if (aiMatchIsDone(session.match)) await applyGarrisonOutcome(session);
    await saveGarrison(session);
    return { status: 200, body: { session: projectAiMatch(session.match), ...warResultOf(session) } };
}

async function runGarrison(me: string, admin: boolean, sectorWarId: string, action: string, body: Record<string, unknown>): Promise<GarrisonReply> {
    const now = Date.now();
    let session = await kv.get<GarrisonSession>(garrisonKey(sectorWarId));
    const mine = !!session && session.match.rulesVersion === CHRONICLE_RULES_VERSION && safeName(session.attackerName) === safeName(me);
    if (session && mine && session.match.status === 'active') return actOnOwnGarrison(session, action, body, now);
    if (session && mine && action === 'state') {
        return { status: 200, body: { session: projectAiMatch(session.match), ...warResultOf(session) } };
    }

    // Everything else opens (or would open) a NEW match, and that needs a live
    // Card war this player attacks. A war that has ended — captured, defended,
    // abandoned or past its 72 hours — mints nothing, and says so: the idle
    // check below would otherwise blame a defender who is not there.
    const contest = await loadSectorWar(sectorWarId);
    if (!contest || !isSectorWarActive(contest, now)) return { status: 409, body: { error: 'No active sector war for that id.' } };
    if (contest.winCondition !== 'card') return { status: 409, body: { error: 'That sector is not a Card contest.' } };
    const myVillage = admin ? contest.attackerVillage : await villageOf(me);
    if (myVillage !== contest.attackerVillage) {
        return { status: 403, body: { error: 'Only the attacking village can fight the garrison.' } };
    }

    if (session && !mine) {
        // A retired-rules match, or one another attacker from this village left
        // behind, is not resumable. Only a finished one may be replaced.
        if (session.match.status === 'active') {
            return { status: 409, body: { error: 'Another assault on this garrison is still in progress.' } };
        }
        session = null;
    }

    // Nothing live of this attacker's is left to act on: only `join` may open
    // a match, and a `state` with no match of theirs finds none.
    if (action === 'state') return { status: 404, body: { error: 'No garrison assault in progress.' } };
    if (action !== 'join') return { status: 409, body: { error: 'Open the garrison assault before acting on it.' } };

    // The unlock is re-checked HERE, at the only point that mints a match --
    // never trusted from the client, and never from a stale read: a defender
    // who fought two minutes ago has already re-locked this.
    if (!contestGarrisonReady(contest, now)) {
        // Two different reasons, two different messages -- "a defender is
        // actually here" and "you just fought the garrison" are not the same
        // news, and telling a player the wrong one is worse than saying nothing.
        const inMin = (from: number) => Math.max(1, Math.ceil((GARRISON_UNLOCK_IDLE_MS - (now - from)) / 60_000));
        const error = sectorWarGarrisonIdle(contest, now)
            ? `The garrison is still re-forming - you can fight it again in ${inMin(lastGarrisonBattleAt(contest))} min.`
            : `The defence is still contesting this sector - the garrison can be fought in ${inMin(Math.max(contest.lastLiveBattleAt ?? 0, contest.startedAt))} min if no defender answers.`;
        return { status: 409, body: { error } };
    }
    // The first ANBU in rotation (then the Kage) who actually HAS a legal deck
    // holds the garrison: one appointee without a deck no longer refuses the
    // assault while the rest of the village could have held it.
    const fielded = await fieldGarrisonDefender(contest.defenderVillage, sealedGarrisonDeck);
    if (!fielded.ok) {
        return { status: 409, body: { error: fielded.reason === 'no-defender'
            ? NO_GARRISON_DEFENDER_ERROR
            : 'The garrison has no legal deck to hold this sector with.' } };
    }
    const defender = fielded.defender;
    const garrisonDeck = fielded.fielded;
    const attackerDeck = await resolveDeck(me, ids(body.deck ?? body.defaultDeck), admin);
    if (!attackerDeck) return { status: 400, body: { error: 'No legal 40-card Chronicle deck is available.' } };

    const match = createAiMatch(
        `sector-card-garrison:${sectorWarId}:${now}`, me, attackerDeck.deck, GARRISON_AI_DIFFICULTY, now, Math.random,
        'external', undefined,
        { name: `${contest.defenderVillage} Garrison`, deck: garrisonDeck, deckName: `${contest.defenderVillage} Garrison` },
    );
    const fresh: GarrisonSession = {
        p1Name: me, status: 'active',
        sectorWarId, sector: contest.sector,
        attackerVillage: contest.attackerVillage, defenderVillage: contest.defenderVillage,
        attackerName: me, defenderSlug: defender.slug, defendedByKage: defender.byKage,
        match, createdAt: now, updatedAt: now,
    };
    if (aiMatchIsDone(fresh.match)) await applyGarrisonOutcome(fresh);
    await saveGarrison(fresh);
    return { status: 200, body: { ...versionEcho(attackerDeck), session: projectAiMatch(fresh.match), garrisonDefendedByKage: defender.byKage, ...warResultOf(fresh) } };
}

type TableReply = { status: 200 | 400 | 403 | 404 | 409; body: Record<string, unknown> };

/** A table answer that is not a match yet: the client shows its waiting panel.
 *  `awaiting-attacker` = nobody has opened the table; `awaiting-defender` =
 *  an attacker has, and the defender's seat is open. */
function waitingTable(status: 'awaiting-attacker' | 'awaiting-defender', viewerSide: ChronicleSideKey | null): Record<string, unknown> {
    return { rulesVersion: CHRONICLE_RULES_VERSION, status, viewerSide };
}

function seatedProjection(session: Session, side: ChronicleSideKey): Record<string, unknown> {
    return session.state
        ? projectMatchForViewer(session.state, side) as unknown as Record<string, unknown>
        : { rulesVersion: CHRONICLE_RULES_VERSION, status: session.status, viewerSide: side };
}

/**
 * A `state` poll from someone with no seat at this table. Duelists only see the
 * match — but a DEFENDER of this war who opened the table before any attacker
 * did must still be seated the moment one does. Their screen used to call
 * `join` once, be told "waiting for an attacker", and then poll a `state` that
 * answered 403 forever. They now get a waiting answer, and `seatOpen` once
 * there is a seat for them to take with a `join`. Never the match itself.
 */
async function unseatedState(session: Session | null, sectorWarId: string, me: string, now: number): Promise<TableReply> {
    const village = await villageOf(me);
    if (!session) {
        const contest = await loadSectorWar(sectorWarId);
        if (contest && contest.winCondition === 'card' && isSectorWarActive(contest, now) && village === contest.defenderVillage) {
            return { status: 200, body: { session: waitingTable('awaiting-attacker', null) } };
        }
        return { status: 404, body: { error: 'No card duel session yet.' } };
    }
    if (village === session.defenderVillage) {
        if (session.status === 'awaiting-defender') return { status: 200, body: { session: waitingTable('awaiting-defender', null), seatOpen: true } };
        if (session.status === 'done') return { status: 200, body: { session: waitingTable('awaiting-attacker', null) } };
        return { status: 409, body: { error: 'The defender seat is unavailable.' } };
    }
    return { status: 403, body: { error: 'Only duelists may inspect this battle.' } };
}

async function runTable(me: string, admin: boolean, sectorWarId: string, action: string, body: Record<string, unknown>): Promise<TableReply> {
    let session = await kv.get<Session>(sessionKey(sectorWarId));
    const now = Date.now();
    if (session && session.rulesVersion !== CHRONICLE_RULES_VERSION) return { status: 409, body: { error: 'This duel used retired rules; start a new duel.' } };
    const advanced = session ? timeout(session, now) : false;
    const viewer: ChronicleSideKey | null = session
        ? safeName(session.p1Name) === safeName(me) ? 'p1' : session.p2Name && safeName(session.p2Name) === safeName(me) ? 'p2' : null
        : null;
    /* A duelist's (or an admin's) request scores and stores what the clock settled before it is judged, so a refused move cannot drop it. Nobody else moves a duel's clock; a join that replaces a finished table scores it first (below). A state poll persists it itself. */
    if (session && advanced && action !== 'state' && (viewer || admin)) await persist(session);

    if (action === 'state') {
        if (!viewer && !admin) return unseatedState(session, sectorWarId, me, now);
        if (!session) return { status: 404, body: { error: 'No card duel session yet.' } };
        // Write only what changed. Every duelist polls every two seconds, and
        // each poll used to rewrite the session and both presence rows under
        // the table lock even when nothing had moved.
        if (advanced || (session.status === 'done' && !session.appliedToContest)) {
            await persist(session);
        } else if (viewer === 'p1' && session.status === 'awaiting-defender' && now - session.updatedAt >= AWAITING_SEAT_REFRESH_MS) {
            // A waiting attacker's open table stays alive while they wait.
            session.updatedAt = now;
            await saveSession(session);
        }
        return { status: 200, body: { session: seatedProjection(session, viewer ?? 'p1'), ...warResultOf(session) } };
    }

    if (action === 'join' || action === 'submit-deck') {
        // A duelist already seated at a live table re-enters it (a refresh):
        // no deck work and no contest gate — a match in progress always
        // finishes, and its result scores by the duel's own clock.
        if (session && session.status !== 'done' && viewer) {
            return { status: 200, body: { session: seatedProjection(session, viewer) } };
        }
        const contest = await loadSectorWar(sectorWarId);
        // An ENDED war opens and answers no tables. A defended or abandoned
        // row lingers for a day after its verdict; a table on it used to play
        // a whole duel the war could no longer count.
        if (!contest || !isSectorWarActive(contest, now) || contest.winCondition !== 'card') {
            return { status: 409, body: { error: 'No active Card contest for that sector.' } };
        }
        const myVillage = admin ? (body.side === 'p2' ? contest.defenderVillage : contest.attackerVillage) : await villageOf(me);
        const attacker = myVillage === contest.attackerVillage;
        const defender = myVillage === contest.defenderVillage;
        if (!attacker && !defender) return { status: 403, body: { error: 'You are not a participant in this sector war.' } };
        if (!session || session.status === 'done') {
            // A defender who arrives before any attacker waits for one: a
            // waiting answer their screen polls through, not an error.
            if (!attacker) return { status: 200, body: { session: waitingTable('awaiting-attacker', null) } };
            const resolution = await resolveDeck(me, ids(body.deck ?? body.defaultDeck), admin);
            if (!resolution) return { status: 400, body: { error: 'No legal 40-card Chronicle deck is available.' } };
            /* A finished table is scored before a new one replaces it, including one the clock ended on this request (applyOutcome runs once per table). */
            if (session) await applyOutcome(session);
            session = {
                rulesVersion: CHRONICLE_RULES_VERSION, sectorWarId, sector: contest.sector,
                attackerVillage: contest.attackerVillage, defenderVillage: contest.defenderVillage,
                p1Name: me, p1Deck: resolution.deck, status: 'awaiting-defender', createdAt: now, updatedAt: now,
            };
            await saveSession(session);
            return { status: 200, body: { ...versionEcho(resolution), session: waitingTable('awaiting-defender', 'p1') } };
        }
        if (session.status !== 'awaiting-defender') return { status: 409, body: { error: 'The defender seat is unavailable.' } };
        if (!defender) return { status: 409, body: { error: 'Another challenger from your village already holds this table. Wait for its duel to finish.' } };
        const resolution = await resolveDeck(me, ids(body.deck ?? body.defaultDeck), admin);
        if (!resolution) return { status: 400, body: { error: 'No legal 40-card Chronicle deck is available.' } };
        session.p2Name = me;
        session.p2Deck = resolution.deck;
        session.state = createMatch(session.p1Name, session.p1Deck, me, resolution.deck, Math.random, now);
        session.status = 'active';
        session.updatedAt = now;
        await saveSession(session);
        return { status: 200, body: { ...versionEcho(resolution), session: projectMatchForViewer(session.state, 'p2') } };
    }

    if (!session || !session.state) return { status: 404, body: { error: 'No active card battle.' } };
    const side = viewer ?? (admin ? (body.side === 'p2' ? 'p2' : 'p1') : null);
    if (!side) return { status: 403, body: { error: 'Only the two duelists can act.' } };
    if (!ACTIONS.has(action)) return { status: 400, body: { error: `Unknown action: ${action}` } };
    const applied = applyAction(session.state, side, intent(body, action), now);
    if (!applied.ok) return { status: 400, body: { error: applied.error } };
    session.state = applied.state;
    session.status = applied.state.status === 'complete' ? 'done' : 'active';
    session.updatedAt = now;
    await persist(session);
    return { status: 200, body: { session: projectMatchForViewer(session.state, side), ...warResultOf(session) } };
}

/** Sector-war Chronicle Showdown; p1 is always attacker and the contest consumes only the shared engine winner. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-card', 150, 60_000, identity.name))) return;
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '').toLowerCase();
        const sectorWarId = String(body.sectorWarId ?? '').trim();
        if (!sectorWarId) return res.status(400).json({ error: 'Missing sectorWarId.' });
        const me = identity.admin ? safeName(String(body.playerName ?? '')) : identity.name;
        if (body.garrison === true) {
            const g = await withKvLock(garrisonKey(sectorWarId), () => runGarrison(me, identity.admin, sectorWarId, action, body), { failClosed: true });
            return res.status(g.status).json(g.body);
        }
        const result = await withKvLock(sessionKey(sectorWarId), () => runTable(me, identity.admin, sectorWarId, action, body), { failClosed: true });
        return res.status(result.status).json(result.body);
    } catch (error) {
        // Lock contention is ordinary and retryable here — both duelists poll
        // the same table lock every two seconds — so it answers "busy" like
        // sector-war.ts and sector-pet.ts do, not a 500 that reads as an outage.
        if (error instanceof LockContendedError) {
            return res.status(503).json({ error: 'That card duel is busy right now — try again in a moment.' });
        }
        console.error('[village/sector-card]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
