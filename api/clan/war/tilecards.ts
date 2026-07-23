import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    applyFinalResult, applyLazyClanWarExpiry, CLAN_WAR_REMATCH_COOLDOWN_SEC,
    clanWarCooldownKey, loadClanContext, type ChallengeResult, type ClanWar,
} from './_storage.js';
import { awardWarEndClanXp } from './_war-xp.js';
import { resolveChronicleDeck } from '../../card-clash/_deck.js';
import {
    CHRONICLE_RULES_VERSION, TURN_TIMEOUT_MS, applyAction, createMatch,
    passExpiredResponse, projectMatchForViewer,
    type ChronicleActionIntent, type ChronicleMatch, type ChronicleSideKey,
} from '../../../shared/chronicle-duel.js';

const ACTIONS = new Set(['normal-summon','set-monster','flip-summon','change-position','activate-magic','set-trap','activate-trap','pass-response','advance-phase','start-battle','attack','enter-main-2','enter-end-phase','end-turn','forfeit']);
const SESSION_TTL_SEC = 2 * 60 * 60;
type Session = {
    rulesVersion: typeof CHRONICLE_RULES_VERSION; warId: string; challengeId: string;
    p1Name: string; p1Clan: string; p1Deck: string[]; p2Name?: string; p2Clan?: string; p2Deck?: string[];
    state?: ChronicleMatch; status: 'awaiting-p2' | 'active' | 'done'; createdAt: number; updatedAt: number;
};
const sessionKey = (id: string) => `cw-tilecards:${id}`;
function submittedIds(value: unknown): string[] { if (!Array.isArray(value)) return []; return value.flatMap((entry) => typeof entry === 'string' ? [entry] : entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? [String((entry as { id: string }).id)] : []); }
function index(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? Math.floor(n) : undefined; }
async function resolveDeck(name: string, requested: string[], admin: boolean): Promise<string[] | null> {
    return resolveChronicleDeck(name, requested, admin);
}
function winnerResult(session: Session, challenge: { fromClan: string }): ChallengeResult {
    const winner = session.state?.winner;
    if (!winner || winner === 'draw') return 'draw';
    const clan = winner === 'p1' ? session.p1Clan : session.p2Clan;
    return clan === challenge.fromClan ? 'from-wins' : 'to-wins';
}
async function persistAndFinalize(session: Session) {
    await kv.set(sessionKey(session.challengeId), session, { ex: SESSION_TTL_SEC });
    if (session.status !== 'done' || !session.state?.winner) return;
    const warKey = `clan-war:${session.warId}`;
    const endedWar = await withKvLock(warKey, async (): Promise<ClanWar | null> => {
        const fresh = await kv.get<ClanWar>(warKey); if (!fresh) return null;
        const { war } = applyLazyClanWarExpiry(fresh); if (war.endedAt) return null;
        const challenge = war.pendingChallenges.find((item) => item.id === session.challengeId);
        if (!challenge || challenge.status !== 'accepted') return null;
        const now = Date.now(); const applied = applyFinalResult(war, challenge, winnerResult(session, challenge), now);
        await kv.set(warKey, applied.war);
        if (applied.warJustEnded) await kv.set(clanWarCooldownKey(applied.war.clans[0], applied.war.clans[1]), now, { ex: CLAN_WAR_REMATCH_COOLDOWN_SEC });
        return applied.warJustEnded ? applied.war : null;
    });
    if (endedWar) await awardWarEndClanXp(endedWar).catch((error) => console.error('[clan/war/tilecards] clan-xp award failed', error));
}
function advanceTimeout(session: Session, now: number): boolean {
    if (!session.state || session.state.status !== 'active') return false;
    const originalState = session.state; let state = originalState;
    if (state.responseWindow && state.responseWindow.expiresAt <= now) { const passed = passExpiredResponse(state, now); if (passed.ok) state = passed.state; }
    if (!state.responseWindow && state.turnStartedAt + TURN_TIMEOUT_MS <= now) {
        const actor = state.activePlayer;
        for (let safety = 0; safety < 5 && state.activePlayer === actor; safety++) {
            const timeoutAction: ChronicleActionIntent = state.phase === 'draw' || state.phase === 'standby' ? { action: 'advance-phase' } : state.phase === 'battle' ? { action: 'enter-main-2' } : state.phase === 'main1' || state.phase === 'main2' ? { action: 'enter-end-phase' } : { action: 'end-turn' };
            const advanced = applyAction(state, actor, timeoutAction, now); if (!advanced.ok) break; state = advanced.state;
        }
    }
    if (state === originalState) return false;
    session.state = state; session.status = state.status === 'complete' ? 'done' : 'active'; session.updatedAt = now; return true;
}
function actionIntent(body: Record<string, unknown>, action: string): ChronicleActionIntent { return { action, handIndex:index(body.handIndex),zoneIndex:index(body.zoneIndex),tributeZoneIndexes:Array.isArray(body.tributeZoneIndexes)?body.tributeZoneIndexes.map(index).filter((n):n is number=>n!==undefined):undefined,attackerZoneIndex:index(body.attackerZoneIndex),targetZoneIndex:body.targetZoneIndex===null?null:index(body.targetZoneIndex),targetSide:body.targetSide==='p1'||body.targetSide==='p2'?body.targetSide:undefined,graveyardIndex:index(body.graveyardIndex),...(body.position==='attack'||body.position==='defense'?{position:body.position}:{})}; }

