import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    WEEKLY_CLAIMABLE_CATALOG,
    pickWeeklyBoardForPlayer,
    weekKey,
    weekEndsAt,
    computeProgress,
    snapshotCounters,
    type WeeklyMission,
} from './_weekly-board.js';
import { canPlayerClaimMission, missionEligibilityFailureBody } from './_eligibility.js';

const RECORD_PREFIX = 'weekly-board:';
const RECORD_TTL_SECONDS = 16 * 24 * 60 * 60;

type WeeklyRecord = { baseline: Record<string, number>; claimed: string[] };

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
    const villageState = village ? await kv.get<Record<string, unknown>>(villageStateKey(village)).catch(() => null) : null;
    const hollowGateUntil = Number(villageState?.hollowGateUnlockedUntil ?? 0);
    return {
        systems: {
            hollowGate: hollowGateUntil > now,
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
            const eligibilityContext = await missionEligibilityContextFor(char, now);
            const board = pickWeeklyBoardForPlayer(wk, char, undefined, eligibilityContext);
            let record = await kv.get<WeeklyRecord>(key);
            if (!record) {
                const fresh: WeeklyRecord = { baseline: snapshotCounters(char), claimed: [] };
                const placed = await kv.set(key, fresh, { nx: true, ex: RECORD_TTL_SECONDS } as never);
                record = placed ? fresh : (await kv.get<WeeklyRecord>(key)) ?? fresh;
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
        const requestedCatalogMission = WEEKLY_CLAIMABLE_CATALOG.find((m) => m.id === missionId);
        if (!requestedCatalogMission) return res.status(400).json({ error: 'That mission is not on this week\'s board.' });

        const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(`save:${playerName}`, async () => {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? null) as Record<string, unknown> | null;
            if (!save || !char) return { status: 404, body: { error: 'Your save was not found.' } };

            const eligibilityContext = await missionEligibilityContextFor(char, now);
            const board = pickWeeklyBoardForPlayer(wk, char, undefined, eligibilityContext);
            const mission: WeeklyMission | undefined = board.find((m) => m.id === missionId);
            if (!mission) {
                const check = canPlayerClaimMission(char, requestedCatalogMission, eligibilityContext);
                if (!check.ok) return { status: 403, body: missionEligibilityFailureBody(check) };
                return { status: 400, body: { error: 'That mission is not on this week\'s board.' } };
            }
            const claimEligibility = canPlayerClaimMission(char, mission, eligibilityContext);
            if (!claimEligibility.ok) return { status: 403, body: missionEligibilityFailureBody(claimEligibility) };

            let record = await kv.get<WeeklyRecord>(key);
            if (!record) record = { baseline: snapshotCounters(char), claimed: [] };
            if (record.claimed.includes(mission.id)) {
                return { status: 200, body: {
                    ok: true,
                    alreadyClaimed: true,
                    balances: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) },
                    _saveVersion: Number(save._saveVersion ?? 0),
                } };
            }
            const progress = computeProgress(mission, record.baseline, char);
            if (progress < mission.target) {
                return { status: 400, body: { error: 'That mission is not complete yet.', progress, target: mission.target } };
            }

            const r = mission.reward;
            const nextChar: Record<string, unknown> = {
                ...char,
                ryo: num(char.ryo) + (r.ryo ?? 0),
                fateShards: num(char.fateShards) + (r.fateShards ?? 0),
                boneCharms: num(char.boneCharms) + (r.boneCharms ?? 0),
            };
            const nextRecord: WeeklyRecord = { baseline: record.baseline, claimed: [...record.claimed, mission.id] };
            await kv.set(key, nextRecord, { ex: RECORD_TTL_SECONDS } as never);
            const updatedSave = bumpSaveVersion({ ...save, character: nextChar });
            await kv.set(`save:${playerName}`, mergePreservingImages(updatedSave, save));
            return { status: 200, body: {
                ok: true,
                reward: r,
                missionId: mission.id,
                balances: { ryo: num(nextChar.ryo), fateShards: num(nextChar.fateShards), boneCharms: num(nextChar.boneCharms) },
                _saveVersion: Number((updatedSave as Record<string, unknown>)._saveVersion ?? 0),
            } };
        }, { failClosed: true });

        if (out.status === 200 && out.body.ok && !out.body.alreadyClaimed) {
            await kv.set(`audit:weekly-board:${now}`, { ts: now, player: playerName, wk, missionId: out.body.missionId, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[missions/weekly-board]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
