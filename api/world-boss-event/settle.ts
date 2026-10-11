import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { readSession, writeSession } from '../towers/_tower-store.js';
import { releaseTowerBattleLeases, towerBattleLeaseMembers } from '../towers/_battle-lease.js';
import { WORLD_BOSS_TOP_CACHE_SETTLEMENT_GRACE_MS, worldBossEventStatus } from '../../shared/world-boss-event.js';
import { scoreWorldBossContribution } from './_contribution.js';
import {
    readWorldBossEvent,
    readWorldBossMatch,
    worldBossEventKey,
    worldBossMatchKey,
    writeWorldBossEvent,
    writeWorldBossMatch,
    writeWorldBossPlayerPointer,
    type WorldBossContributionResult,
    type WorldBossMatchRecord,
} from './_event.js';
import { closeWorldBossQueue, removeWorldBossMatchFromQueue } from './_queue.js';
import { settleWorldBossReward } from './_reward.js';
import { applyWorldBossRetreatPenalty } from './_retreat.js';
import { rememberWorldBossTopCacheEvent, settleWorldBossTopCaches } from './_top-cache.js';
import { announceWorldBossEventTransition } from './_announcements.js';

function cleanDamage(value: unknown): number {
    const damage = Math.floor(Number(value));
    return Number.isFinite(damage) ? Math.max(0, damage) : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId) return res.status(400).json({ error: 'Missing player or world boss run.' });
        if (!enforceRateLimit(req, res, 'world-boss-event-settle-preauth', 60, 60_000)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own event match.' });
        const playerSlug = identity.admin ? playerName : identity.name;
        if (!enforceRateLimit(req, res, 'world-boss-event-settle', 12, 60_000, playerSlug)) return;

        const session = await readSession(runId);
        if (!session?.worldBossEvent || session.worldBossEvent.eventId.length < 1) return res.status(404).json({ error: 'World boss match not found.' });
        if (session.status !== 'done') return res.status(409).json({ error: 'Finish the encounter before settling event contribution.' });
        const isMember = identity.admin || session.actors.some(actor => actor.side === 'squad' && actor.ai === false && actor.ownerSlug === playerSlug);
        if (!isMember) return res.status(403).json({ error: 'Not a member of this event match.' });

        const { eventId, matchId } = session.worldBossEvent;
        let callerContribution: WorldBossContributionResult | null = null;
        let bankedDamage = 0;
        let hpRemaining = 0;
        const lockKey = worldBossMatchKey(eventId, matchId);
        const result = await withKvLock(lockKey, async () => {
            let callerReward: Awaited<ReturnType<typeof settleWorldBossReward>> = null;
            const match = await readWorldBossMatch(eventId, matchId);
            if (!match || match.runId !== runId || !match.members.some(member => member.slug === playerSlug)) return { ok: false as const, status: 404, error: 'World boss match receipt not found.' };
            if (match.status !== 'settled') {
                const freshSession = await readSession(runId);
                if (!freshSession?.worldBossEvent
                    || freshSession.worldBossEvent.eventId !== eventId
                    || freshSession.worldBossEvent.matchId !== matchId
                    || freshSession.status !== 'done') {
                    return { ok: false as const, status: 409, error: 'The server has not sealed a terminal result for this match.' };
                }
                for (const member of match.members) {
                    const contribution = scoreWorldBossContribution(freshSession.worldBossContributions?.[member.slug]);
                    member.contribution = contribution;
                }
                const teamDamage = match.members.reduce((sum, member) => sum + cleanDamage(member.contribution?.damage), 0);
                const applied = await withKvLock(worldBossEventKey(eventId), async () => {
                    const current = await readWorldBossEvent(eventId);
                    if (!current) throw new Error('World boss event record is missing.');
                    const hpBefore = Math.max(0, Number(current.hp) || 0);
                    const wasStoppedByAdmin = current.status === 'stopped';
                    const firstSettlement = !current.settledMatchIds.includes(matchId);
                    if (firstSettlement) {
                        if (!wasStoppedByAdmin) current.hp = Math.max(0, current.hp - teamDamage);
                        for (const member of match.members) {
                            const contribution = member.contribution;
                            if (!contribution?.active) continue;
                            const prior = current.participants[member.slug];
                            current.participants[member.slug] = {
                                slug: member.slug,
                                name: member.name,
                                village: prior?.village ?? member.village,
                                clan: prior?.clan ?? member.clan,
                                damage: (prior?.damage ?? 0) + contribution.damage,
                                score: (prior?.score ?? 0) + contribution.score,
                                hollowShardsDeposited: prior?.hollowShardsDeposited ?? 0,
                                crystalPoints: prior?.crystalPoints ?? 0,
                                actions: (prior?.actions ?? 0) + contribution.actions,
                                matches: (prior?.matches ?? 0) + 1,
                                firstAt: prior?.firstAt ?? match.startedAt,
                            };
                        }
                        current.settledMatchIds = [...current.settledMatchIds, matchId].slice(-5_000);
                        current.status = wasStoppedByAdmin
                            ? 'stopped'
                            : current.hp <= 0
                                ? 'victory'
                                : current.endsAt <= Date.now()
                                    ? 'retreated'
                                    : worldBossEventStatus(current, Date.now());
                        if (current.status === 'victory' || current.status === 'retreated') current.endedAt = current.endedAt ?? Date.now();
                        if (current.status === 'victory' && !Array.isArray(current.topCacheRecipients)) {
                            current.topCacheSettlementDeadlineAt ??= Date.now() + WORLD_BOSS_TOP_CACHE_SETTLEMENT_GRACE_MS;
                        }
                    }
                    if (current.status === 'retreated') await applyWorldBossRetreatPenalty(current, Date.now());
                    if (firstSettlement || (current.status === 'retreated' && current.retreatPenaltyApplied)) {
                        current.updatedAt = Date.now();
                        await writeWorldBossEvent(current);
                    }
                    return { event: current, bankedDamage: wasStoppedByAdmin ? 0 : Math.min(hpBefore, teamDamage) };
                }, { failClosed: true });
                match.teamDamage = teamDamage;
                match.bankedDamage = applied.bankedDamage;
                await writeWorldBossMatch(match);
                bankedDamage = applied.bankedDamage;
                hpRemaining = applied.event.hp;
            } else {
                const event = await readWorldBossEvent(eventId);
                hpRemaining = Math.max(0, Number(event?.hp) || 0);
                bankedDamage = Math.max(0, Number(match.bankedDamage) || 0);
            }

            const settledMatch = await readWorldBossMatch(eventId, matchId);
            if (!settledMatch) return { ok: false as const, status: 404, error: 'World boss match receipt not found.' };
            for (const member of settledMatch.members) {
                if (!member.contribution?.active) continue;
                const paid = await settleWorldBossReward({ eventId, eventStartedAt: (await readWorldBossEvent(eventId))?.startedAt ?? 0, playerSlug: member.slug });
                if (!paid) throw new Error('World boss reward settlement is pending.');
                member.reward = paid.reward;
                if (member.slug === playerSlug) callerReward = paid;
            }
            callerContribution = settledMatch.members.find(member => member.slug === playerSlug)?.contribution ?? null;
            settledMatch.status = 'settled';
            settledMatch.settledAt = settledMatch.settledAt ?? Date.now();
            await writeWorldBossMatch(settledMatch);
            const settledSession = await readSession(runId);
            if (settledSession?.worldBossEvent?.matchId === matchId && settledSession.rewardSettlementState !== 'settled') {
                settledSession.rewardSettlementState = 'settled';
                await writeSession(settledSession);
            }
            await releaseTowerBattleLeases(runId, towerBattleLeaseMembers(session));
            for (const member of settledMatch.members) await writeWorldBossPlayerPointer(eventId, member.slug, {
                matchId,
                status: 'settled',
                updatedAt: Date.now(),
            });
            return { ok: true as const, match: settledMatch, callerReward };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const settledEvent = await readWorldBossEvent(eventId);
        if (settledEvent) await announceWorldBossEventTransition(settledEvent, worldBossEventStatus(settledEvent, Date.now()));
        if (settledEvent?.status === 'victory') await closeWorldBossQueue(eventId, Date.now());
        await removeWorldBossMatchFromQueue(eventId, matchId);
        if (settledEvent?.status === 'victory') await rememberWorldBossTopCacheEvent(eventId);
        const topCacheDeliveries = settledEvent?.status === 'victory'
            ? await settleWorldBossTopCaches(eventId)
            : [];
        const member = result.match.members.find(entry => entry.slug === playerSlug);
        callerContribution = member?.contribution ?? callerContribution;
        const callerReward = result.callerReward;
        const reward = callerReward?.reward ?? member?.reward ?? null;
        const rewardSummary = reward
            ? `+${reward.ryo.toLocaleString()} Ryo · +${reward.statPoints} stat points · +${reward.boneCharms} Bone Charms · Boss Core · rare material${reward.gearDrop ? ' · weapon or armor' : ''}`
            : callerContribution?.active ? 'Your event reward was already claimed.' : 'Contribution recorded. Make a meaningful combat or support action in a future team to qualify for the event reward.';
        const response: Record<string, unknown> = {
            settled: true,
            eventId,
            matchId,
            bankedDamage,
            hpRemaining,
            contribution: callerContribution,
            reward,
            rewardSummary,
            gearDrop: reward?.gearDrop ? { itemId: reward.gearDrop } : undefined,
        };
        if (callerReward) {
            response.character = callerReward.character;
            response._saveVersion = callerReward.saveVersion;
        }
        const callerCache = topCacheDeliveries.find(entry => entry.slug === playerSlug);
        if (callerCache) {
            response.character = callerCache.character;
            response._saveVersion = callerCache.saveVersion;
            response.hollowBeastCache = { itemId: 'hollow-beast-cache', rank: callerCache.rank };
        }
        return res.status(200).json(response);
    } catch (error) {
        console.error('[world-boss-event/settle]', error);
        return res.status(503).json({ error: 'World boss settlement could not be confirmed. Try again.' });
    }
}
