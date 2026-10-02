import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { safeName } from './_utils.js';
import { hasRecentIpOrFpOverlap } from './_player-ips.js';
import { legacyEnabled, bumpLegacyStats, legacyBootstrapBeforeCounterIncrement, LEGACY_PVP_RECEIPT_TTL_SECONDS } from './_legacy-track.js';
import { extractPvpLegacyDeltas, guardDefenseDeltas } from './_legacy-pvp.js';
import { acknowledgeEraContribution, bumpEraContributionOnce } from './_era.js';
import { inspectPvpCredit, pvpSettlementId } from './pvp/_reward-settlement.js';
import { pvpSessionMayGrantProgress, type PvpSession } from './pvp/session.js';

/** Server terminal continuation, also used by the old win-report repair door. */
export async function settlePvpLegacyProgress(session: PvpSession): Promise<void> {
    if (!legacyEnabled() || session.status !== 'done' || !session.winner || session.winner === 'draw'
        || !pvpSessionMayGrantProgress(session) || session.rankedKind === 'pet'
        || session.realFighters?.p1 === false || session.realFighters?.p2 === false) return;
    const duration = Number(session.lastMoveAt) - Number(session.createdAt);
    if (duration < 15_000 || !Number.isFinite(duration)) return;
    await withKvLock(`legacy:pvp-delivery:${session.battleId}`, async () => {
        const battleId = session.battleId;
        const trackedKey = `legacy:pvp-tracked:${battleId}`;
        if (await kv.get(trackedKey)) return;
        const winner = session.winner === 'p1' ? session.p1 : session.p2;
        const loser = session.winner === 'p1' ? session.p2 : session.p1;
        const winnerName = safeName(winner.name);
        const loserName = safeName(loser.name);
        if (!winnerName || !loserName || winnerName === loserName) return;
        const [record, opponentRecord] = await Promise.all([
            kv.get<Record<string, unknown>>(`save:${winnerName}`), kv.get<Record<string, unknown>>(`save:${loserName}`),
        ]);
        const char = record?.character as Record<string, unknown> | undefined;
        const opponentChar = opponentRecord?.character as Record<string, unknown> | undefined;
        // Missing real-player saves are a pending delivery, never NPC proof.
        if (!char || !opponentChar) throw new Error('legacy-pvp-player-save-pending');
        const opponentCreated = Number(opponentChar.createdAt ?? 0);
        const youngOpponent = opponentCreated > 0 && Number(session.createdAt) - opponentCreated < 72 * 60 * 60 * 1000;
        const farmed = await hasRecentIpOrFpOverlap(winnerName, loserName);
        if (youngOpponent || farmed) {
            if (!(await bumpLegacyStats(winnerName, {}, {
                characterForBootstrap: char, suspicion: true, receiptId: `pvp:${battleId}:suspicion`,
            }))) throw new Error('legacy-pvp-suspicion-delivery-pending');
        } else {
            const extract = extractPvpLegacyDeltas(session, winner.name, loser.name);
            const guardMarker = await kv.get<{ defender?: string; attacker?: string }>(`legacy:guard-defense:${battleId}`);
            const normalizedGuard = guardMarker ? {
                defender: safeName(String(guardMarker.defender ?? '')), attacker: safeName(String(guardMarker.attacker ?? '')),
            } : null;
            const participantsMatch = normalizedGuard && (
                (normalizedGuard.defender === winnerName && normalizedGuard.attacker === loserName)
                || (normalizedGuard.defender === loserName && normalizedGuard.attacker === winnerName)
            );
            const attackerRole = session.worldAttacker?.side;
            const authoritativeRolesMatch = session.rewardAuthority === 'world'
                && (attackerRole === 'p1' || attackerRole === 'p2')
                && safeName(session.worldAttacker?.name ?? '') === safeName(session[attackerRole].name)
                && normalizedGuard?.attacker === safeName(session[attackerRole].name)
                && normalizedGuard?.defender === safeName(session[attackerRole === 'p1' ? 'p2' : 'p1'].name);
            const guard = guardDefenseDeltas(participantsMatch && authoritativeRolesMatch ? normalizedGuard : null, winnerName);
            Object.assign(extract.winnerDeltas, guard);
            const bootstrap = !inspectPvpCredit(char, pvpSettlementId('base', battleId), 'base').fresh
                ? legacyBootstrapBeforeCounterIncrement(char, 'totalPvpKills') : char;
            const clock = Number(session.endedAt ?? session.lastMoveAt);
            const gap = Number(winner.character.level ?? 0) - Number(loser.character.level ?? 0);
            const winnerDelivered = await bumpLegacyStats(winnerName, extract.winnerDeltas, {
                characterForBootstrap: bootstrap, pvpTarget: loserName, pvpLevelGap: gap,
                pvpAttributionId: battleId, pvpAttributionAt: clock, streak: 'win', receiptId: `pvp:${battleId}:winner`,
            });
            const loserDelivered = await bumpLegacyStats(loserName, extract.loserDeltas, {
                characterForBootstrap: opponentChar, pvpTarget: winnerName, pvpLevelGap: -gap,
                pvpAttributionId: battleId, pvpAttributionAt: clock, streak: 'reset', receiptId: `pvp:${battleId}:loser`,
            });
            if (!winnerDelivered || !loserDelivered) throw new Error('legacy-pvp-combat-delivery-pending');
            const eraId = `pvp:${battleId}:era`;
            await bumpEraContributionOnce('pvpWins', eraId);
            await acknowledgeEraContribution('pvpWins', eraId);
            await kv.del(`legacy:guard-defense:${battleId}`);
        }
        if (await kv.set(trackedKey, true, { ex: LEGACY_PVP_RECEIPT_TTL_SECONDS }) !== 'OK') throw new Error('legacy-pvp-completion-pending');
    }, { failClosed: true });
}
