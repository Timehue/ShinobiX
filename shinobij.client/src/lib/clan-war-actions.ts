import {economyIntentSettled,pendingEconomyIntent} from './economy-request-intent';
import {clanWarViewerCache as viewerCache} from './clan-war-cache-state';
import type {ClanWarQueueActionInput,ClanShrineRoomView,CwWar,CwChallenge} from './clan-war-api';

export async function cwQueueAction(body:ClanWarQueueActionInput,viewer:number):Promise<{ok:boolean;error?:string;war?:CwWar;serverNow?:number;shrinePlayers?:string[];room?:ClanShrineRoomView}> {
    try {
        const response = await fetch('/api/clan/war/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json().catch(()=>({}));
        if (!response.ok) return {ok:false,error:data.error??'The queue could not update. Try again.'};
        if (!viewerCache.current(viewer)) return {ok:false,error:'The signed-in player changed. Reopen the clan page.'};
        if (data.war) data.war = viewerCache.accept(data.war,viewer);
        return {ok:true,...data};
    } catch { return {ok:false,error:'Connection lost. Your last confirmed war state is preserved. Try again.'}; }
}

// Retain the paid intent until the same declaration is authoritatively settled.
export async function cwDeclareWar(toClan:string,declarerName:string,funding:'personal'|'pool'):Promise<{ok:boolean;error?:string;war?:CwWar}> {
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

export async function cwChallengeAction(body:Record<string,unknown>):Promise<{ok:boolean;error?:string;war?:CwWar;challenge?:CwChallenge}> {
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
