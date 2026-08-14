import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { FLOOR_CATALOG, type TowerFloor } from './_floor-catalog.js';

/*
 * GET /api/towers/floors — the public floor-catalog metadata for the lobby picker.
 *
 * Display-only fields (no enemy stats). First-clear rewards and authored tactical
 * warnings are intentionally public so the lobby can tell the truth about what a
 * player is choosing; settlement still resolves all values from the server catalog.
 */
export function publicTowerFloorMeta(f: TowerFloor) {
    const reward = f.firstClearReward;
    return {
        id: f.id,
        name: f.name,
        chapter: f.chapter ?? 1,
        chapterTitle: f.chapterTitle ?? 'The Celestial Ascent',
        ...(f.chapterSubtitle ? { chapterSubtitle: f.chapterSubtitle } : {}),
        ...(f.chapterSummary ? { chapterSummary: f.chapterSummary } : {}),
        ...(f.artKey ? { artKey: f.artKey } : {}),
        ...(f.briefing ? {
            briefing: {
                situation: f.briefing.situation,
                tactics: [...f.briefing.tactics],
                warnings: [...f.briefing.warnings],
            },
        } : {}),
        biome: f.biome,
        objective: f.objective,
        roundBudget: f.roundBudget,
        isBoss: !!f.boss,
        bossMechanic: f.boss?.mechanic ?? null,
        bossTargetMode: f.boss?.targetMode ?? null,
        bossStrike: f.boss?.strike ? {
            kind: f.boss.strike.kind,
            everyRounds: f.boss.strike.everyRounds,
            firstRound: f.boss.strike.firstRound ?? f.boss.strike.everyRounds,
            radius: f.boss.strike.radius,
        } : null,
        closingRing: f.closingRing ? {
            fromRound: f.closingRing.fromRound,
            minRadius: f.closingRing.minRadius,
            percent: f.closingRing.pct,
        } : null,
        dynamicHazards: (f.dynamicHazards ?? []).map(hazard => ({
            kind: hazard.kind,
            everyRounds: hazard.everyRounds,
            firstRound: hazard.firstRound ?? hazard.everyRounds,
            count: hazard.count,
        })),
        milestone: reward.milestone ?? null,
        fieldRule: f.fieldRule.kind === 'none' ? null : { ...f.fieldRule },
        enemyCount: f.enemies.reduce((sum, pod) => sum + pod.count, 0) + (f.boss ? 1 : 0),
        phaseReinforcementCount: f.boss?.mechanic === 'summon'
            ? Math.max(0, Math.floor(Number(f.boss.summonCount ?? 2))) * (f.boss.phases?.length ?? 0)
            : 0,
        reinforcementWaves: [...new Set(f.enemies
            .map(pod => Math.max(1, Math.floor(Number(pod.spawnRound ?? 1))))
            .filter(round => round > 1))].sort((a, b) => a - b),
        firstClearReward: {
            ryo: Math.max(0, Math.floor(Number(reward.ryo ?? 0))),
            statPoints: Math.max(0, Math.round(Number(reward.xp ?? 0) / 40)),
            fateShards: Math.max(0, Math.floor(Number(reward.fateShards ?? 0))),
            boneCharms: Math.max(0, Math.floor(Number(reward.boneCharms ?? 0))),
            milestone: reward.milestone ?? null,
        },
        map: { width: f.map.width, height: f.map.height },
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({
        floors: FLOOR_CATALOG.map(publicTowerFloorMeta),
    });
}
