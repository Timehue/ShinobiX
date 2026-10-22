import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import type { ClanWar } from '../clan/war/_storage.js';
import { settleClanWarRewards, settleVillageWarRewards, villageWarRewardToken, type VillageWarRewardRecord } from './_reward.js';
import { listSectorWarPurseLedgers, settleSectorWarPurses, type SectorPursePaid } from './_sector-purse.js';
import { bumpLegacyStats, legacyBootstrapBeforeCounterIncrement } from '../_legacy-track.js';
import { recordEconomyTxn } from '../_economy.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';

const WAR_ID_RE = /^[a-z0-9]+-vs-[a-z0-9]+$/;

/*
 * /api/war/claim-reward — POST { playerName, kind: 'village' | 'clan', warId }
 *                      or POST { playerName, kind: 'sector' }
 *
 * Settles an ended war's rewards into the claimant's save, from the stored war
 * row only (api/war/_reward.ts): crates, MVP, consolation and, for village
 * wars, the war purse. `kind: 'sector'` pays every sector-war purse the player
 * earned in the last 7 days (api/war/_sector-purse.ts); it names no war, since
 * the ledgers are found by scan.
 */

type CurrencyDeltas = { ryo: number; honorSeals: number; boneCharms: number; fateShards: number };

function currencyDeltas(before: Record<string, unknown>, after: Record<string, unknown>): CurrencyDeltas {
    const d = (key: keyof CurrencyDeltas) => (Number(after[key]) || 0) - (Number(before[key]) || 0);
    return { ryo: d('ryo'), honorSeals: d('honorSeals'), boneCharms: d('boneCharms'), fateShards: d('fateShards') };
}

/** Best-effort economy telemetry for a granted claim (framework I-19). */
function recordClaimLedger(playerName: string, txnBase: string, deltas: CurrencyDeltas, ryoSplit: Array<{ source: string; ryo: number }>, source: string): void {
    for (const part of ryoSplit) {
        if (part.ryo > 0) void recordEconomyTxn({ txnId: `${txnBase}:${part.source}`, player: playerName, currency: 'ryo', delta: part.ryo, source: part.source });
    }
    for (const currency of ['honorSeals', 'boneCharms', 'fateShards'] as const) {
        if (deltas[currency] > 0) void recordEconomyTxn({ txnId: `${txnBase}:${currency}`, player: playerName, currency, delta: deltas[currency], source });
    }
}

