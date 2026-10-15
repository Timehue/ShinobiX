import type { CampaignWarRow } from './_village-war-campaign.js';
import { eligibleShrineRoomVillage, shrineRoomPlayers } from './_village-war-shrine-presence.js';
import { advanceCampaign, shrineTimeLeader, shrineRules, SHRINE_ROOM_PRESENCE_TTL_MS, type CampaignObjective } from '../shared/village-war-campaign.js';
import { OFFLINE_AFTER_MS, subscribeBeforeOnlinePresenceMutation, subscribeAfterOnlinePresenceMutation } from './_realtime/online-store.js';

type Occupant = { name: string; village: string; expiresAt: number };
type Window = { war: CampaignWarRow; objective: CampaignObjective; at: number; occupants: Occupant[];
    totals: Record<string, number>; participants: NonNullable<CampaignObjective['controlParticipantMs']>; timer?: ReturnType<typeof setTimeout> };
const windows = new Map<string, Window>();
const key = (war: CampaignWarRow, objective: CampaignObjective) => `${war.id}:g${war.declarationGeneration}:${objective.id}:${objective.closesAt}`;
let observing = false;

/** Integrate the previous server-verified roster, splitting exactly at lease expiry. */
function accrue(entry: Window, now: number): void {
    const end = Math.min(now, entry.objective.closesAt);
    if (end <= entry.at) return;
    const boundaries = [...new Set([entry.at, end, ...entry.occupants.map(p => p.expiresAt).filter(at => at > entry.at && at < end)])].sort((a, b) => a - b);
    for (let i = 1; i < boundaries.length; i++) {
        const start = boundaries[i - 1], elapsed = boundaries[i] - start;
        const players = entry.occupants.filter(p => p.expiresAt > start);
        if (new Set(players.map(p => p.village)).size !== 1) continue;
        const village = players[0].village;
        entry.totals[village] = (entry.totals[village] ?? 0) + elapsed;
        for (const player of players) {
            const previous = Object.hasOwn(entry.participants, player.name) ? entry.participants[player.name] : undefined;
            entry.participants = { ...entry.participants, [player.name]: { village, ms: (previous?.village === village ? previous.ms : 0) + elapsed } };
        }
    }
    entry.at = end;
}
function refresh(entry: Window, now: number): void {
    entry.occupants = now >= entry.objective.closesAt ? [] : shrineRoomPlayers(entry.war, entry.objective.sector, now).flatMap(({ player, seenAt }) => {
        const village = eligibleShrineRoomVillage(player.name);
        return village && entry.war.villages.includes(village) ? [{ name: player.name, village,
            expiresAt: Math.min(entry.objective.closesAt, player.lastSeenAt + OFFLINE_AFTER_MS,
                player.inBattle ? Infinity : seenAt + SHRINE_ROOM_PRESENCE_TTL_MS) }] : [];
    });
}
function observe(after: boolean): void {
    if (observing) return;
    observing = true;
    try { const now = Date.now(); for (const entry of windows.values()) {
        accrue(entry, now);
        if (after) refresh(entry, now);
    } } finally { observing = false; }
}
subscribeBeforeOnlinePresenceMutation(() => observe(false));
subscribeAfterOnlinePresenceMutation(() => observe(true));

/** Copy measured totals into the locked row, then attribute the same bonus once. */
export function applyShrineClosingControl(war: CampaignWarRow, now: number): void {
    for (const objective of war.campaign?.shrine ?? []) {
        if (objective.bonusSettled || objective.controlCapturedAt === objective.closesAt) continue;
        const entry = windows.get(key(war, objective));
        if (entry) {
            accrue(entry, now);
            objective.controlTimeMs = { ...entry.totals };
            objective.controlParticipantMs = structuredClone(entry.participants);
        }
        if (now < objective.closesAt) continue;
        // Persisted checkpoints survive restarts. Never extrapolate an unverified
        // gap or replace accumulated time with the roster at the deadline.
        objective.controlCapturedAt = objective.closesAt;
        objective.closingControlVillage = shrineTimeLeader(objective) ?? null;
        const winner = objective.closingControlVillage;
        const players = Object.entries(objective.controlParticipantMs ?? {}).filter(([, p]) => p.village === winner && p.ms > 0);
        const total = players.reduce((sum, [, p]) => sum + p.ms, 0);
        if (!winner || !total) continue;
        const bonus = shrineRules(war.campaign!).controlBonus;
        const shares = players.map(([name, p]) => ({ name, points: Math.floor(bonus * p.ms / total), fraction: bonus * p.ms % total }))
            .sort((a, b) => b.fraction - a.fraction || a.name.localeCompare(b.name));
        let remainder = bonus - shares.reduce((sum, p) => sum + p.points, 0);
        war.contributions ??= {};
        for (const player of shares) {
            const points = player.points + (remainder-- > 0 ? 1 : 0);
            if (!points) continue;
            const prior: NonNullable<CampaignWarRow['contributions']>[string] | undefined = Object.hasOwn(war.contributions, player.name) ? war.contributions[player.name] : undefined;
            const contribution: NonNullable<CampaignWarRow['contributions']>[string] = prior?.side === winner ? { ...prior } : { damage: 0, raids: 0, pvpKills: 0, side: winner, name: player.name };
            contribution.damage += points;
            war.contributions = { ...war.contributions, [player.name]: contribution };
        }
    }
}

/** Checkpoint every five seconds and at closing; no client poll is required. */
function arm(entry: Window): void {
    const now = Date.now();
    if (now >= entry.objective.closesAt) return;
    entry.timer = setTimeout(() => {
        delete entry.timer;
        const at = Date.now();
        observe(false); observe(true);
        void import('./_village-war-campaign.js').then(({ mutateCampaignWar }) => mutateCampaignWar(entry.war.id, async current => {
            if (!current.endedAt && current.declarationGeneration === entry.war.declarationGeneration) {
                applyShrineClosingControl(current, at);
                advanceCampaign(current.campaign!, at);
                current.updatedAt = at;
            }
            return { row: current, value: undefined };
        })).catch(error => console.warn('[village-war] shrine time publication deferred:', (error as Error)?.message ?? error))
            .finally(() => { if (windows.get(key(entry.war, entry.objective)) === entry) arm(entry); });
    }, Math.min(5000, entry.objective.closesAt - now));
    entry.timer.unref?.();
}
export function scheduleShrineClosing(war: CampaignWarRow, objective: CampaignObjective): void {
    const id = key(war, objective);
    if (windows.has(id) || war.endedAt || Date.now() >= objective.closesAt) return;
    const entry: Window = { war, objective, at: Math.max(Date.now(), objective.opensAt), occupants: [],
        totals: { ...objective.controlTimeMs }, participants: structuredClone(objective.controlParticipantMs ?? {}) };
    windows.set(id, entry);
    refresh(entry, Date.now()); arm(entry);
    for (const [prior, state] of windows) if (Date.now() - state.objective.closesAt > 14 * 86_400_000) windows.delete(prior);
}
export function resetShrineClosingTimersForTests(): void {
    for (const entry of windows.values()) if (entry.timer) clearTimeout(entry.timer);
    windows.clear();
}
