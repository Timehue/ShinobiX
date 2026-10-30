import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { chooseStarterPet } from './_starter.js';

// The client shows the server's `error` string to the player as-is.
const STARTER_REFUSAL_COPY: Record<string, string> = {
    'starter-not-available': 'A starter companion can only be chosen during the Academy introduction.',
    'invalid-starter': 'That starter companion is not one of the Academy\'s five. Choose again.',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your starter choice.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-choose-starter', 5, 60_000, identity.name))) return;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const chosen = chooseStarterPet(character, body.pet);
            if (!chosen.ok) {
                // A replay after the starter already committed (a lost reply, a
                // double-fire, the cinematic's second pass) is answered with the
                // save as it stands, not a refusal. The client treats a refusal
                // as "not saved": it strips the pet, resets the step and replays
                // the cinematic, and the next pick is refused the same way, so a
                // dropped response used to loop a new player forever.
                if (chosen.reason === 'starter-already-chosen') {
                    return { ok: true as const, character, value: { alreadyChosen: true }, write: false };
                }
                return { ok: false as const, status: 409, error: chosen.reason };
            }
            return { ok: true as const, character: chosen.character, value: { alreadyChosen: false } };
        });
        if (!result.ok) {
            return res.status(result.status).json({ error: STARTER_REFUSAL_COPY[result.error] ?? result.error, code: result.error });
        }
        return res.status(200).json({ ok: true, character: result.character, _saveVersion: result._saveVersion, ...result.value });
    } catch (error) {
        console.error('[pet/choose-starter]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
