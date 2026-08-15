import { dungeonWardenWasDefeated } from './_ai-fight.js';
import { dungeonCardWasWon, dungeonPetWasWon } from './_encounter-proof.js';

export const DUNGEON_KEY_ID = 'dungeon-key';
export const DUNGEON_RELIC_ID = 'dungeon-legendary-relic';
export const DUNGEON_MIN_RUN_MS = 30_000;
export const FREE_DUNGEON_LEVEL = 50;
export const FREE_DUNGEON_CHANCE = 0.02;
export const FREE_DUNGEON_DAILY_PROBE_LIMIT = 150;

export type FreeDungeonProbeReceipt = {
    requestId: string;
    day: string;
    sector: number;
    found: boolean;
    token: string;
    at: number;
    resolvedAt?: number;
};

export function cleanDungeonProbeRequestId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9_-]{8,96}$/.test(id) ? id : '';
}

function probeReceipts(character: Record<string, unknown>): FreeDungeonProbeReceipt[] {
    if (!Array.isArray(character.serverFreeDungeonProbeReceipts)) return [];
    return (character.serverFreeDungeonProbeReceipts as unknown[]).filter((entry): entry is FreeDungeonProbeReceipt => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const value = entry as Partial<FreeDungeonProbeReceipt>;
        return !!cleanDungeonProbeRequestId(value.requestId)
            && typeof value.day === 'string'
            && Number.isSafeInteger(value.sector)
            && Number(value.sector) >= 1
            && Number(value.sector) <= 66
            && typeof value.found === 'boolean'
            && typeof value.token === 'string'
            && Number.isFinite(value.at);
    }).slice(-179);
}

export function freeDungeonProbeReceipt(
    character: Record<string, unknown>,
    requestIdRaw: unknown,
): FreeDungeonProbeReceipt | null {
    const requestId = cleanDungeonProbeRequestId(requestIdRaw);
    return requestId ? probeReceipts(character).find((entry) => entry.requestId === requestId) ?? null : null;
}

export function unresolvedFreeDungeonMiss(character: Record<string, unknown>): FreeDungeonProbeReceipt | null {
    return [...probeReceipts(character)].reverse().find((entry) => !entry.found && !entry.resolvedAt) ?? null;
}

export function resolveFreeDungeonMiss(
    character: Record<string, unknown>,
    requestIdRaw: unknown,
    now = Date.now(),
): Record<string, unknown> {
    const requestId = cleanDungeonProbeRequestId(requestIdRaw);
    if (!requestId) return character;
    let changed = false;
    const next = probeReceipts(character).map((entry) => {
        if (entry.requestId !== requestId || entry.found || entry.resolvedAt) return entry;
        changed = true;
        return { ...entry, resolvedAt: now };
    });
    return changed ? { ...character, serverFreeDungeonProbeReceipts: next } : character;
}

function removeOne(character: Record<string, unknown>, itemId: string) {
    let removed = false;
    const inventory = (Array.isArray(character.inventory) ? character.inventory : []).filter((id) => {
        if (!removed && id === itemId) { removed = true; return false; }
        return true;
    });
    const itemStacks = (Array.isArray(character.itemStacks) ? character.itemStacks : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const row = raw as Record<string, unknown>; const id = String(row.itemId ?? ''); const count = Math.max(0, Math.floor(Number(row.count) || 0));
        if (!id || count <= 0) return [];
        if (!removed && id === itemId) { removed = true; return count > 1 ? [{ itemId: id, count: count - 1 }] : []; }
        return [{ itemId: id, count }];
    });
    return removed ? { inventory, itemStacks } : null;
}

