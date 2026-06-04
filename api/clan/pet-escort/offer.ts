import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { safeName, cors, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { offerEscort } from './_storage.js';

// Pet Tamer offers escort to their clan. Sets a 1h-TTL marker; the offer
// auto-expires if not refreshed. Vanguards in the same clan who win a raid
// with an active pet trigger a +20% next-expedition bonus on the offerer.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only offer escort as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-escort-offer', 15, 60_000, identity.name))) return;

        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!char) return res.status(404).json({ error: 'Character not found.' });

        if (char.profession !== 'petTamer') {
            return res.status(403).json({ error: 'Only Pet Tamers can offer escort.' });
        }
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to offer escort.' });

        // Verify the offerer is actually in the clan's member roster. A
        // kicked player whose own save still says clan="X" must not be able
        // to keep offering escorts to clan X. Use the canonical clan-record key
        // (bare slug) — the old hyphenated slug here ("storm-clan") never
        // matched the actual record key ("stormclan"), so the membership check
        // silently failed for every multi-word clan name. (audit #19)
        const clanRecord = await kv.get<Record<string, unknown>>(clanRecordKey(clanName));
        const members = Array.isArray(clanRecord?.members) ? (clanRecord!.members as Array<Record<string, unknown>>) : [];
        const isMember = members.some((m) => safeName(String(m?.name ?? '')) === playerName);
        if (!isMember) {
            return res.status(403).json({ error: 'You are no longer a member of that clan.' });
        }

        await offerEscort(clanName, playerName);
        return res.status(200).json({ ok: true, clanName, petTamer: playerName, expiresInSeconds: 60 * 60 });
    } catch (err) {
        console.error('[clan/pet-escort/offer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
