import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { consumeSingleUseToken } from '../_single-use-token.js';
import { pvpSessionMayGrantProgress, sealedWorldRaidAttacker, type PvpSession } from '../pvp/session.js';
import {
    raidProgressionSettlement,
    settleRaidProgressionWithDailyCap,
    type RaidProgressionSettlement,
} from './_raid-progression.js';
import type { SealedRaidTerritoryEvidence } from './_raid-territory.js';

const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RAID_REPORTS_PER_DAY = 60;

function progressionBody(
    settlement: RaidProgressionSettlement,
    character: Record<string, unknown>,
    saveVersion: number,
    replayed: boolean,
) {
    return {
        ok: true,
        vanguard: character.profession === 'vanguard',
        alreadyReported: replayed,
        xpAwarded: settlement.xpAwarded,
        missionsCompleted: settlement.missionsCompleted,
        bonusRyo: settlement.bonusRyo,
        bonusSeals: settlement.bonusSeals,
        fetchMissionsCredited: settlement.fetchMissionsCredited,
        territoryDamage: settlement.territoryDamage,
        sector: settlement.sector,
        character,
        _saveVersion: saveVersion,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'report-raid', 6, 60_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const battleId = typeof body.battleId === 'string' && body.battleId.trim()
            ? body.battleId.trim().slice(0, 160)
            : '';
        const raidTokenRaw = typeof body.raidToken === 'string' ? body.raidToken.trim().slice(0, 96) : '';
        const raidToken = /^[A-Za-z0-9]+$/.test(raidTokenRaw) ? raidTokenRaw : '';
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (raidTokenRaw && !raidToken) return res.status(400).json({ error: 'Invalid raid token.' });
        if (battleId && raidToken) return res.status(400).json({ error: 'Use exactly one raid proof.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own raids.' });
        }
        if (!battleId && !raidToken) {
            return res.status(200).json({
                ok: true,
                vanguard: true,
                reason: 'missing-raid-proof',
                xpAwarded: 0,
                missionsCompleted: [],
                bonusRyo: 0,
                bonusSeals: 0,
            });
        }

        let proofId = '';
        let proofAt = 0;
        let sector = 0;
        let territoryEvidence: SealedRaidTerritoryEvidence | undefined;
        let legacyTokenKey = '';
        if (raidToken) {
            legacyTokenKey = `raid-token:${playerName}:${raidToken}`;
            const token = await kv.get<{
                playerName?: string;
                authorityVersion?: number;
                mintedAt?: number;
                sector?: number;
            }>(legacyTokenKey);
            if (token?.authorityVersion === 2) {
                return res.status(409).json({
                    error: 'This AI raid settles through its sealed AI-fight session.',
                    reason: 'ai-fight-owned-raid-token',
                });
            }
            proofId = `legacy-ai-raid:${raidToken}`;
            if (!token) {
                const replayRecord = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const replayCharacter = replayRecord?.character as Record<string, unknown> | undefined;
                const replay = raidProgressionSettlement(replayCharacter, proofId);
                if (replay && replayCharacter) {
                    return res.status(200).json(progressionBody(
                        replay,
                        replayCharacter,
                        Number(replayRecord?._saveVersion ?? 0),
                        true,
                    ));
                }
                return res.status(200).json({ ok: true, vanguard: true, reason: 'invalid-or-spent-token' });
            }
            if (safeName(String(token.playerName ?? '')) !== playerName) {
                return res.status(403).json({ error: 'Raid token does not belong to this player.' });
            }
            proofAt = Math.floor(Number(token.mintedAt));
            sector = Math.floor(Number(token.sector));
        } else {
            const session = await kv.get<PvpSession>(`pvp:${battleId}`);
            if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
            if (session.status !== 'done' || !session.winner) {
                return res.status(409).json({ error: 'Battle not yet decided.' });
            }
            if (!pvpSessionMayGrantProgress(session) || session.rewardAuthority !== 'world') {
                return res.status(409).json({ error: 'This battle is not an authorized world raid.' });
            }
            const sessionAge = Date.now() - Number(session.createdAt ?? 0);
            if (sessionAge < 0 || sessionAge > SESSION_REPLAY_WINDOW_MS) {
                return res.status(409).json({ error: 'Battle session is too old to report.' });
            }
            const winnerName = session.winner === 'p1' ? session.p1.name : session.winner === 'p2' ? session.p2.name : '';
            if (safeName(winnerName) !== playerName) {
                return res.status(403).json({ error: 'You are not the winner of this battle.' });
            }
            const attacker = sealedWorldRaidAttacker(session);
            if (!attacker || session.winner !== attacker.side || attacker.name !== playerName) {
                return res.status(409).json({ error: 'Only the sealed raid attacker can report raid progression.' });
            }
            proofId = `pvp-raid:${battleId}`;
            proofAt = Math.floor(Number(session.endedAt));
            sector = Math.floor(Number(session.rewardSector));
            territoryEvidence = session.worldTerritoryEvidence;
        }

        if (!Number.isSafeInteger(proofAt) || proofAt <= 0
            || !Number.isSafeInteger(sector) || sector < 1 || sector > 66) {
            return res.status(409).json({ error: 'The sealed raid proof has no valid world sector.' });
        }
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!record || !character) return res.status(404).json({ error: 'Player save not found.' });

        const progression = await settleRaidProgressionWithDailyCap({
            playerName,
            proofId,
            proofAt,
            sector,
            dailyLimit: MAX_RAID_REPORTS_PER_DAY,
            ...(territoryEvidence ? { territoryEvidence } : {}),
        });
        if (legacyTokenKey) await consumeSingleUseToken(kv, legacyTokenKey);
        if (progression.capped) {
            return res.status(200).json({
                ok: true,
                vanguard: progression.character.profession === 'vanguard',
                reason: 'daily-raid-cap',
                alreadyReported: progression.replayed,
                xpAwarded: 0,
                missionsCompleted: [],
                bonusRyo: 0,
                bonusSeals: 0,
                fetchMissionsCredited: progression.fetchMissionsCredited,
                territoryDamage: progression.territoryDamage,
                sector,
                character: progression.character,
                _saveVersion: progression._saveVersion,
            });
        }
        if (!progression.settlement) throw new Error('raid-progression-settlement-missing');
        return res.status(200).json(progressionBody(
            progression.settlement,
            progression.character,
            progression._saveVersion,
            progression.replayed,
        ));
    } catch (error) {
        console.error('[missions/report-raid]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
