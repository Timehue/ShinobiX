import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeLogValue } from '../_safe-log.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { breedingResultKey, type SealedPetBreedingResult } from './_breeding.js';
import { petBreedingRequirementsComplete, settlePetBreedingSession, type PetBreedingSession } from './_breeding-requirements.js';
import { canonicalPetTemplate, createOwnedPet, migrateCharacterOwnedPets, rollBredOwnedPetTrait } from './_owned-pet.js';
import { petAcquisitionDestination } from './_placement.js';
import { getPetFromSanctuary, storePetInSanctuary } from './_sanctuary.js';

type HatchDestination = 'roster' | 'sanctuary';
type HatchReceipt = { sessionId: string; petId: string; destination?: HatchDestination };
type HatchResult =
    | { ok: true; character: Record<string, unknown>; pet: Record<string, unknown>; destination: HatchDestination; version: number; replayed: boolean; sealedKey?: string }
    | { ok: false; status: number; error: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const sessionId = String(body.sessionId ?? '').slice(0, 80);
        if (!playerName || !/^breed-[a-f0-9]{32}$/.test(sessionId)) return res.status(400).json({ error: 'invalid-hatch-request' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only hatch your own egg.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-breeding-hatch', 12, 60_000, identity.name))) return;
        const now = Date.now();
        const result = await withKvLock<HatchResult>(`save:${playerName}`, async () => {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const stored = record?.character as Record<string, unknown> | undefined;
            if (!record || !stored) return { ok: false, status: 404, error: 'player-save-not-found' };
            const migrated = migrateCharacterOwnedPets(playerName, stored);
            const settled = settlePetBreedingSession(migrated.character, now);
            const character = settled.character;
            const hatchReceipts = Array.isArray(character.petBreedingHatchReceipts)
                ? (character.petBreedingHatchReceipts as unknown[]).filter((entry): entry is HatchReceipt => Boolean(entry && typeof entry === 'object' && typeof (entry as HatchReceipt).sessionId === 'string')).slice(-31)
                : [];
            const prior = hatchReceipts.find((receipt) => receipt.sessionId === sessionId);
            if (prior) {
                const pet = (Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : []).find((entry) => String(entry.id ?? '') === prior.petId);
                if (pet) return { ok: true, character, pet, destination: 'roster', version: Number(record._saveVersion ?? 0), replayed: true };
                const sanctuaryPet = await getPetFromSanctuary(playerName, prior.petId);
                if (sanctuaryPet) return { ok: true, character, pet: sanctuaryPet.pet, destination: 'sanctuary', version: Number(record._saveVersion ?? 0), replayed: true };
            }
            const session = character.petBreeding as PetBreedingSession | null | undefined;
            if (!session || session.sessionId !== sessionId) return { ok: false, status: 404, error: 'breeding-session-not-found' };
            if (session.state !== 'egg') return { ok: false, status: 409, error: 'egg-not-ready' };
            if (!petBreedingRequirementsComplete(session)) return { ok: false, status: 409, error: 'hatch-requirements-incomplete' };
            const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
            const sealedKey = breedingResultKey(playerName, sessionId);
            const sealed = await kv.get<SealedPetBreedingResult>(sealedKey);
            if (!sealed || sealed.sessionId !== sessionId || sealed.playerName !== playerName) return { ok: false, status: 409, error: 'sealed-breeding-result-missing' };
            const generation = Math.max(sealed.parentGenerations[0], sealed.parentGenerations[1]) + 1;
            const childTemplate = canonicalPetTemplate(sealed.resultTemplateId);
            if (!childTemplate) return { ok: false, status: 409, error: 'sealed-breeding-template-missing' };
            // New eggs seal the trait at breeding start alongside species and
            // palette. The fallback keeps already-running pre-apex sessions valid.
            const trait = sealed.trait ?? rollBredOwnedPetTrait(childTemplate.rarity);
            const createdChild = createOwnedPet(sealed.resultTemplateId, {
                origin: 'bred',
                instanceId: `${sealed.resultTemplateId}:${sessionId}`,
                existingIds: pets.map((pet) => String(pet.id ?? '')),
                generation,
                parentInstanceIds: sealed.parentIds,
                parentTemplateIds: sealed.parentTemplateIds,
                hatchedAt: now,
                breedingSessionId: sessionId,
                trait,
                ...(sealed.chromatic ? { paletteVariantId: sealed.paletteVariantId } : {}),
            });
            const destination: HatchDestination = petAcquisitionDestination(character);
            const child = destination === 'sanctuary'
                ? (await storePetInSanctuary(playerName, createdChild, 'bred', now)).item.pet
                : createdChild;
            const receipts = Array.isArray(character.petBreedingReceipts)
                ? (character.petBreedingReceipts as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                : [];
            const nextCharacter = {
                ...character,
                pets: destination === 'roster' ? [...pets, child] : pets,
                petBreeding: null,
                petBreedingReceipts: [...receipts, `hatch:${sessionId}`],
                petBreedingHatchReceipts: [...hatchReceipts, { sessionId, petId: String(child.id), destination }],
                petBreedingProgressReceipts: undefined,
            };
            const written = await writeVersionedPlayerSave(`save:${playerName}`, record, nextCharacter);
            return { ok: true, character: nextCharacter, pet: child, destination, version: written._saveVersion, replayed: false, sealedKey };
        }, { failClosed: true });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (result.sealedKey) await kv.del(result.sealedKey).catch((error) => console.error('[pet/breeding/hatch] sealed cleanup', safeLogValue(error)));
        return res.status(200).json({ ok: true, replayed: result.replayed, destination: result.destination, pet: result.pet, character: result.character, _saveVersion: result.version });
    } catch (error) {
        console.error('[pet/breeding/hatch]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
