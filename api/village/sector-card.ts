import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { syncCardDuelPresence } from '../card-clash/_presence.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { normalizeVillageWarRecord, villageWarKey } from '../_war-state.js';
import { sectorWarDamageMultiplier, defenderPointsMultiplier } from '../_war-structures.js';
import { sectorWarRoleOf, sectorControlSwing, ROLE_VILLAGER } from '../_war-role.js';
import { applyContestBattleByWinner, contestGarrisonReady, findSectorWarBattleReceipt, lastGarrisonBattleAt, recordSectorWarBattleOutcome, sectorWarGarrisonIdle, sectorWarKey, GARRISON_UNLOCK_IDLE_MS } from '../_sector-war.js';
import { garrisonDefenderFor, NO_GARRISON_DEFENDER_ERROR } from '../_sector-war-garrison-defender.js';
import {
    applyPlayerAction, createAiMatch, forfeit as forfeitAiMatch, isDone as aiMatchIsDone,
    projectAiMatch, type AiMatchSession,
} from '../card-clash/_ai-engine.js';
import { loadSectorWar, saveSectorWar } from '../_sector-war-store.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import { resolveChronicleDeckMutation, resolveChronicleDeckWithSave, type ChronicleDeckResolution } from '../card-clash/_deck.js';
import {
    CHRONICLE_RULES_VERSION, TURN_TIMEOUT_MS, applyAction, createMatch,
    passExpiredResponse, projectMatchForViewer,
    type ChronicleActionIntent, type ChronicleMatch, type ChronicleSideKey,
} from '../../shared/chronicle-duel.js';

const SESSION_TTL_SEC=2*60*60;
const ACTIONS=new Set(['normal-summon','set-monster','flip-summon','change-position','activate-magic','set-trap','activate-trap','pass-response','advance-phase','start-battle','attack','enter-main-2','enter-end-phase','end-turn','forfeit']);
type Session={rulesVersion:typeof CHRONICLE_RULES_VERSION;sectorWarId:string;sector:number;attackerVillage:string;defenderVillage:string;p1Name:string;p1Deck:string[];p2Name?:string;p2Deck?:string[];state?:ChronicleMatch;status:'awaiting-defender'|'active'|'done';createdAt:number;updatedAt:number;appliedToContest?:boolean};
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
async function applyOutcome(session:Session){if(!session.state?.winner||session.appliedToContest)return;const winnerName=session.state.winner==='p1'?session.p1Name:session.state.winner==='p2'?(session.p2Name??''):'';const loserName=session.state.winner==='p1'?(session.p2Name??''):session.state.winner==='p2'?session.p1Name:'';const[winnerRole,loserRole]=await Promise.all([sectorWarRoleOf(winnerName),sectorWarRoleOf(loserName)]);await withKvLock(sectorWarKey(session.sectorWarId),async()=>{const contest=await loadSectorWar(session.sectorWarId);if(!contest)return;const battleId=`card:${session.sectorWarId}:${session.createdAt}`;if(findSectorWarBattleReceipt(contest,battleId))return;const[atkRaw,defRaw]=await Promise.all([kv.get<Record<string,unknown>>(villageWarKey(session.attackerVillage)),kv.get<Record<string,unknown>>(villageWarKey(session.defenderVillage))]);const outcome=applyContestBattleByWinner(contest,session.state?.winner??'draw',{now:Date.now(),roleSwing:sectorControlSwing(winnerRole,loserRole),attackerMult:sectorWarDamageMultiplier(normalizeVillageWarRecord(session.attackerVillage,atkRaw??undefined)),defenderMult:defenderPointsMultiplier(normalizeVillageWarRecord(session.defenderVillage,defRaw??undefined)),by:winnerName});if(!outcome)return;const recorded=recordSectorWarBattleOutcome(outcome,{battleId,attackerWon:session.state?.winner==='p1',by:winnerName,at:Date.now()});/* sectors never flip mid-war — settlement compares the tallies at 72h */await saveSectorWar(recorded.session)},{failClosed:true});session.appliedToContest=true}
async function persist(session:Session){if(session.status==='done')await applyOutcome(session);await saveSession(session)}
function timeout(session:Session,now:number){if(!session.state||session.state.status!=='active')return;let state=session.state;if(state.responseWindow&&state.responseWindow.expiresAt<=now){const passed=passExpiredResponse(state,now);if(passed.ok)state=passed.state}if(!state.responseWindow&&state.turnStartedAt+TURN_TIMEOUT_MS<=now){const actor=state.activePlayer;for(let safety=0;safety<5&&state.activePlayer===actor;safety++){const timeoutAction:ChronicleActionIntent=state.phase==='draw'||state.phase==='standby'?{action:'advance-phase'}:state.phase==='battle'?{action:'enter-main-2'}:state.phase==='main1'||state.phase==='main2'?{action:'enter-end-phase'}:{action:'end-turn'};const advanced=applyAction(state,actor,timeoutAction,now);if(!advanced.ok)break;state=advanced.state}}session.state=state;session.status=state.status==='complete'?'done':'active';session.updatedAt=now}
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
    await withKvLock(sectorWarKey(session.sectorWarId), async () => {
        const contest = await loadSectorWar(session.sectorWarId);
        if (!contest) return;
        const battleId = `card-garrison:${session.sectorWarId}:${session.createdAt}`;
        if (findSectorWarBattleReceipt(contest, battleId)) return;
        const [atkRaw, defRaw] = await Promise.all([
            kv.get<Record<string, unknown>>(villageWarKey(session.attackerVillage)),
            kv.get<Record<string, unknown>>(villageWarKey(session.defenderVillage)),
        ]);
        const outcome = applyContestBattleByWinner(contest, winner, {
            now: Date.now(),
            roleSwing: sectorControlSwing(winnerRole, loserRole),
            attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(session.attackerVillage, atkRaw ?? undefined)),
            defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(session.defenderVillage, defRaw ?? undefined)),
            by: winnerName,
            // Half-weight + war cap on an attacker win; merc-repel weight when
            // the garrison holds. Exactly Combat's split.
            garrisonBattle: attackerWon,
            mercBattle: !attackerWon,
        });
        if (!outcome) return; // draw -- nothing scores
        const recorded = recordSectorWarBattleOutcome(outcome, {
            battleId, attackerWon, by: winnerName, at: Date.now(),
            // Flagged on EITHER outcome: the re-form window keys on it, and a
            // loss must start that cooldown too. garrisonPointsInWar filters on
            // attackerWon, so a hold never eats the attacker's cap.
            garrison: true,
        });
        await saveSectorWar(recorded.session);
    }, { failClosed: true });
    session.appliedToContest = true;
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

