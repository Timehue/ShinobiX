import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeLogValue } from '../_safe-log.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { publicPetBreedingSession } from './_breeding.js';
import { settlePetBreedingSession, type PetBreedingSession } from './_breeding-requirements.js';
import { migrateCharacterOwnedPets } from './_owned-pet.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 'no-store');
    try {
        const playerName = safeName(String(req.query.playerName ?? req.query.name ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only inspect your own breeding barn.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-breeding-status', 120, 60_000, identity.name))) return;
        const serverTime = Date.now();
        const result = await withKvLock(`save:${playerName}`, async () => {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const stored = record?.character as Record<string, unknown> | undefined;
            if (!record || !stored) return { status: 404 as const };
            const migrated = migrateCharacterOwnedPets(playerName, stored);
            const settled = settlePetBreedingSession(migrated.character, serverTime);
            const changed = migrated.changed || settled.changed;
            if (!changed) {
                return { status: 200 as const, character: settled.character, version: Number(record._saveVersion ?? 0), changed };
            }
            const written = await writeVersionedPlayerSave(`save:${playerName}`, record, settled.character);
            return { status: 200 as const, character: settled.character, version: written._saveVersion, changed };
        }, { failClosed: true });
        if (result.status === 404) return res.status(404).json({ error: 'Player save not found.' });
        const session = publicPetBreedingSession(result.character.petBreeding as PetBreedingSession | null | undefined);
        return res.status(200).json({
            ok: true,
            session,
            serverTime,
            _saveVersion: result.version,
            ...(result.changed ? { character: result.character } : {}),
        });
    } catch (error) {
        console.error('[pet/breeding/status]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
