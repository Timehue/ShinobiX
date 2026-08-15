import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName, setSafeRecordValue } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { awardClanPointsToPlayerSave } from '../_clan-points.js';
import { readSession, settleConsumedItemsForMember, type ConsumedItemsResult } from '../towers/_tower-store.js';
import { loadAssault, saveAssault, extractAssaultResult } from './_assault.js';
import {
    bankAssault, clanBossProgressKey, loadClanBossProgress, newClanBossProgress,
    loadClanBossWeek, resolveClanBossDef, saveClanBossProgress,
} from './_storage.js';
import { projectClanBossContributions } from './_contribution.js';
import { awardOperationProfessionXp } from './_profession.js';
import { applyOperationPressure } from './_sector-state.js';
import { completeParty } from './_party.js';
import { announce } from '../_announce.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import { clanBossEnabled } from '../_release-flags.js';

/*
 * POST /api/clan-boss/assault-settle — bank a FINISHED clan-boss assault into the
 * clan's weekly pool. The result (damage/rounds/wipe/clean) is read from the
 * server-authoritative tower session — the client reports nothing. Idempotent: the
 * assault side-record's `settled` flag (checked + set under the progress lock)
 * guarantees a run banks exactly once. Gated off with a hidden 404 when disabled.
 * Body: { runId, playerName }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!clanBossEnabled()) return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId) return res.status(400).json({ error: 'Missing player or run.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle as yourself.' });

        const assault = await loadAssault(runId);
        if (!assault) return res.status(404).json({ error: 'Not a clan-boss assault.' });
        if (!identity.admin && !assault.party.includes(playerName)) {
            return res.status(403).json({ error: 'You were not in this assault.' });
        }

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'That assault has expired.' });
        if (session.status !== 'done') return res.status(400).json({ error: 'The fight is not finished yet.' });

        const result = extractAssaultResult(session);
        const contributions = projectClanBossContributions(session);
        const week = await loadClanBossWeek(assault.weekId);
        const boss = resolveClanBossDef(week);
        const now = Date.now();

        const outcome = await withKvLock(clanBossProgressKey(assault.weekId, assault.clanName), async () => {
            // Re-read the side-record inside the lock for exactly-once banking.
            const fresh = await loadAssault(runId);
            if (!fresh) return { status: 404 as const, body: { error: 'Not a clan-boss assault.' } };
            if (fresh.settled) {
                const p = await loadClanBossProgress(assault.weekId, assault.clanName);
                const applied = p?.assaults.find((entry) => entry.runId === runId);
                const justKilled = fresh.justKilled ?? (!!p?.killedAt && p.killedAt === applied?.at && p.pool <= 0);
                return { status: 200 as const, body: { ok: true, alreadySettled: true, pool: p?.pool ?? 0, poolMax: p?.poolMax ?? 0, killed: !!p?.killedAt, justKilled } };
            }
            const progress = (await loadClanBossProgress(assault.weekId, assault.clanName))
                ?? (week ? newClanBossProgress(assault.clanName, week, 1) : null);
            if (!progress) return { status: 400 as const, body: { error: 'No active clan boss to bank into.' } };

            const applied = progress.assaults.find((entry) => entry.runId === runId);
            const next = bankAssault(progress, {
                runId, by: assault.host, party: assault.party,
                damage: result.damage, rounds: result.rounds, wiped: result.wiped, clean: result.clean, at: now,
                contributions,
            });
            const justKilled = applied
                ? !!progress.killedAt && progress.killedAt === applied.at && progress.pool <= 0
                : !!next.killedAt && !progress.killedAt;
            if (next !== progress) await saveClanBossProgress(next);
            await saveAssault({ ...fresh, settled: true, justKilled });
            return {
                status: 200 as const,
                body: {
                    ok: true, alreadySettled: !!applied, result, pool: next.pool, poolMax: next.poolMax,
                    killed: !!next.killedAt, justKilled,
                },
            };
        }, { failClosed: true });

        if (outcome.status !== 200) return res.status(outcome.status).json(outcome.body);

        const consumables: Record<string, ConsumedItemsResult> = {};
        for (const a of session.actors.filter(x => x.side === 'squad')) {
            const slug = a.ownerSlug;
            if (!slug) continue;
            setSafeRecordValue(consumables, slug, await settleConsumedItemsForMember({ session, slug }));
        }

        let awardedCharacter: Record<string, unknown> | undefined;
        const outcomeBody = outcome.body as Record<string, unknown>;
        const party = [...new Set(assault.party.map((name) => safeName(name)).filter(Boolean))].slice(0, 4);
        const others = party.filter((name) => name !== playerName);
        // These awards use stable event IDs, so retry them even after damage was
        // already settled. That heals a transient player-save failure without
        // double-crediting members whose first write succeeded.
        await Promise.allSettled(others.map((member) => awardClanPointsToPlayerSave(member, 'clanBossParticipation', 60, {
            eventId: `clanBoss:${assault.weekId}:${runId}:participation:${member}`,
            runId,
            clan: assault.clanName,
            damage: result.damage,
        })));
        if (party.includes(playerName)) {
            const participation = await awardClanPointsToPlayerSave(playerName, 'clanBossParticipation', 60, {
                eventId: `clanBoss:${assault.weekId}:${runId}:participation:${playerName}`,
                runId,
                clan: assault.clanName,
                damage: result.damage,
            });
            if (participation.found) awardedCharacter = participation.character;
        }
        if (outcomeBody.justKilled) {
            await Promise.allSettled(others.map((member) => awardClanPointsToPlayerSave(member, 'clanBossDefeat', 50, {
                eventId: `clanBoss:${assault.weekId}:${runId}:defeat:${member}`,
                runId,
                clan: assault.clanName,
            })));
            if (party.includes(playerName)) {
                const defeat = await awardClanPointsToPlayerSave(playerName, 'clanBossDefeat', 50, {
                    eventId: `clanBoss:${assault.weekId}:${runId}:defeat:${playerName}`,
                    runId,
                    clan: assault.clanName,
                });
                if (defeat.found) awardedCharacter = defeat.character;
            }
        }

        const professionAwards: Record<string, { awarded: number; xp?: number; rank?: number }> = {};
        for (const member of party) {
            const contribution = contributions[member];
            if (!contribution) continue;
            const award = await awardOperationProfessionXp({ playerName: member, runId, contribution });
            setSafeRecordValue(professionAwards, member, { awarded: award.awarded, xp: award.xp, rank: award.rank });
            if (member === playerName && award.character) awardedCharacter = award.character;
        }

        const sector = boss
            ? await applyOperationPressure({ weekId: assault.weekId, boss, runId, damage: result.damage, contributions, now })
            : null;
        if (assault.partyId) await completeParty(assault.partyId, runId, now).catch(() => null);

        if (outcomeBody.justKilled && boss) {
            const gate = await kv.set(`clan-boss:announced:${assault.weekId}:${assault.clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`, '1', { nx: true, ex: 9 * 24 * 60 * 60 }).catch(() => null);
            if (gate === 'OK') {
                await announce({
                    type: 'clan_boss_defeated',
                    importance: 'high',
                    title: `${assault.clanName} broke ${boss.name}`,
                    message: `The weekly threat at ${sector?.state.sectorName ?? `Sector ${boss.sectorId}`} has been driven back.`,
                    meta: { weekId: assault.weekId, bossId: boss.id, sectorId: boss.sectorId },
                });
            }
        }

        if (sector?.crossedMilestone !== undefined && boss) {
            const milestone = sector.crossedMilestone;
            const gate = await kv.set(`clan-boss:sector-herald:${assault.weekId}:${milestone}`, '1', { nx: true, ex: 9 * 24 * 60 * 60 }).catch(() => null);
            if (gate === 'OK') {
                const secured = 100 - milestone;
                await announce({
                    type: 'clan_boss_sector_pressure',
                    importance: 'high',
                    title: `${sector.state.sectorName} is ${secured}% secured`,
                    message: milestone > 0
                        ? `Village heralds report that coordinated operations against ${boss.name} have forced the weekly threat down to ${milestone}%.`
                        : `Village heralds report that coordinated operations have fully stabilized the sector against ${boss.name} for this campaign.`,
                    meta: { weekId: assault.weekId, bossId: boss.id, sectorId: boss.sectorId, pressure: milestone },
                });
            }
        }

        const activeCount = Object.values(contributions).filter((entry) => entry.active).length;
        const strongestThreshold = Object.values(contributions).some((entry) => entry.threshold === 'elite')
            ? 'elite'
            : Object.values(contributions).some((entry) => entry.threshold === 'veteran') ? 'veteran' : activeCount > 0 ? 'field' : 'none';
        const telemetryGate = await kv.set(`clan-boss:telemetry:settle:${runId}`, '1', { nx: true, ex: 9 * 24 * 60 * 60 }).catch(() => null);
        if (telemetryGate === 'OK') {
            captureServerProductEvent('clan_boss_operation_settled', {
                partySizeBucket: String(party.length),
                resultCategory: result.won ? 'won' : result.wiped ? 'wiped' : 'timed-out',
                contributionCategory: strongestThreshold,
            });
            void recordBetaMetric({
                event: 'clan_boss.assault_settled',
                source: `party-${party.length}:${result.won ? 'won' : result.wiped ? 'wiped' : 'timeout'}:${strongestThreshold}`,
            });
        }

        // Multiple idempotent helpers may have advanced the caller's save. Echo the
        // final authoritative version/character so the next autosave cannot collide
        // with an operation reward that the client has not observed yet.
        const finalPlayerRecord = party.includes(playerName)
            ? await kv.get<Record<string, unknown>>(`save:${playerName}`)
            : null;
        const finalCharacter = finalPlayerRecord?.character as Record<string, unknown> | undefined;
        if (finalCharacter) awardedCharacter = finalCharacter;

        return res.status(outcome.status).json({
            ...(outcome.body as Record<string, unknown>),
            consumables,
            contributions,
            professionAwards,
            sectorState: sector?.state,
            sectorPressureReducedBy: sector?.reducedBy ?? 0,
            sectorPressureMilestone: sector?.crossedMilestone,
            character: awardedCharacter,
            _saveVersion: Number(finalPlayerRecord?._saveVersion) || undefined,
        });
    } catch (err) {
        console.error('[clan-boss/assault-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
