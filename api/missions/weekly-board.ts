import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, SAVE_VERSION_CONFLICT_REPLY } from '../save/_projected-write.js';
import {
    weeklyMissionById,
    resolveWeeklyBoardForRecord,
    WEEKLY_BOARD_SIZE,
    weekKey,
    weekEndsAt,
    computeProgress,
    snapshotCounters,
    type WeeklyMission,
} from './_weekly-board.js';
import { canPlayerClaimMission, missionEligibilityFailureBody } from './_eligibility.js';
import { rankedLevelEligible } from '../../shared/ranked-eligibility.js';
import { readPetRankedSeasonGateFresh } from '../pet/_ranked-preparation.js';
import { rankedSeasonAdmissionsPaused, SEASON_CURRENT_KEY, type RankedSeason } from '../cron/_ranked-season.js';

const RECORD_PREFIX = 'weekly-board:';
const RECORD_TTL_SECONDS = 16 * 24 * 60 * 60;

type WeeklyRecord = { baseline: Record<string, number>; claimed: string[]; missionIds?: string[] };

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function recordKey(slug: string, wk: string): string {
    return `${RECORD_PREFIX}${slug}:${wk}`;
}

function villageStateKey(village: unknown): string {
    return `game:village-state:${String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

async function missionEligibilityContextFor(char: Record<string, unknown>, now: number) {
    const village = String(char.village ?? '');
    const rankedAvailable = rankedLevelEligible(char.level) ? (async () => {
        const [gate, season] = await Promise.all([
            readPetRankedSeasonGateFresh(kv), kv.get<RankedSeason>(SEASON_CURRENT_KEY),
        ]);
        return Boolean(gate && gate.state === 'open' && gate.seasonId === Number(season?.id)
            && !await rankedSeasonAdmissionsPaused(kv, gate.seasonId));
    })() : Promise.resolve(false);
    // A failed availability read must not persist replacement assignments.
    // Preserve unfinished work and let the player retry the board refresh.
    const [villageState, ranked] = await Promise.all([
        village ? kv.get<Record<string, unknown>>(villageStateKey(village)) : null,
        rankedAvailable,
    ]);
    const hollowGateUntil = Number(villageState?.hollowGateUnlockedUntil ?? 0);
    return {
        systems: {
            hollowGate: hollowGateUntil > now,
            ranked,
        },
        now,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(isGet ? (req.query.playerName ?? '') : ((body as Record<string, unknown>).playerName ?? '')));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }

        const now = Date.now();
        const wk = weekKey(now);
        const key = recordKey(playerName, wk);

        if (isGet) {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? {}) as Record<string, unknown>;
            // The record read overlaps the village-state read. It still starts
            // after the save read, as before, so it sees nothing older than the
            // save it scores, and it is awaited where it used to run, so a
            // failure surfaces at the same point.
            const recordRead = kv.get<WeeklyRecord>(key);
            recordRead.catch(() => undefined);
            const eligibilityContext = await missionEligibilityContextFor(char, now);
            let record = await recordRead;
            if (!record) {
                const fresh: WeeklyRecord = { baseline: snapshotCounters(char), claimed: [] };
                fresh.missionIds = resolveWeeklyBoardForRecord(wk, char, fresh, eligibilityContext).map((mission) => mission.id);
                const placed = await kv.set(key, fresh, { nx: true, ex: RECORD_TTL_SECONDS } as never);
                record = placed ? fresh : (await kv.get<WeeklyRecord>(key)) ?? fresh;
            }
            const counters = snapshotCounters(char);
            const missingCounters = Object.keys(counters).filter((counter) => record!.baseline[counter] === undefined);
            const updated: WeeklyRecord = { ...record, baseline: { ...record.baseline } };
            for (const counter of missingCounters) updated.baseline[counter] = counters[counter as keyof typeof counters];
            const board = resolveWeeklyBoardForRecord(wk, char, updated, eligibilityContext);
            updated.missionIds = board.map((mission) => mission.id);
            const assignmentsChanged = !Array.isArray(record.missionIds)
                || record.missionIds.join('\n') !== updated.missionIds.join('\n');
            if (missingCounters.length > 0 || assignmentsChanged) {
                // Preserve concurrent claims when adding activity baselines to
                // a board that was first opened before this catalog update.
                if (!await kv.compareSet(key, record, updated, { ex: RECORD_TTL_SECONDS })) {
                    return res.status(503).json(SAVE_VERSION_CONFLICT_REPLY);
                }
                record = updated;
            }
            const missions = board.map((m) => {
                const progress = Math.min(m.target, computeProgress(m, record!.baseline, char));
                return { ...m, progress, complete: progress >= m.target, claimed: record!.claimed.includes(m.id) };
            });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ weekKey: wk, endsAt: weekEndsAt(now), missions });
        }

        if (req.method !== 'POST') return res.status(405).end();
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'weekly-board-claim', 30, 60_000, identity.name))) return;

        const missionId = typeof (body as Record<string, unknown>).missionId === 'string'
            ? (body as Record<string, unknown>).missionId as string
            : '';
        const requestedCatalogMission = weeklyMissionById(wk, missionId);
        if (!requestedCatalogMission) return res.status(400).json({ error: 'That mission is not on this week\'s board.' });

        type Reply = { status: number; body: Record<string, unknown> };
        const answer = (character: Record<string, unknown>, value: Reply) => ({ ok: true as const, write: false, character, value });
        let committed: Awaited<ReturnType<typeof mutatePlayerSave<Reply>>>;
        try {
            committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
                const eligibilityContext = await missionEligibilityContextFor(char, now);
                let record = await kv.get<WeeklyRecord>(key);
                if (!record) record = { baseline: snapshotCounters(char), claimed: [] };
                const board = resolveWeeklyBoardForRecord(wk, char, record, eligibilityContext);
                const mission: WeeklyMission | undefined = board.find((m) => m.id === missionId);
                if (!mission) {
                    const check = canPlayerClaimMission(char, requestedCatalogMission, eligibilityContext);
                    if (!check.ok) return answer(char, { status: 403, body: missionEligibilityFailureBody(check) });
                    return answer(char, { status: 400, body: { error: 'That mission is not on this week\'s board.' } });
                }
                if (record.claimed.includes(mission.id)) {
                    return answer(char, { status: 200, body: {
                        ok: true,
                        alreadyClaimed: true,
                        balances: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) },
                    } });
                }
                const progress = computeProgress(mission, record.baseline, char);
                // An assigned objective already completed from server-owned
                // counters stays earned through a season pause or gate expiry.
                const earnedAssignment = record.missionIds?.includes(mission.id) && progress >= mission.target;
                const claimEligibility = canPlayerClaimMission(char, mission, eligibilityContext);
                if (!earnedAssignment && !claimEligibility.ok) return answer(char, { status: 403, body: missionEligibilityFailureBody(claimEligibility) });
                if (record.claimed.length >= WEEKLY_BOARD_SIZE) {
                    return answer(char, { status: 400, body: { error: 'All four weekly rewards have already been claimed.' } });
                }
                if (progress < mission.target) {
                    return answer(char, { status: 400, body: { error: 'That mission is not complete yet.', progress, target: mission.target } });
                }

                const r = mission.reward;
                const nextChar: Record<string, unknown> = {
                    ...char,
                    ryo: num(char.ryo) + (r.ryo ?? 0),
                    fateShards: num(char.fateShards) + (r.fateShards ?? 0),
                    boneCharms: num(char.boneCharms) + (r.boneCharms ?? 0),
                };
                // Claim, save and currency ledger commit in one transaction.
                // A failed write cannot strand a claim, and a baseline upgrade
                // racing this claim refuses the whole write without a payout.
                const nextRecord: WeeklyRecord = { ...record, missionIds: board.map((m) => m.id), claimed: [...record.claimed, mission.id] };
                return {
                    ok: true,
                    character: nextChar,
                    atomicProof: { key, expected: record, value: nextRecord, ex: RECORD_TTL_SECONDS },
                    value: { status: 200, body: {
                        ok: true,
                        reward: r,
                        missionId: mission.id,
                        balances: { ryo: num(nextChar.ryo), fateShards: num(nextChar.fateShards), boneCharms: num(nextChar.boneCharms) },
                    } },
                };
            });
        } catch (error) {
            if (isPlayerSaveVersionConflict(error)) return res.status(503).json(SAVE_VERSION_CONFLICT_REPLY);
            throw error;
        }
        if (!committed.ok) {
            if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
            return res.status(committed.status).json({ error: committed.error });
        }
        const out = committed.value;
        if (out.status === 200) out.body._saveVersion = committed._saveVersion;

        if (out.status === 200 && out.body.ok && !out.body.alreadyClaimed) {
            await kv.set(`audit:weekly-board:${now}`, { ts: now, player: playerName, wk, missionId: out.body.missionId, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[missions/weekly-board]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
