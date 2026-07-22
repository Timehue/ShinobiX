import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
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
        const identityName = await authedPlayer(req, playerName);
        if (!identityName) return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName) return res.status(403).json({ error: 'You can only open your own war crates.' });
        if (!(await enforceRateLimitKv(req, res, 'open-war-crate', 10, 60_000, identityName, { strict: true }))) return;

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
        await Promise.all(entries.filter((entry) => entry.delta > 0).map((entry) => recordEconomyTxn({
            txnId: `war-crate-open:${playerName}:${entry.currency}:${now}`,
            player: playerName,
            currency: entry.currency,
            delta: entry.delta,
            source: 'inventory.war-crate-open',
            balanceAfter: entry.balanceAfter,
        })));
        return res.status(200).json({ ok: true, rewards: out.value, character: out.character, _saveVersion: out._saveVersion });
    } catch (error) {
        console.error('[inventory/open-war-crate]', safeLogValue(error));
        return res.status(503).json({ error: 'Could not open the war crate. Nothing was changed; please retry.' });
    }
}
