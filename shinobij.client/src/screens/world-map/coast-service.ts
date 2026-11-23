import type { HallStyle } from "../../../../shared/coast-hall-style";
import { useEffect, useState } from "react";
import type { Character } from "../../types/character";
import type { WeatherType } from "../../types/core";

export type Patrol = { id: string; name: string; model: string; level: number; tile: number; beast: boolean; beaten: boolean };
export type Patrols = { sector: number; patrols: Patrol[] };
export type CoastLand = {
    sector: number; name: string;
    /** The weather over the sector now. `fixed` is true when its holder chose it; otherwise the coast's schedule did. */
    sky?: { weather: WeatherType; fixed: boolean };
    /** `terrainBuffStat` is the school the holder favours there: its members hit 10% harder with it on that ground. */
    holder: { clan: string; since: number; immuneUntil: number; hallStyle?: HallStyle; terrainBuffStat?: string; weather?: WeatherType } | null;
    contest: { id: string; clan: string; phase: string; opensAt: number; closesAt: number; score: number; target: number; roster: number;
        defender?: { clan: string; score: number; roster: number } } | null;
};
export type Land = { sectors: CoastLand[]; paused?: boolean; rules?: { declareScrolls?: number } };
export type LandingWork = {
    id: string; name: string; does: string; quest: string; needsTier: string; cost: Record<string, number>;
    built: boolean; canBuild: boolean; needsQuest?: boolean; block: "built" | "tier" | "stores" | "dormant" | null;
};
export type Landing = {
    rules: { materials: string[]; materialNames?: Record<string, string>; perContribution: number };
    clan: string | null; officer?: boolean; canFound: boolean; holds?: { sector: number; name: string; supply?: number } | null;
    fallen?: { sector: number; at: number; reason: string } | null;
    landing: { hallStyle?: HallStyle; sector: number; status: string; tier: number; name: string; stores: Record<string, number>;
        next: { name: string; cost: Record<string, number>; ready: boolean } | null;
        upkeep: { perWeek: number; dormantWeeks: number; graceUntil: number };
        works?: LandingWork[]; thisWeek: Record<string, number>; yours: { used: number; cap: number } } | null;
};
export type Mutation = { character?: Character; _saveVersion?: number };
type Service = "patrols" | "land" | "landing";
export class CoastError extends Error {
    readonly status: number;
    constructor(message: string, status = 0) { super(message); this.status = status; }
}

// Same-origin requests are signed by the installed authFetch interceptor.
export async function coastPost<T>(service: Service, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch("/api/coast/" + service, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true) throw new CoastError(data?.error || "The coast record could not be read. Try again.", response.status);
    return data as T;
}
export function coastMessage(error: unknown) {
    return error instanceof CoastError ? error.message : "Could not reach the coast. Try again.";
}
export function useCoastRead<T>(service: Service, revision: number, scope = "active") {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState("");
    const [completed, setCompleted] = useState<{ scope: string; revision: number } | null>(null);
    useEffect(() => {
        if (!scope) return;
        const controller = new AbortController();
        coastPost<T>(service, service === "patrols" ? {} : { action: "status" }, controller.signal).then(value => {
            if (!controller.signal.aborted) { setData(value); setError(""); setCompleted({ scope, revision }); }
        }).catch(reason => { if (!controller.signal.aborted) { setData(null); setError(coastMessage(reason)); setCompleted({ scope, revision }); } });
        return () => controller.abort();
    }, [service, revision, scope]);
    const current = completed?.scope === scope;
    return { data: current ? data : null, error: current ? error : "", pending: !current || completed.revision !== revision };
}

export function useCoastGround(scope: string) {
    const [revision, revise] = useState(() => Date.now());
    const lands = useCoastRead<Land>("land", revision, scope);
    const base = useCoastRead<Landing>("landing", revision, scope);
    return { lands, base, revision, reload: () => revise(value => Math.max(value + 1, Date.now())) };
}

