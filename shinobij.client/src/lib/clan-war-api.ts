import { economyIntentSettled, pendingEconomyIntent } from "./economy-request-intent";
import type { ClanWarCampaignView } from "../../../shared/clan-war-campaign";
import { getSocketAuth } from '../authFetch';
import { createClanWarViewerCache } from './clan-war-viewer-cache';

const viewerCache = createClanWarViewerCache<CwWar>(() => getSocketAuth().name);
export const sharedClanWarCache: Record<string, CwWar> = viewerCache.cache;
export type ClanShrineRoomView={serverNow:number;players:Array<{name:string;displayName:string;clan:string;tile:number;inBattle:boolean}>};
export async function cwQueueAction(body: {warId:string;action:string;mode?:string;scope?:'normal'|'shrine';windowIndex?:number;partnerEntryId?:string;matchId?:string;tile?:number}): Promise<{ok:boolean;error?:string;war?:CwWar;serverNow?:number;shrinePlayers?:string[];room?:ClanShrineRoomView}> {
    const viewer = viewerCache.scope();
    try {
        const response = await fetch('/api/clan/war/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json().catch(()=>({}));
        if (!response.ok) return {ok:false,error:data.error??'The queue could not update. Try again.'};
        if (!viewerCache.current(viewer)) return {ok:false,error:'The signed-in player changed. Reopen the clan page.'};
        if (data.war) data.war = viewerCache.accept(data.war,viewer);
        return {ok:true,...data};
    } catch { return {ok:false,error:'Connection lost. Your last confirmed war state is preserved. Try again.'}; }
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
let _cwListInFlight: {viewer:number;promise:Promise<CwWar[]>} | null = null;
export async function cwListWars(): Promise<CwWar[]> {
    const viewer = viewerCache.scope();
    if (_cwListInFlight?.viewer === viewer) return _cwListInFlight.promise;
    const promise = (async () => {
        try {
            const r = await fetch("/api/clan/war/list");
            if (!r.ok) return [];
            const data = await r.json() as { wars?: CwWar[] };
            const wars = data.wars ?? [];
            // Populate the shared cache so the war-reward sweep can scan
            // ended clan wars for unclaimed rewards on next render.
            if (!viewerCache.current(viewer)) return [];
            return wars.map(w=>viewerCache.accept(w,viewer)!);
        } catch { return []; }
    })();
    _cwListInFlight = {viewer,promise};
    try { return await promise; }
    finally { if (_cwListInFlight?.promise === promise) _cwListInFlight = null; }
}
// The Honor Seal cost carries a retained requestId (lib/economy-request-intent):
// declaring again after a lost answer finishes or replays the first
// declaration instead of charging a second time.
export async function cwDeclareWar(toClan: string, declarerName: string,funding:'personal'|'pool'='personal'): Promise<{ ok: boolean; error?: string; war?: CwWar }> {
    const intent = pendingEconomyIntent("clan-war-declare", [declarerName.trim().toLowerCase(), toClan.trim().toLowerCase(),...(funding==='pool'?[funding]:[])]);
    try {
        const res = await fetch("/api/clan/war/declare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toClan, requestId: intent.requestId,funding }),
        });
        const data = await res.json().catch(() => ({}));
        if (economyIntentSettled(res.status, data)) intent.complete();
        if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        return { ok: true, war: data.war };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
export async function cwChallengeAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; war?: CwWar; challenge?: CwChallenge }> {
    try {
        const r = await fetch("/api/clan/war/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { ok: false, error: data.error ?? `HTTP ${r.status}` };
        return { ok: true, war: data.war, challenge: data.challenge };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
