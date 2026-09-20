import type { VercelRequest, VercelResponse } from './_vercel.js';
import { isFullAdmin } from './_auth.js';
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { isWarSector, isWarVillage } from './_war-map-sectors.js';
import { defaultVillageWarRecord, villageWarKey, type WinCondition } from './_war-state.js';
import { bumpSaveVersion } from './save/_save-version.js';
import {
    GARRISON_UNLOCK_IDLE_MS,
    newSectorWarSession,
    projectSectorWarForClient,
    sectorWarKey,
    type SectorWarSession,
} from './_sector-war.js';

/**
 * Deterministic setup for the built-Express player-journey suite.
 *
 * This handler is mounted only when NODE_ENV=test and the disposable in-memory
 * store are both enabled (server-api-routes.ts), and it repeats those checks on
 * every request. Production therefore has no route to this code. The journey
 * still uses the real sector-war, sector-pet, war-map and world-map handlers;
 * this only creates the world state that would otherwise take days of live WR
 * accrual and a second village's leadership election to arrange.
 */
export function sectorWarQaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV === 'test' && env.SHINOBIX_QA_MEMORY_KV === '1';
}

function villageSlug(village: string): string {
    return village.toLowerCase().replace(/\s+/g, '-');
}

function validWinCondition(value: unknown): value is WinCondition {
    return value === 'combat' || value === 'card' || value === 'pet';
}

function publicContest(contest: SectorWarSession) {
    return projectSectorWarForClient(contest);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    if (!sectorWarQaEnabled()) return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Admin only.' });

    let body: Record<string, unknown>;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}; }
    catch { return res.status(400).json({ error: 'Invalid request.' }); }
    const action = String(body.action ?? '');

    if (action === 'seed') {
        const sector = Math.floor(Number(body.sector));
        const attackerVillage = String(body.attackerVillage ?? '').trim();
        const defenderVillage = String(body.defenderVillage ?? '').trim();
        const attackerName = safeName(String(body.attackerName ?? ''));
        const defenderName = safeName(String(body.defenderName ?? ''));
        const winCondition = body.winCondition;
        if (!isWarSector(sector) || !isWarVillage(attackerVillage) || !isWarVillage(defenderVillage)
            || attackerVillage === defenderVillage || !attackerName || !defenderName || !validWinCondition(winCondition)) {
            return res.status(400).json({ error: 'Invalid sector-war fixture.' });
        }

        const [attackerSave, defenderSave] = await Promise.all([
            kv.get<Record<string, unknown> & { character?: { village?: string } }>(`save:${attackerName}`),
            kv.get<Record<string, unknown> & { character?: { village?: string } }>(`save:${defenderName}`),
        ]);
        if (attackerSave?.character?.village !== attackerVillage || defenderSave?.character?.village !== defenderVillage) {
            return res.status(409).json({ error: 'Fixture accounts are not members of the requested villages.' });
        }

        const now = Date.now();
        const attackerWar = defaultVillageWarRecord(attackerVillage);
        const defenderWar = defaultVillageWarRecord(defenderVillage);
        if (defenderWar.sectors[String(sector)]) {
            defenderWar.sectors[String(sector)] = {
                ...defenderWar.sectors[String(sector)],
                winCondition,
            };
        }
        const contest: SectorWarSession = {
            ...newSectorWarSession({ sector, attackerVillage, defenderVillage, winCondition, now }),
            declarationGeneration: 1,
            // Make the genuine garrison path visible immediately as a second
            // player-facing option; the normal live-player duel remains open.
            lastLiveBattleAt: now - GARRISON_UNLOCK_IDLE_MS - 1_000,
        };
        const positionedAttacker = bumpSaveVersion({ ...attackerSave,
            currentSector: sector,
            currentTile: 65,
            worldGeoV: 2,
        }, { previousCharacter: attackerSave.character });
        const positionedDefender = bumpSaveVersion({ ...defenderSave,
            currentSector: sector,
            currentTile: 66,
            worldGeoV: 2,
        }, { previousCharacter: defenderSave.character });
        await Promise.all([
            // Save position is server-owned after account creation. Put both
            // disposable players on the contested ground here instead of
            // teaching the browser journey to forge currentSector.
            kv.set(`save:${attackerName}`, positionedAttacker),
            kv.set(`save:${defenderName}`, positionedDefender),
            kv.set(villageWarKey(attackerVillage), attackerWar),
            kv.set(villageWarKey(defenderVillage), defenderWar),
            kv.set(`world:territory:${sector}`, {
                sector,
                ownerVillage: defenderVillage,
                hp: 20_000,
                updatedAt: now,
            }),
            kv.set(`village:kage:${villageSlug(defenderVillage)}`, { seatedKage: defenderName }),
            kv.set(sectorWarKey(contest.id), contest),
        ]);
        return res.status(200).json({ ok: true, contest: publicContest(contest) });
    }

    if (action === 'replace') {
        const contestId = String(body.contestId ?? '').trim();
        const previous = contestId ? await kv.get<SectorWarSession>(sectorWarKey(contestId)) : null;
        if (!previous || previous.id !== contestId) return res.status(404).json({ error: 'Contest not found.' });
        const now = Math.max(Date.now() + 1, previous.startedAt + 1);
        const replacement: SectorWarSession = {
            ...newSectorWarSession({
                sector: previous.sector,
                attackerVillage: previous.attackerVillage,
                defenderVillage: previous.defenderVillage,
                winCondition: previous.winCondition,
                now,
            }),
            declarationGeneration: Math.max(1, Math.floor(Number(previous.declarationGeneration) || 0) + 1),
            lastLiveBattleAt: now,
        };
        await kv.set(sectorWarKey(contestId), replacement);
        return res.status(200).json({ ok: true, contest: publicContest(replacement) });
    }

    return res.status(400).json({ error: 'Unknown action.' });
}
