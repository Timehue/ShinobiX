/**
 * Sector Contracts client — the day's posted work.
 *
 * WHICH sectors are posted and what they ask is pure and deterministic in
 * `shared/sector-contracts.ts`, so the world map can mark the whole board with
 * no request at all. Only this player's PROGRESS and whether they have been
 * paid live on the server, because those are the parts a client could lie
 * about — so those are the only two things this module fetches.
 *
 * Auth headers are injected globally by authFetch, same as the other sector
 * endpoints, so plain `fetch` is correct here.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { contractAcceptsWorkAt, parseSectorContract, sectorContractFor, utcDayOf, type SectorContract } from "../../../shared/sector-contracts";
import { serverNow } from "./server-clock";

export type SectorContractStatus = {
    contract: SectorContract | null;
    progress: number;
    claimed: boolean;
    claimable: boolean;
    /** Would work landing right now count? False on a night contract in daylight. */
    acceptingWork: boolean;
};

export const NO_SECTOR_CONTRACT: SectorContractStatus =
    Object.freeze({ contract: null, progress: 0, claimed: false, claimable: false, acceptingWork: false });

/*
 * The board is computed locally, which is what makes marking ~67 map markers
 * free — but it also means the client would happily keep marking contracts after
 * DISABLE_SECTOR_CONTRACTS turned them off server-side, because nothing local
 * knows. The route answers 404 when the switch is set, so the first such answer
 * latches here and the whole surface goes quiet: no marks, no cards, no fetches.
 *
 * The window is one request wide (markers stay until something asks the server
 * once), and it self-heals rather than needing a reload. Deliberately one-way
 * for the session: a switch thrown mid-incident should not flicker back on.
 */
let serverDisabled = false;

/** Today's contract for a sector, computed locally — no request, no waiting. */
export function localSectorContract(sector: number, now: number = Date.now()): SectorContract | null {
    if (serverDisabled) return null;
    return sectorContractFor(sector, utcDayOf(now));
}

/** Does this sector carry work today? Used to mark the world-map board. */
export function sectorHasContract(sector: number, now: number = Date.now()): boolean {
    return localSectorContract(sector, now) !== null;
}

/** Test hook. */
export function __resetSectorContractFeatureState(): void {
    serverDisabled = false;
}

function cleanStatus(data: unknown): SectorContractStatus {
    const raw = data && typeof data === "object" ? data as Record<string, unknown> : {};
    // PARSE, do not cast. The card multiplies by `target` and calls
    // `.toLocaleString()` on `ryo`, so a half-formed contract would throw during
    // render and take the sector panel with it.
    const contract = parseSectorContract(raw.contract);
    if (!contract) return NO_SECTOR_CONTRACT;
    return {
        contract,
        progress: Math.max(0, Math.floor(Number(raw.progress) || 0)),
        claimed: raw.claimed === true,
        claimable: raw.claimable === true,
        // Recomputed locally rather than trusted from the payload: the answer
        // goes stale the moment the world crosses into or out of night, and the
        // card is on screen for longer than that boundary is far away. Uses the
        // SERVER clock (lib/server-clock), so it matches the gate the server
        // actually enforces even on a device whose own clock is wrong.
        acceptingWork: contractAcceptsWorkAt(contract, serverNow()),
    };
}

/** This player's standing on a sector's contract. Null means "ask again later". */
export async function fetchSectorContract(playerName: string, sector: number): Promise<SectorContractStatus | null> {
    try {
        const params = new URLSearchParams({ playerName, sector: String(sector) });
        const res = await fetch(`/api/sector/contract?${params}`, { method: "GET" });
        // 404 is the kill switch answering, not an error: the feature is off.
        // Latch it so the map stops marking a board the server will not honour.
        if (res.status === 404) {
            serverDisabled = true;
            bumpSectorContractRevision();
            return NO_SECTOR_CONTRACT;
        }
        if (!res.ok) return null;
        return cleanStatus(await res.json());
    } catch {
        return null;
    }
}

export type SectorContractClaim =
    | { ok: true; ryo: number; totalRyo: number; saveVersion?: number }
    | { ok: false; message: string };

const CLAIM_REFUSALS: Record<string, string> = {
    "no-contract": "There is no contract posted here today.",
    "already-claimed": "You have already been paid for this contract.",
    incomplete: "The work isn't finished yet.",
};

export async function claimSectorContract(playerName: string, sector: number): Promise<SectorContractClaim> {
    try {
        const res = await fetch("/api/sector/contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, sector }),
        });
        const data = await res.json() as {
            ok?: boolean; reason?: string; error?: string;
            ryo?: number; totalRyo?: number; _saveVersion?: number;
        };
        if (data.ok && typeof data.totalRyo === "number" && typeof data.ryo === "number") {
            return { ok: true, ryo: data.ryo, totalRyo: data.totalRyo, saveVersion: data._saveVersion };
        }
        const reason = typeof data.reason === "string" ? data.reason : "";
        return { ok: false, message: CLAIM_REFUSALS[reason] ?? data.error ?? "The contract could not be settled." };
    } catch {
        return { ok: false, message: "Couldn't reach the contract board." };
    }
}

/* ── Live status for the selected sector ─────────────────────────────────── */

/*
 * A tiny external store rather than a prop chain: the explore response is
 * handled deep inside WorldMap, and the contract card is rendered from the
 * command panel, so threading a revision between them would mean a new prop on
 * every layer in between. `bumpSectorContractRevision()` is one call at the
 * explore site; the hook below re-reads on it. Same shape as the village-intel
 * cache revision this file sits beside.
 */
let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

const readRevision = () => revision;

/** Call after anything that could have moved contract progress (an explore). */
export function bumpSectorContractRevision(): void {
    revision += 1;
    for (const listener of listeners) listener();
}

/**
 * This player's contract standing on the selected sector, refreshed when the
 * sector changes and after every explore.
 *
 * Unposted sectors never reach the network: `sectorHasContract` is a pure local
 * computation over the same shared module the server uses, and on any given day
 * only SECTOR_CONTRACT_SLOTS of the ~66 wild sectors carry work — so selecting
 * a sector normally costs nothing at all.
 */
export function useSectorContract(sector: number | null, playerName: string): SectorContractStatus | null {
    const rev = useSyncExternalStore(subscribe, readRevision, readRevision);
    // Stamped WITH the sector it describes. Clearing it from the effect instead
    // would be a synchronous setState in an effect body (a cascading render, and
    // a lint error); stamping means a status can simply never be read against
    // the wrong sector, including in the frame before the refetch lands.
    const [answer, setAnswer] = useState<{ sector: number; status: SectorContractStatus } | null>(null);
    useEffect(() => {
        void rev;
        if (sector == null || !playerName || !sectorHasContract(sector)) return;
        let alive = true;
        void fetchSectorContract(playerName, sector).then((next) => {
            if (alive && next) setAnswer({ sector, status: next });
        });
        return () => { alive = false; };
    }, [sector, playerName, rev]);
    if (sector == null || !sectorHasContract(sector)) return null;
    return answer && answer.sector === sector ? answer.status : null;
}