async function runGarrison(me: string, admin: boolean, sectorWarId: string, action: string, body: Record<string, unknown>): Promise<GarrisonReply> {
    const contest = await loadSectorWar(sectorWarId);
    if (!contest || contest.flipped) return { status: 409, body: { error: 'No active sector war for that id.' } };
    if (contest.winCondition !== 'card') return { status: 409, body: { error: 'That sector is not a Card contest.' } };
    const myVillage = admin ? contest.attackerVillage : await villageOf(me);
    if (myVillage !== contest.attackerVillage) {
        return { status: 403, body: { error: 'Only the attacking village can fight the garrison.' } };
    }

    const now = Date.now();
    let session = await kv.get<GarrisonSession>(garrisonKey(sectorWarId));
    if (session && (session.match.rulesVersion !== CHRONICLE_RULES_VERSION || safeName(session.attackerName) !== safeName(me))) {
        // A retired-rules match, or one another attacker from this village left
        // behind, is not resumable. Only a finished one may be replaced.
        if (session.match.status === 'active') {
            return { status: 409, body: { error: 'Another assault on this garrison is still in progress.' } };
        }
        session = null;
    }

    if (!session || session.match.status === 'done') {
        if (action !== 'join' && action !== 'state') {
            return { status: 409, body: { error: 'Open the garrison assault before acting on it.' } };
        }
        if (action === 'state') {
            return session
                ? { status: 200, body: { session: projectAiMatch(session.match) } }
                : { status: 404, body: { error: 'No garrison assault in progress.' } };
        }

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
        const defender = await garrisonDefenderFor(contest.defenderVillage);
        if (!defender) return { status: 409, body: { error: NO_GARRISON_DEFENDER_ERROR } };
        const garrisonDeck = await sealedGarrisonDeck(defender.slug);
        if (!garrisonDeck) return { status: 409, body: { error: 'The garrison has no legal deck to hold this sector with.' } };
        const mine = await resolveDeck(me, ids(body.deck ?? body.defaultDeck), admin);
        if (!mine) return { status: 400, body: { error: 'No legal 40-card Chronicle deck is available.' } };

        const match = createAiMatch(
            `sector-card-garrison:${sectorWarId}:${now}`, me, mine.deck, GARRISON_AI_DIFFICULTY, now, Math.random,
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
        return { status: 200, body: { ...versionEcho(mine), session: projectAiMatch(fresh.match), garrisonDefendedByKage: defender.byKage } };
    }

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
    return { status: 200, body: { session: projectAiMatch(session.match) } };
}

/** Sector-war Chronicle Showdown; p1 is always attacker and the contest consumes only the shared engine winner. */
export default async function handler(req:VercelRequest,res:VercelResponse){cors(res,req);if(req.method==='OPTIONS')return res.status(200).end();if(req.method!=='POST')return res.status(405).end();if(!villageWarMapEnabled())return res.status(404).json({error:'Not found.'});const identity=await authedPlayerOrAdmin(req);if(!identity)return res.status(401).json({error:'Authentication required.'});if(!identity.admin&&!(await enforceRateLimitKv(req,res,'sector-card',150,60_000,identity.name)))return;try{const body=(typeof req.body==='string'?JSON.parse(req.body):(req.body??{}))as Record<string,unknown>;const action=String(body.action??'').toLowerCase();const sectorWarId=String(body.sectorWarId??'').trim();if(!sectorWarId)return res.status(400).json({error:'Missing sectorWarId.'});const me=identity.admin?safeName(String(body.playerName??'')):identity.name;if(body.garrison===true){const g=await withKvLock(garrisonKey(sectorWarId),()=>runGarrison(me,identity.admin,sectorWarId,action,body),{failClosed:true});return res.status(g.status).json(g.body)}const result=await withKvLock(sessionKey(sectorWarId),async()=>{let session=await kv.get<Session>(sessionKey(sectorWarId));const now=Date.now();if(session&&session.rulesVersion!==CHRONICLE_RULES_VERSION)return{status:409 as const,body:{error:'This duel used retired rules; start a new duel.'}};if(session)timeout(session,now);const viewer:ChronicleSideKey|null=session?safeName(session.p1Name)===safeName(me)?'p1':session.p2Name&&safeName(session.p2Name)===safeName(me)?'p2':null:null;if(action==='state'){if(!session)return{status:404 as const,body:{error:'No card duel session yet.'}};if(!viewer&&!identity.admin)return{status:403 as const,body:{error:'Only duelists may inspect this battle.'}};await persist(session);const side=viewer??'p1';return{status:200 as const,body:{session:session.state?projectMatchForViewer(session.state,side):{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:side}}}}
if(action==='join'||action==='submit-deck'){const contest=await loadSectorWar(sectorWarId);if(!contest||contest.flipped||contest.winCondition!=='card')return{status:409 as const,body:{error:'No active Card contest for that sector.'}};const myVillage=identity.admin?(body.side==='p2'?contest.defenderVillage:contest.attackerVillage):await villageOf(me);const attacker=myVillage===contest.attackerVillage;const defender=myVillage===contest.defenderVillage;if(!attacker&&!defender)return{status:403 as const,body:{error:'You are not a participant in this sector war.'}};const resolution=await resolveDeck(me,ids(body.deck??body.defaultDeck),identity.admin);if(!resolution)return{status:400 as const,body:{error:'No legal 40-card Chronicle deck is available.'}};const deck=resolution.deck;const version=versionEcho(resolution);if(!session||session.status==='done'){if(!attacker)return{status:409 as const,body:{error:'Waiting for an attacker to open the battle.'}};session={rulesVersion:CHRONICLE_RULES_VERSION,sectorWarId,sector:contest.sector,attackerVillage:contest.attackerVillage,defenderVillage:contest.defenderVillage,p1Name:me,p1Deck:deck,status:'awaiting-defender',createdAt:now,updatedAt:now};await saveSession(session);return{status:200 as const,body:{...version,session:{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:'p1'}}}}if(safeName(session.p1Name)===safeName(me)||session.p2Name&&safeName(session.p2Name)===safeName(me)){const side=safeName(session.p1Name)===safeName(me)?'p1':'p2';return{status:200 as const,body:{...version,session:session.state?projectMatchForViewer(session.state,side):{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:side}}}}if(session.status!=='awaiting-defender'||!defender)return{status:409 as const,body:{error:'The defender seat is unavailable.'}};session.p2Name=me;session.p2Deck=deck;session.state=createMatch(session.p1Name,session.p1Deck,me,deck,Math.random,now);session.status='active';session.updatedAt=now;await saveSession(session);return{status:200 as const,body:{...version,session:projectMatchForViewer(session.state,'p2')}}}
if(!session||!session.state)return{status:404 as const,body:{error:'No active card battle.'}};const side=viewer??(identity.admin?(body.side==='p2'?'p2':'p1'):null);if(!side)return{status:403 as const,body:{error:'Only the two duelists can act.'}};if(!ACTIONS.has(action))return{status:400 as const,body:{error:`Unknown action: ${action}`}};const applied=applyAction(session.state,side,intent(body,action),now);if(!applied.ok)return{status:400 as const,body:{error:applied.error}};session.state=applied.state;session.status=applied.state.status==='complete'?'done':'active';session.updatedAt=now;await persist(session);return{status:200 as const,body:{session:projectMatchForViewer(session.state,side)}}},{failClosed:true});return res.status(result.status).json(result.body)}catch(error){console.error('[village/sector-card]',error);return res.status(500).json({error:'Internal server error.'})}}
