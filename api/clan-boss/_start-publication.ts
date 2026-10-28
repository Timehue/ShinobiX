import { getFloor } from '../towers/_floor-catalog.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import { makeRng } from '../towers/_sim.js';
import { readSession, writeSession, setTowerInvite, PAID_RECEIPT_TTL } from '../towers/_tower-store.js';
import { withTowerSessionMutation } from '../towers/_session-mutation.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { claimClanBossBattleMarkers, bindClanBossBattleMarkers } from '../towers/_battle-lease.js';
import { configureClanBossEncounter } from './_encounter-config.js';
import { activatePartyStart } from './_party.js';
import { loadAssault, saveAssault } from './_assault.js';
import { resolveClanBossDef, loadClanBossProgress, saveClanBossProgress, clanBossProgressKey, type ClanBossWeek, type ClanBossStartReceipt } from './_storage.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { loadAdminJutsuObjects } from '../_admin-jutsu-catalog.js';
import { resolvePveGapClosingJutsu, teachPveGapClosingJutsu } from '../_ai-opponent-loadout.js';
import { pveAiItemCharges } from '../combat-core/ai-items.js';

export const clanBossStartLocatorKey = (host: string, request: string) => `clan-boss:start:${host}:${request}`;
export const clanBossStartInputsKey = (runId: string) => `clan-boss:start-input:${runId}`;
export type ClanBossStartLocator = { weekId: string; clanName: string };
export class ClanBossStartPublicationError extends Error {
    readonly status = 410;
}

/** Publication shares the action/settlement mutex; a retry can never reset a live fight. */
export async function publishClanBossStart(input: {
    receipt: ClanBossStartReceipt; week: ClanBossWeek; clanName: string; squad?: SquadMemberInput[];
    recoverPartyId?: () => Promise<string | undefined>;
}) {
    const { receipt, week, clanName } = input;
    const boss = resolveClanBossDef(week);
    const floor = boss && getFloor(boss.floorId);
    if (!boss || !floor) throw new Error('Clan Boss floor missing.');
    const gapClosingJutsu = resolvePveGapClosingJutsu({ jutsu: await loadAdminJutsuObjects(), items: new Map() });
    const session = await withTowerSessionMutation(receipt.runId, async () => {
        let current = await readSession(receipt.runId);
        const assault = await loadAssault(receipt.runId);
        const progress = await loadClanBossProgress(week.weekId, clanName);
        const savedReceipt = progress?.startRequests?.find(r => r.runId === receipt.runId);
        if (!current && (assault?.settled || progress?.assaults.some(a => a.runId === receipt.runId) || savedReceipt?.publishedAt)) {
            throw new ClanBossStartPublicationError('This reserved assault has ended or its battle history has expired. No additional attempt was used.');
        }
        // Every published terminal session lives at least this long; active rows
        // live longer. The atomic reservation timestamp therefore fences missing
        // sessions after that boundary even if the later publishedAt write failed.
        // Inside this window, a naturally expired published row is impossible.
        if (!current && Date.now() - receipt.at >= PAID_RECEIPT_TTL * 1000) {
            throw new ClanBossStartPublicationError('This assault reservation has expired. No additional attempt was used.');
        }
        const sealed = !current && receipt.inputKey ? await kv.get<{ squad: SquadMemberInput[] }>(receipt.inputKey) : null;
        const squad = receipt.inputKey ? sealed?.squad : receipt.squad ?? input.squad;
        if (!current && !squad?.length) throw new ClanBossStartPublicationError('This assault fighter snapshot has expired. No additional attempt was used.');
        // Legacy party repair may mutate readiness. Run it only after all terminal
        // recovery fences, under the same mutex as publication and settlement.
        const partyId = receipt.partyId ?? await input.recoverPartyId?.();
        // A finished paid run remains recoverable without reclaiming its members.
        if (!current || current.status === 'active') {
            const claim = await claimClanBossBattleMarkers({ requestId: receipt.runId, runId: receipt.runId, members: receipt.party });
            if (!claim.ok) throw new Error('A reserved member is in another battle. Retry the same assault after it finishes.');
        }
        if (!current) {
            current = buildTowerEncounter({ floor, squad: squad!, runId: receipt.runId, seed: receipt.seed,
                partySize: squad!.length, towerId: 'clan-boss', clanBossRulesVersion: receipt.rulesVersion, now: receipt.at });
            configureClanBossEncounter(current, floor, receipt.bossHp, receipt);
            for (const actor of current.actors) if (actor.side === 'enemy') {
                teachPveGapClosingJutsu(actor.character, gapClosingJutsu);
                actor.itemCharges = pveAiItemCharges(actor.character);
            }
            startRound(current);
            runAiUntilHuman(current, floor, makeRng(receipt.seed));
            stampTurnClock(current, receipt.at);
            await writeSession(current);
        }
        // A durable publication receipt prevents expired sessions from being reminted.
        if (savedReceipt && !savedReceipt.publishedAt) await withKvLock(clanBossProgressKey(week.weekId, clanName), async () => {
            const latest = await loadClanBossProgress(week.weekId, clanName);
            if (!latest) throw new Error('Reserved progress unavailable.');
            latest.startRequests = latest.startRequests?.map(r => r.runId === receipt.runId ? { ...r, publishedAt: Date.now() } : r);
            await saveClanBossProgress(latest);
        }, { failClosed: true });
        const publishedAssault = await loadAssault(receipt.runId);
        if (!publishedAssault) await saveAssault({ runId: receipt.runId, weekId: week.weekId,
            clanName, host: receipt.host, party: receipt.party, partyId,
            rulesVersion: receipt.rulesVersion, bossId: boss.id, createdAt: receipt.at });
        else if (!publishedAssault.partyId && partyId) await saveAssault({ ...publishedAssault, partyId });
        if (current.status === 'active') {
            await bindClanBossBattleMarkers({ requestId: receipt.runId, runId: receipt.runId, members: receipt.party });
            for (const slug of receipt.party) await setTowerInvite(slug, receipt.runId);
        }
        if (partyId) await activatePartyStart(partyId, receipt.requestId, receipt.runId);
        return current;
    });
    return { runId: receipt.runId, session, boss: { id: boss.id, name: boss.name, icon: boss.icon } };
}
