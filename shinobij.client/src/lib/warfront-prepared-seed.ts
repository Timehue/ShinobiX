import type { WfDoctrine } from "./pet-warfront-sim";

// v4 invalidates both the old raw-seed grant and the later exact-doctrine tell.
// A prepared contract may reveal only a two-doctrine read and public warband
// identity before the player commits their setup.
export const PREPARED_WARFRONT_SEED_KEY = "wfPreparedContract.v4";

const normalizedPlayerName = (playerName: string): string => playerName.trim().toLowerCase();

export const preparedWarfrontStorageKey = (playerName: string): string | null => {
    const player = normalizedPlayerName(playerName);
    return player ? `${PREPARED_WARFRONT_SEED_KEY}:${player}` : null;
};

type ScoutedDoctrine = Extract<WfDoctrine, "vanguard" | "bulwark" | "zealot">;
export type ScoutedWarband = {
    version: 1;
    id: "siege" | "sustain" | "ambush";
    name: string;
    style: string;
};

export type PreparedWarfrontContract = {
    prepareToken: string;
    scoutedDoctrineOptions: readonly [ScoutedDoctrine, ScoutedDoctrine];
    scoutedWarband: ScoutedWarband;
    preparedAt: number;
};

const SCOUTED_DOCTRINES = new Set<ScoutedDoctrine>(["vanguard", "bulwark", "zealot"]);
const SCOUTED_WARBANDS = new Set<ScoutedWarband["id"]>(["siege", "sustain", "ambush"]);

function boundedText(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text && text.length <= max ? text : null;
}

export function parsePreparedWarfrontContract(value: unknown): PreparedWarfrontContract | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const contract = value as Partial<PreparedWarfrontContract>;
    const preparedAt = Number(contract.preparedAt);
    if (typeof contract.prepareToken !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(contract.prepareToken)) return null;
    if (!Array.isArray(contract.scoutedDoctrineOptions) || contract.scoutedDoctrineOptions.length !== 2) return null;
    const [first, second] = contract.scoutedDoctrineOptions;
    if (!SCOUTED_DOCTRINES.has(first as ScoutedDoctrine) || !SCOUTED_DOCTRINES.has(second as ScoutedDoctrine) || first === second) return null;
    if (!contract.scoutedWarband || typeof contract.scoutedWarband !== "object" || Array.isArray(contract.scoutedWarband)) return null;
    const version = contract.scoutedWarband.version;
    const id = contract.scoutedWarband.id;
    const name = boundedText(contract.scoutedWarband.name, 64);
    const style = boundedText(contract.scoutedWarband.style, 240);
    if (version !== 1 || !SCOUTED_WARBANDS.has(id as ScoutedWarband["id"]) || !name || !style) return null;
    if (!Number.isFinite(preparedAt) || preparedAt <= 0) return null;
    return {
        prepareToken: contract.prepareToken,
        scoutedDoctrineOptions: [first as ScoutedDoctrine, second as ScoutedDoctrine],
        scoutedWarband: { version: 1, id: id as ScoutedWarband["id"], name, style },
        preparedAt,
    };
}

export function readPreparedWarfrontContract(playerName: string): PreparedWarfrontContract | null {
    try {
        // v4 was originally unscoped. It cannot be safely attributed after an
        // account switch, so discard it and let the server issue a fresh grant.
        localStorage.removeItem(PREPARED_WARFRONT_SEED_KEY);
        const key = preparedWarfrontStorageKey(playerName);
        if (!key) return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const contract = parsePreparedWarfrontContract(JSON.parse(raw));
        if (!contract) localStorage.removeItem(key);
        return contract;
    } catch {
        return null;
    }
}

export function writePreparedWarfrontContract(playerName: string, contract: PreparedWarfrontContract): void {
    try {
        localStorage.removeItem(PREPARED_WARFRONT_SEED_KEY);
        const key = preparedWarfrontStorageKey(playerName);
        if (key) localStorage.setItem(key, JSON.stringify(contract));
    } catch { /* storage disabled */ }
}

export function clearPreparedWarfrontContract(playerName: string, prepareToken: string): void {
    try {
        localStorage.removeItem(PREPARED_WARFRONT_SEED_KEY);
        const key = preparedWarfrontStorageKey(playerName);
        if (!key) return;
        const current = readPreparedWarfrontContract(playerName);
        if (!current || current.prepareToken === prepareToken) localStorage.removeItem(key);
    } catch { /* storage disabled */ }
}
