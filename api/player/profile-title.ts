import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isAllowedCustomTitle, sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { TITLE_ICON_SET, TITLE_STYLE_IDS, isKnownEarnedTitle, normalizeTitleKey } from '../_titles-registry.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); const playerName = safeName(String(body.playerName ?? '')); const action = String(body.action ?? '');
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only edit your own profile.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'profile-title', 20, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            let field = ''; let value = ''; let cost = 0;
            if (action === 'title') {
                field = 'customTitle'; value = sanitizeUserText(body.value, TEXT_LIMITS.customTitle);
                if (!value) cost = 0;
                else if (isKnownEarnedTitle(value)) {
                    const legacy = character.legacy as { titles?: string[] } | undefined;
                    const owned = [...(Array.isArray(character.earnedTitles) ? character.earnedTitles as string[] : []), ...(Array.isArray(character.serverTitles) ? character.serverTitles as string[] : []), ...(Array.isArray(legacy?.titles) ? legacy.titles : [])];
                    if (!owned.some((title) => normalizeTitleKey(title) === normalizeTitleKey(value))) return { ok: false as const, status: 403, error: 'That title has not been earned.' };
                } else { if (!isAllowedCustomTitle(value)) return { ok: false as const, status: 400, error: 'That title is not allowed.' }; cost = 10; }
            } else if (action === 'style') {
                field = 'customTitleStyle'; value = String(body.value ?? ''); if (!TITLE_STYLE_IDS.has(value)) return { ok: false as const, status: 400, error: 'Invalid title style.' }; cost = value ? 40 : 0;
            } else if (action === 'icon') {
                field = 'customTitleIcon'; value = String(body.value ?? ''); if (!TITLE_ICON_SET.has(value)) return { ok: false as const, status: 400, error: 'Invalid title icon.' }; cost = value ? 25 : 0;
            } else return { ok: false as const, status: 400, error: 'Invalid profile action.' };
            if (String(character[field] ?? '') === value) cost = 0;
            const shards = Math.max(0, Number(character.fateShards) || 0); if (shards < cost) return { ok: false as const, status: 409, error: `Need ${cost} Fate Shards.` };
            return { ok: true as const, character: { ...character, [field]: value, fateShards: shards - cost }, value: { action, cost } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[player/profile-title]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
