import type { ClanWarCampaignView } from "../../../shared/clan-war-campaign";
import {clanWarViewerCache as viewerCache} from './clan-war-cache-state';
import {retryDynamicImport} from './lazyWithRetry';

export const sharedClanWarCache: Record<string, CwWar> = viewerCache.cache;
export type ClanShrineRoomView={serverNow:number;players:Array<{name:string;displayName:string;clan:string;tile:number;inBattle:boolean}>};
export type ClanWarQueueActionInput={warId:string;action:string;mode?:string;scope?:'normal'|'shrine';windowIndex?:number;partnerEntryId?:string;matchId?:string;tile?:number};
const changedViewerError='The signed-in player changed. Reopen the clan page.';

// Listing remains on the startup graph; paid and battle actions load on use.
// Capture the caller before loading so a delayed chunk cannot switch actors.
async function loadClanWarActions() {
    const viewer = viewerCache.scope();
    const actions=await retryDynamicImport(()=>import('./clan-war-actions')).catch(()=>{
        throw new Error('Clan war actions could not load. Reload the page and try again.');
    });
    if(!viewerCache.current(viewer))throw new Error(changedViewerError);
    return {actions,viewer};
}

export async function cwQueueAction(body:ClanWarQueueActionInput): Promise<{ok:boolean;error?:string;war?:CwWar;serverNow?:number;shrinePlayers?:string[];room?:ClanShrineRoomView}> {
    try {
        const {actions,viewer}=await loadClanWarActions();
        return actions.cwQueueAction(body,viewer);
    } catch(error) { return {ok:false,error:String((error as Error).message)}; }
}

export type CwChallengeMode = "pvp1v1" | "pvp2v2" | "pet1v1" | "pet2v2" | "tilecards";
type CwChallengeStatus = "queuing" | "pending" | "accepted" | "completed" | "expired" | "cancelled";
export type CwChallengeResult = "from-wins" | "to-wins" | "draw";
export type CwChallenge = {
    id: string;
    campaignMatchId?: string;
    mode: CwChallengeMode;
    fromClan: string;
    fromPlayer: string;
    fromPlayer2?: string;
    createdAt: number;
    status: CwChallengeStatus;
    expiresAt: number;
    acceptedAt?: number;
    acceptedPlayer?: string;
    acceptedPlayer2?: string;
    completedAt?: number;
    result?: CwChallengeResult;
    battleId?: string;
    petBattleSeed?: number;
    // Two-phase reporting: first reporter stamps a tentative result;
    // the opposing side has 15 min to confirm or dispute. After the
    // window, any participant re-calling report auto-confirms.
    tentativeResult?: CwChallengeResult;
    tentativeBy?: string;
    tentativeAt?: number;
};
export type CwWar = {
    id: string;
    campaignView?: ClanWarCampaignView;
    clans: [string, string];
    villages: Record<string, string>;
    hp: Record<string, number>;
    hpMax?: Record<string, number>; // per-clan starting pool (base + War Room bonus)
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    winnerClan?: string;
    declaredBy: string;
    pendingChallenges: CwChallenge[];
    completedChallenges: CwChallenge[];
    warCrateId?: string;
    mvpByClan?: Record<string, string>;
    // Village Stores clan mirror — stamped by the daily pass
    // (api/_village-stores-daily.ts runClanStoresDailyPass) once per UTC day:
    // `storesDate` is that day, `storesFed[clan]` is whether the clan's
    // treasury covered its 30 rations. Both are absent until the first pass
    // runs on a war, so read them through clanWarFedToday() in ./clan-stores,
    // which refuses to present a missing or stale stamp as "unfed".
    storesDate?: string;
    storesFed?: Record<string, boolean>;
};
// CW_HP_MAX / CW_DAMAGE / CW_MODE_LABEL / CW_MODE_ICON moved to ./constants/clan.

// Coalesce concurrent callers. Three pollers (App-level 30s + ClanWarsPanel 20s
// + ClanBattlesTab 15s, the latter two on separate screens) can overlap; without
// this each fires its own uncached origin fetch of the full war list. While a
// request is in flight, additional callers share it and receive identical data —
// behavior-identical to firing simultaneously, with no added staleness (the
// in-flight handle is cleared the moment it settles, so the next call is fresh).
export async function cwListWars(): Promise<CwWar[]> {
    const viewer = viewerCache.scope();
    try {
        const list=await retryDynamicImport(()=>import('./clan-war-list'));
        return viewerCache.current(viewer)?list.listClanWars(viewer):[];
    }catch{return [];}
}
// The Honor Seal cost carries a retained requestId (lib/economy-request-intent):
// declaring again after a lost answer finishes or replays the first
// declaration instead of charging a second time.
export async function cwDeclareWar(toClan: string, declarerName: string,funding:'personal'|'pool'='personal'): Promise<{ ok: boolean; error?: string; war?: CwWar }> {
    try {
        const {actions}=await loadClanWarActions();
        return actions.cwDeclareWar(toClan,declarerName,funding);
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
export async function cwChallengeAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; war?: CwWar; challenge?: CwChallenge }> {
    try {
        const {actions}=await loadClanWarActions();
        return actions.cwChallengeAction(body);
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