async function claimSectorPurses(res: VercelResponse, playerName: string) {
    const ledgers = await listSectorWarPurseLedgers();
    const outcome = await mutatePlayerSave(playerName, ({ character }) => {
        const settled = settleSectorWarPurses(character, ledgers, Date.now());
        return { ok: true as const, character: settled.character, value: settled, write: settled.granted };
    });
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    const purses: SectorPursePaid[] = outcome.value.purses;
    if (outcome.value.granted) {
        const village = String(outcome.character.village ?? '');
        for (const purse of purses) {
            void recordEconomyTxn({ txnId: `war-purse:sector:${purse.contestId}:${purse.instance}:${playerName}`, player: playerName, currency: 'ryo', delta: purse.ryo, source: 'war.purse.sector' });
            void recordWarEcoEvent({ eventId: `sector-purse:${purse.contestId}:${purse.instance}:${playerName}`, village, kind: 'war.purse.sector', amount: purse.ryo, meta: `sector:${purse.sector}` });
        }
    }
    return res.status(200).json({
        ok: true,
        granted: outcome.value.granted,
        sectorPurses: purses.map((p) => ({ sector: p.sector, outcome: p.outcome, ryo: p.ryo })),
        sectorPurseRyo: outcome.value.ryo,
        character: outcome.character,
        _saveVersion: outcome._saveVersion,
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const kind = body.kind === 'clan' ? 'clan' : body.kind === 'village' ? 'village' : body.kind === 'sector' ? 'sector' : '';
        const warId = String(body.warId ?? '').trim().toLowerCase();
        if (!playerName || !kind || (kind !== 'sector' && !WAR_ID_RE.test(warId))) return res.status(400).json({ error: 'Invalid war reward claim.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only claim your own war rewards.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'claim-war-reward', 30, 60_000, identity.name))) return;

        if (kind === 'sector') return await claimSectorPurses(res, playerName);

        const war = kind === 'village'
            ? await kv.get<VillageWarRewardRecord>(`world:war:${warId}`)
            : await kv.get<ClanWar>(`clan-war:${warId}`);
        if (!war) return res.status(404).json({ error: 'War record not found.' });

        const outcome = await mutatePlayerSave(playerName, ({ character }) => {
            const reward = kind === 'village'
                ? settleVillageWarRewards(character, war as VillageWarRewardRecord)
                : settleClanWarRewards(character, war as ClanWar);
            // Nothing new to settle (already claimed, or no stake in this war):
            // answer with the stored save instead of rewriting it. Writing bumped
            // _saveVersion on every no-op claim, and clients re-poll these, so the
            // version moved under open autosaves and turned them into 409s.
            return {
                ok: true as const,
                character: reward.character,
                value: { ...reward, deltas: currencyDeltas(character, reward.character) },
                write: reward.granted,
            };
        });
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
        const { deltas, ...reward } = outcome.value;
        if (reward.granted) {
            const village = String(outcome.character.village ?? '');
            const token = kind === 'village' ? villageWarRewardToken(war as VillageWarRewardRecord) : warId;
            recordClaimLedger(playerName, `war-reward:${kind}:${token}:${playerName}`, deltas, [
                { source: `war.reward.${kind}`, ryo: reward.ryo - reward.purse },
                { source: 'war.purse.village', ryo: reward.purse },
            ], `war.reward.${kind}`);
            if (kind === 'village' && village) {
                if (reward.purse > 0) void recordWarEcoEvent({ eventId: `purse:${token}:${playerName}`, village, kind: 'war.purse.village', amount: reward.purse });
                const winnerCrates = reward.crates - (reward.mvp ? 1 : 0);
                if (winnerCrates > 0) void recordWarEcoEvent({ eventId: `crate:${token}:${playerName}`, village, kind: 'war.crate.claim', amount: winnerCrates });
            }
        }
        if (kind === 'village' && war.endedAt) {
            const villageWar = war as VillageWarRewardRecord;
            const claims = new Set(Array.isArray(outcome.character.claimedWarCrateIds) ? outcome.character.claimedWarCrateIds.map(String) : []);
            const token = villageWarRewardToken(villageWar);
            const won = !!villageWar.warCrateId && claims.has(villageWar.warCrateId);
            const mvp = claims.has(`mvp-crate-${token}`);
            // Both deeds may have committed in one save. Remove both increments
            // from a first-touch baseline before either receipt seeds the tracker.
            let baseline: Record<string, unknown> | null = outcome.character;
            if (won) baseline = legacyBootstrapBeforeCounterIncrement(baseline, 'warsWon');
            if (mvp) baseline = legacyBootstrapBeforeCounterIncrement(baseline, 'warMvpCount');
            const deeds = [
                ...(won ? [{ receiptId: `war-won:${villageWar.warCrateId}`, deltas: { warsWon: 1 } }] : []),
                ...(mvp ? [{ receiptId: `war-mvp:${token}`, deltas: { warMvps: 1 } }] : []),
            ];
            for (const deed of deeds) {
                const delivered = await bumpLegacyStats(playerName, deed.deltas, {
                    receiptId: deed.receiptId, durableReceipt: true, characterForBootstrap: baseline,
                });
                if (!delivered) return res.status(503).json({
                    error: 'Your war rewards are safe, but their Legacy progress is still being sealed. Retry this reward claim.',
                    code: 'legacy-delivery-pending', retryable: true, _saveVersion: outcome._saveVersion,
                });
            }
        }
        return res.status(200).json({
            ok: true,
            ...reward,
            character: outcome.character,
            _saveVersion: outcome._saveVersion,
        });
    } catch (error) {
        console.error('[war/claim-reward]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
