import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { recordEconomyTxn } from '../_economy.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyWarCrateOpen } from './_war-crate.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only open your own war crates.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'open-war-crate', 10, 60_000, identity.name, { strict: true }))) return;

        const out = await mutatePlayerSave(playerName, ({ character }) => {
            const opened = applyWarCrateOpen(character, Math.random());
            if (!opened.ok) return opened;
            return { ok: true, character: opened.character, value: opened.rewards };
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });

        const now = Date.now();
        const balances = out.character;
        const entries = [
            { currency: 'ryo', delta: out.value.ryo, balanceAfter: Number(balances.ryo ?? 0) },
            { currency: 'honorSeals', delta: out.value.honorSeals, balanceAfter: Number(balances.honorSeals ?? 0) },
            { currency: 'boneCharms', delta: out.value.boneCharms, balanceAfter: Number(balances.boneCharms ?? 0) },
        ];
        // The save mutation above is the authoritative transaction. Economy
        // records are observability/audit projections and must never turn a
        // committed crate opening into a reported failure: the caller would
        // retry, discover that the crate is already gone, and be told that
        // nothing changed even though the reward was applied. Record every
        // projection best-effort and return the committed snapshot regardless.
        const telemetry = await Promise.allSettled(entries.filter((entry) => entry.delta > 0).map((entry) => recordEconomyTxn({
            txnId: `war-crate-open:${playerName}:${entry.currency}:${now}`,
            player: playerName,
            currency: entry.currency,
            delta: entry.delta,
            source: 'inventory.war-crate-open',
            balanceAfter: entry.balanceAfter,
        })));
        for (const failed of telemetry) {
            if (failed.status === 'rejected') {
                console.error('[inventory/open-war-crate] economy projection failed after committed settlement', safeLogValue(failed.reason));
            }
        }
        return res.status(200).json({
            ok: true,
            rewards: out.value,
            // Rolling-deploy compatibility for older clients that still call
            // /api/village/open-war-crate and read the singular reward shape.
            reward: {
                ryo: out.value.ryo,
                honorSeals: out.value.honorSeals,
                boneCharms: out.value.boneCharms,
                gotDungeonKey: out.value.dungeonKey,
            },
            character: out.character,
            _saveVersion: out._saveVersion,
        });
    } catch (error) {
        console.error('[inventory/open-war-crate]', safeLogValue(error));
        return res.status(503).json({ error: 'Could not open the war crate. Nothing was changed; please retry.' });
    }
}
