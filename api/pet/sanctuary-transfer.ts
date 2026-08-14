import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { maxPets } from '../_entitlements.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { settlePetBreedingSession } from './_breeding-requirements.js';
import { migrateCharacterOwnedPets } from './_owned-pet.js';
import { petBusyReason, petBusyMessage } from './_pet-busy.js';
import { getPetFromSanctuary, removePetFromSanctuary, storePetInSanctuary } from './_sanctuary.js';

type SanctuaryAction = 'to-sanctuary' | 'to-roster' | 'release';
type TransferResult =
    | { ok: true; character: Record<string, unknown>; pet: Record<string, unknown>; version: number; action: SanctuaryAction; replayed: boolean }
    | { ok: false; status: number; error: string; message?: string };

function defensePetIds(defense: unknown): string[] {
    if (!defense || typeof defense !== 'object') return [];
    const pets = (defense as { pets?: unknown }).pets;
    return Array.isArray(pets)
        ? pets.map((pet) => String((pet as Record<string, unknown>)?.id ?? '')).filter(Boolean)
        : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const petId = String(body.petId ?? '').slice(0, 128);
        const action = String(body.action ?? '') as SanctuaryAction;
        if (!playerName || !petId || !['to-sanctuary', 'to-roster', 'release'].includes(action)) {
            return res.status(400).json({ error: 'invalid-sanctuary-transfer' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only manage your own sanctuary.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-sanctuary-transfer', 30, 60_000, identity.name))) return;

        const result = await withKvLock<TransferResult>(`save:${playerName}`, async () => {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const stored = record?.character as Record<string, unknown> | undefined;
            if (!record || !stored) return { ok: false, status: 404, error: 'player-save-not-found' };
            const migrated = migrateCharacterOwnedPets(playerName, stored);
            const settled = settlePetBreedingSession(migrated.character);
            const character = settled.character;
            const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
            const carriedPet = pets.find((pet) => String(pet.id ?? '') === petId);

            if (action === 'to-sanctuary') {
                if (!carriedPet) {
                    const existing = await getPetFromSanctuary(playerName, petId);
                    if (!existing) return { ok: false, status: 404, error: 'pet-not-carried' };
                    return { ok: true, character, pet: existing.pet, version: Number(record._saveVersion ?? 0), action, replayed: true };
                }
                const [activeBattle, coliseumDefense, tacticalDefense] = await Promise.all([
                    kv.get(`battle-lock:${playerName}`),
                    kv.get(`petladder:coliseum:def:${playerName}`),
                    kv.get(`petladder:tactical:def:${playerName}`),
                ]);
                if (activeBattle) {
                    return { ok: false, status: 409, error: 'pet-is-in-active-battle', message: 'Finish or resume your active battle before moving a companion to the Sanctuary.' };
                }
                const assignmentIds = [...defensePetIds(coliseumDefense), ...defensePetIds(tacticalDefense)];
                const busy = petBusyReason(character, carriedPet, Date.now(), {
                    includeActive: false,
                    includeReserve: false,
                    assignmentIds,
                });
                if (busy) return { ok: false, status: 409, error: busy, message: petBusyMessage(busy).replace('before breeding', 'before moving it to the Sanctuary') };
                await storePetInSanctuary(playerName, carriedPet, 'roster');
                const nextCharacter = {
                    ...character,
                    pets: pets.filter((pet) => String(pet.id ?? '') !== petId),
                    ...(String(character.activePetId ?? '') === petId ? { activePetId: undefined } : {}),
                    ...(String(character.activePetId2v2 ?? '') === petId ? { activePetId2v2: undefined } : {}),
                };
                const written = await writeVersionedPlayerSave(`save:${playerName}`, record, nextCharacter);
                return { ok: true, character: nextCharacter, pet: carriedPet, version: written._saveVersion, action, replayed: false };
            }

            if (action === 'to-roster') {
                if (carriedPet) {
                    await removePetFromSanctuary(playerName, petId).catch((error) => console.error('[pet/sanctuary/transfer] replay cleanup', safeLogValue(error)));
                    return { ok: true, character, pet: carriedPet, version: Number(record._saveVersion ?? 0), action, replayed: true };
                }
                if (pets.length >= maxPets(character)) {
                    return { ok: false, status: 409, error: 'carried-roster-full', message: `Your carried roster is full (${pets.length}/${maxPets(character)}). Store another companion first.` };
                }
                const sanctuaryItem = await getPetFromSanctuary(playerName, petId);
                if (!sanctuaryItem) return { ok: false, status: 404, error: 'pet-not-in-sanctuary' };
                const nextCharacter = { ...character, pets: [...pets, sanctuaryItem.pet] };
                const written = await writeVersionedPlayerSave(`save:${playerName}`, record, nextCharacter);
                await removePetFromSanctuary(playerName, petId).catch((error) => console.error('[pet/sanctuary/transfer] withdraw cleanup', safeLogValue(error)));
                return { ok: true, character: nextCharacter, pet: sanctuaryItem.pet, version: written._saveVersion, action, replayed: false };
            }

            if (carriedPet) return { ok: false, status: 409, error: 'pet-is-carried', message: 'Move this companion to the Sanctuary before releasing it.' };
            const removed = await removePetFromSanctuary(playerName, petId);
            if (!removed) return { ok: false, status: 404, error: 'pet-not-in-sanctuary' };
            return { ok: true, character, pet: removed.pet, version: Number(record._saveVersion ?? 0), action, replayed: false };
        }, { failClosed: true });

        if (!result.ok) return res.status(result.status).json({ error: result.error, ...(result.message ? { message: result.message } : {}) });
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({
            ok: true,
            action: result.action,
            replayed: result.replayed,
            pet: result.pet,
            character: result.character,
            _saveVersion: result.version,
        });
    } catch (error) {
        console.error('[pet/sanctuary/transfer]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