export function mutateDungeonRun(
    character: Record<string, unknown>,
    actionRaw: unknown,
    tokenRaw: unknown,
    issuedToken: string,
    now = Date.now(),
    randomValue = Math.random(),
    sectorRaw?: unknown,
    requestIdRaw?: unknown,
) {
    const action = typeof actionRaw === 'string' ? actionRaw : '';
    const token = typeof tokenRaw === 'string' ? tokenRaw.slice(0, 80) : '';
    const active = character.activeDungeonRun && typeof character.activeDungeonRun === 'object' ? character.activeDungeonRun as Record<string, unknown> : null;
    const receipts = Array.isArray(character.redeemedDungeonRuns) ? (character.redeemedDungeonRuns as unknown[]).filter((id): id is string => typeof id === 'string').slice(-63) : [];
    if (action === 'probe-free') {
        const requestId = cleanDungeonProbeRequestId(requestIdRaw);
        if (!requestId) return { ok: false as const, reason: 'dungeon-probe-request-required' as const };
        if (Math.max(1, Math.floor(Number(character.level) || 1)) < FREE_DUNGEON_LEVEL) {
            return { ok: false as const, reason: 'dungeon-level-required' as const };
        }
        const prior = freeDungeonProbeReceipt(character, requestId);
        if (prior) {
            if (active?.token && !(active.entry === 'free' && active.token === prior.token)) {
                return { ok: false as const, reason: 'active-dungeon-conflict' as const };
            }
            const priorActive = active?.entry === 'free' && active.token === prior.token;
            return {
                ok: true as const,
                alreadyApplied: true,
                found: prior.found,
                token: prior.token,
                requestId,
                resolved: Boolean(prior.resolvedAt),
                character: prior.found && !prior.resolvedAt && !priorActive && !active
                    ? { ...character, activeDungeonRun: {
                        token: prior.token,
                        startedAt: prior.at,
                        entry: 'free',
                        sector: prior.sector,
                        probeRequestId: requestId,
                    } }
                    : character,
            };
        }
        const pendingMiss = unresolvedFreeDungeonMiss(character);
        if (pendingMiss) {
            return {
                ok: true as const,
                alreadyApplied: true,
                found: false,
                token: '',
                requestId: pendingMiss.requestId,
                sector: pendingMiss.sector,
                character,
            };
        }
        if (active?.token) {
            if (active.entry !== 'free') return { ok: false as const, reason: 'active-dungeon-conflict' as const };
            return {
                ok: true as const,
                alreadyApplied: true,
                found: true,
                token: String(active.token),
                requestId: typeof active.probeRequestId === 'string' ? active.probeRequestId : requestId,
                character,
            };
        }
        const requestedSector = Math.floor(Number(sectorRaw));
        if (!Number.isSafeInteger(requestedSector) || requestedSector < 1 || requestedSector > 66) {
            return { ok: false as const, reason: 'invalid-dungeon-sector' as const };
        }
        const today = new Date(now).toISOString().slice(0, 10);
        const storedDate = typeof character.serverFreeDungeonProbeDate === 'string' ? character.serverFreeDungeonProbeDate : '';
        const probes = storedDate === today ? Math.max(0, Math.floor(Number(character.serverFreeDungeonProbesToday) || 0)) : 0;
        const explored = character.serverExploreDate === today
            ? Math.max(0, Math.floor(Number(character.serverExploresToday) || 0))
            : 0;
        // One server roll may lead the corresponding explore settlement by one
        // request. This binds probing to actual daily exploration while still
        // letting the client know which outcome to render before it settles the
        // tile as full/no-outcome or tile/other-outcome.
        if (probes >= FREE_DUNGEON_DAILY_PROBE_LIMIT || probes > explored) {
            return { ok: false as const, reason: 'dungeon-probe-not-earned' as const };
        }
        const probed: Record<string, unknown> = {
            ...character,
            serverFreeDungeonProbeDate: today,
            serverFreeDungeonProbesToday: probes + 1,
        };
        const sector = requestedSector;
        const found = Number.isFinite(randomValue) && randomValue >= 0 && randomValue < FREE_DUNGEON_CHANCE;
        const receipt: FreeDungeonProbeReceipt = {
            requestId,
            day: today,
            sector,
            found,
            token: found ? issuedToken : '',
            at: now,
        };
        const withReceipt: Record<string, unknown> = {
            ...probed,
            serverFreeDungeonProbeReceipts: [...probeReceipts(character), receipt],
        };
        if (!found) {
            return { ok: true as const, alreadyApplied: false, found: false, token: '', requestId, character: withReceipt };
        }
        return {
            ok: true as const,
            alreadyApplied: false,
            found: true,
            token: issuedToken,
            requestId,
            character: {
                ...withReceipt,
                activeDungeonRun: {
                    token: issuedToken,
                    startedAt: now,
                    entry: 'free',
                    sector: Math.floor(Number(sectorRaw)),
                    probeRequestId: requestId,
                },
            },
        };
    }
    if (action === 'start') {
        if (active?.token) return { ok: true as const, alreadyApplied: true, token: String(active.token), character };
        const removed = removeOne(character, DUNGEON_KEY_ID);
        if (!removed) return { ok: false as const, reason: 'dungeon-key-required' as const };
        return { ok: true as const, alreadyApplied: false, token: issuedToken, character: { ...character, ...removed, activeDungeonRun: { token: issuedToken, startedAt: now, entry: 'key' } } };
    }
    if (receipts.includes(token)) return { ok: true as const, alreadyApplied: true, token, character };
    if (!active || !token || String(active.token) !== token) return { ok: false as const, reason: 'invalid-dungeon-run' as const };
    if (action === 'abandon') return { ok: true as const, alreadyApplied: false, token, character: {
        ...character,
        activeDungeonRun: null,
        serverFreeDungeonProbeReceipts: probeReceipts(character).map((entry) => entry.token === token ? { ...entry, resolvedAt: now } : entry),
    } };
    if (action !== 'settle') return { ok: false as const, reason: 'invalid-dungeon-action' as const };
    if (!dungeonWardenWasDefeated(active)) return { ok: false as const, reason: 'dungeon-warden-proof-required' as const };
    if (!dungeonCardWasWon(active)) return { ok: false as const, reason: 'dungeon-card-proof-required' as const };
    if (!dungeonPetWasWon(active)) return { ok: false as const, reason: 'dungeon-pet-proof-required' as const };
    if (now - Math.max(0, Number(active.startedAt) || 0) < DUNGEON_MIN_RUN_MS) return { ok: false as const, reason: 'dungeon-run-too-short' as const };
    const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
    inventory.push(DUNGEON_RELIC_ID);
    return { ok: true as const, alreadyApplied: false, token, character: {
        ...character, activeDungeonRun: null, redeemedDungeonRuns: [...receipts, token], inventory,
        serverFreeDungeonProbeReceipts: probeReceipts(character).map((entry) => entry.token === token ? { ...entry, resolvedAt: now } : entry),
        boneCharms: Math.max(0, Math.floor(Number(character.boneCharms) || 0)) + 10,
        auraStones: Math.max(0, Math.floor(Number(character.auraStones) || 0)) + 5,
        fateShards: Math.max(0, Math.floor(Number(character.fateShards) || 0)) + 5,
        totalPetWins: Math.max(0, Math.floor(Number(character.totalPetWins) || 0)) + 1,
    } };
}