/** Clan-war Chronicle Duel. The shared rules engine computes the only result accepted by war settlement. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    const identity = await authedPlayerOrAdmin(req); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req,res,'cw-tilecards',150,60_000,identity.name))) return;
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '').toLowerCase(); const warId = String(body.warId ?? '').trim(); const challengeId = String(body.challengeId ?? '').trim();
        if (!warId || !challengeId) return res.status(400).json({ error: 'Missing warId or challengeId.' });
        const context = await loadClanContext(identity.admin ? '' : identity.name); const me = identity.admin ? safeName(String(body.playerName ?? '')) : (context.name || identity.name);
        const result = await withKvLock(sessionKey(challengeId), async () => {
            let session = await kv.get<Session>(sessionKey(challengeId)); const now = Date.now();
            if (session && session.rulesVersion !== CHRONICLE_RULES_VERSION) return { status:409 as const,body:{error:'This duel used retired rules; start a new duel.'} };
            const autoAdvanced = session ? advanceTimeout(session, now) : false;
            const viewer: ChronicleSideKey | null = session ? safeName(session.p1Name)===safeName(me)?'p1':session.p2Name&&safeName(session.p2Name)===safeName(me)?'p2':null : null;
            if (action === 'state') { if (!session) return {status:404 as const,body:{error:'No duel session yet.'}}; if (!viewer && !identity.admin) return {status:403 as const,body:{error:'Only duelists may inspect this duel.'}}; if (autoAdvanced) await persistAndFinalize(session); const side = viewer ?? 'p1'; return {status:200 as const,body:{session:session.state?projectMatchForViewer(session.state,side):{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:side}}}; }
            if (action === 'join' || action === 'submit-deck') {
                const war = await kv.get<ClanWar>(`clan-war:${warId}`); if (!war) return {status:404 as const,body:{error:'War not found.'}};
                const challenge = war.pendingChallenges.find((item)=>item.id===challengeId); if (!challenge) return {status:404 as const,body:{error:'Challenge not found.'}};
                if (challenge.mode !== 'tilecards' || challenge.status !== 'accepted') return {status:409 as const,body:{error:'The card challenge is not active.'}};
                const lower=me.toLowerCase(); const from=(challenge.fromPlayer??'').toLowerCase()===lower||(challenge.fromPlayer2??'').toLowerCase()===lower; const to=(challenge.acceptedPlayer??'').toLowerCase()===lower||(challenge.acceptedPlayer2??'').toLowerCase()===lower;
                if (!identity.admin && !from && !to) return {status:403 as const,body:{error:'Only an accepted participant can join.'}};
                const clan=from?challenge.fromClan:(war.clans.find((item)=>item!==challenge.fromClan)??''); const deck=await resolveDeck(me,submittedIds(body.deck??body.defaultDeck),identity.admin); if(!deck)return{status:400 as const,body:{error:'No legal 40-card Chronicle deck is available.'}};
                if(!session){session={rulesVersion:CHRONICLE_RULES_VERSION,warId,challengeId,p1Name:me,p1Clan:clan,p1Deck:deck,status:'awaiting-p2',createdAt:now,updatedAt:now};await kv.set(sessionKey(challengeId),session,{ex:SESSION_TTL_SEC});return{status:200 as const,body:{session:{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:'p1'}}};}
                if(safeName(session.p1Name)===safeName(me)||session.p2Name&&safeName(session.p2Name)===safeName(me)){const side=safeName(session.p1Name)===safeName(me)?'p1':'p2';return{status:200 as const,body:{session:session.state?projectMatchForViewer(session.state,side):{rulesVersion:CHRONICLE_RULES_VERSION,status:session.status,viewerSide:side}}};}
                if(session.status!=='awaiting-p2'||session.p1Clan===clan)return{status:403 as const,body:{error:'The opposing seat is unavailable.'}};
                session.p2Name=me;session.p2Clan=clan;session.p2Deck=deck;session.state=createMatch(session.p1Name,session.p1Deck,me,deck,Math.random,now);session.status='active';session.updatedAt=now;await kv.set(sessionKey(challengeId),session,{ex:SESSION_TTL_SEC});return{status:200 as const,body:{session:projectMatchForViewer(session.state,'p2')}};
            }
            if(!session||!session.state)return{status:404 as const,body:{error:'No active duel session.'}}; const side=viewer??(identity.admin?(body.side==='p2'?'p2':'p1'):null); if(!side)return{status:403 as const,body:{error:'Only the two duelists can act.'}};
            if(!ACTIONS.has(action))return{status:400 as const,body:{error:`Unknown action: ${action}`}}; const applied=applyAction(session.state,side,actionIntent(body,action),now);if(!applied.ok)return{status:400 as const,body:{error:applied.error}};
            session.state=applied.state;session.status=applied.state.status==='complete'?'done':'active';session.updatedAt=now;await persistAndFinalize(session);return{status:200 as const,body:{session:projectMatchForViewer(session.state,side)}};
        },{failClosed:true}); return res.status(result.status).json(result.body);
    } catch(error){console.error('[clan/war/tilecards]',error);return res.status(500).json({error:'Internal server error.'});}
}
