import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import type { ClanWar } from '../clan/war/_storage.js';
import { settleClanWarRewards, settleVillageWarRewards, type VillageWarRewardRecord } from './_reward.js';

const WAR_ID_RE = /^[a-z0-9]+-vs-[a-z0-9]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const kind = body.kind === 'clan' ? 'clan' : body.kind === 'village' ? 'village' : '';
        const warId = String(body.warId ?? '').trim().toLowerCase();
        if (!playerName || !kind || !WAR_ID_RE.test(warId)) return res.status(400).json({ error: 'Invalid war reward claim.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only claim your own war rewards.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'claim-war-reward', 30, 60_000, identity.name))) return;

        const war = kind === 'village'
            ? await kv.get<VillageWarRewardRecord>(`world:war:${warId}`)
            : await kv.get<ClanWar>(`clan-war:${warId}`);
        if (!war) return res.status(404).json({ error: 'War record not found.' });

        const outcome = await mutatePlayerSave(playerName, ({ character }) => {
            const reward = kind === 'village'
                ? settleVillageWarRewards(character, war as VillageWarRewardRecord)
                : settleClanWarRewards(character, war as ClanWar);
            return { ok: true as const, character: reward.character, value: reward };
        });
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
        return res.status(200).json({
            ok: true,
            ...outcome.value,
            character: outcome.character,
            _saveVersion: outcome._saveVersion,
        });
    } catch (error) {
        console.error('[war/claim-reward]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
