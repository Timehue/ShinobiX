import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeLogValue } from '../_safe-log.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { petBreedingStartsEnabled } from '../_release-flags.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { buildSealedBreedingResult, breedingResultKey, deterministicBreedingSessionId, PET_BREEDING_DURATION_MS, publicPetBreedingSession, type SealedPetBreedingResult } from './_breeding.js';
import { settlePetBreedingSession, type PetBreedingSession } from './_breeding-requirements.js';
import { migrateCharacterOwnedPets, PET_BREEDING_RULES_VERSION } from './_owned-pet.js';
import { petBreedingEligibility } from './_pet-busy.js';
import { captureServerProductEvent } from '../_product-analytics.js';

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,96}$/;

type StartResult =
    | { ok: true; character: Record<string, unknown>; version: number; replayed: boolean }
    | { ok: false; status: number; error: string; message?: string };

function defensePetIds(defense: unknown): string[] {
    if (!defense || typeof defense !== 'object') return [];
    const pets = (defense as { pets?: unknown }).pets;
    return Array.isArray(pets) ? pets.map((pet) => String((pet as Record<string, unknown>)?.id ?? '')).filter(Boolean) : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const parent1Id = String(body.parent1Id ?? '').slice(0, 96);
        const parent2Id = String(body.parent2Id ?? '').slice(0, 96);
        const requestId = String(body.requestId ?? '');
        if (!playerName || !parent1Id || !parent2Id || !REQUEST_ID_RE.test(requestId)) return res.status(400).json({ error: 'invalid-breeding-request' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only use your own breeding barn.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-breeding-start', 8, 60_000, identity.name))) return;
        const now = Date.now();
        const result = await withKvLock<StartResult>(`save:${playerName}`, async () => {
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const stored = record?.character as Record<string, unknown> | undefined;
            if (!record || !stored) return { ok: false, status: 404, error: 'player-save-not-found' };
            const migrated = migrateCharacterOwnedPets(playerName, stored);
            const settled = settlePetBreedingSession(migrated.character, now);
            const character = settled.character;
            const existing = character.petBreeding as PetBreedingSession | null | undefined;
            if (existing) {
                if (existing.startRequestId === requestId) {
                    return { ok: true, character, version: Number(record._saveVersion ?? 0), replayed: true };
                }
                return { ok: false, status: 409, error: 'breeding-barn-occupied' };
            }
            const receipts = Array.isArray(character.petBreedingReceipts)
                ? (character.petBreedingReceipts as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                : [];
            if (receipts.includes(`start:${requestId}`)) return { ok: false, status: 409, error: 'breeding-request-already-completed' };
            if (!petBreedingStartsEnabled()) return { ok: false, status: 503, error: 'breeding-starts-disabled' };
            if (parent1Id === parent2Id) return { ok: false, status: 400, error: 'parents-must-be-distinct' };
            const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
            const parent1 = pets.find((pet) => String(pet.id ?? '') === parent1Id);
            const parent2 = pets.find((pet) => String(pet.id ?? '') === parent2Id);
            if (!parent1 || !parent2) return { ok: false, status: 404, error: 'parent-not-owned' };
            const [activeBattle, coliseumDefense, tacticalDefense] = await Promise.all([
                kv.get(`battle-lock:${playerName}`),
                kv.get(`petladder:coliseum:def:${playerName}`),
                kv.get(`petladder:tactical:def:${playerName}`),
            ]);
            if (activeBattle) {
                return { ok: false, status: 409, error: 'pet-is-in-active-battle', message: 'Finish or resume your active battle before committing companions to breeding.' };
            }
            const assignmentIds = [...defensePetIds(coliseumDefense), ...defensePetIds(tacticalDefense)];
            const eligible1 = petBreedingEligibility(character, parent1, now, { assignmentIds });
            if (!eligible1.ok) return { ok: false, status: 409, error: eligible1.code, message: eligible1.message };
            const eligible2 = petBreedingEligibility(character, parent2, now, { assignmentIds });
            if (!eligible2.ok) return { ok: false, status: 409, error: eligible2.code, message: eligible2.message };
            if (eligible1.element !== eligible2.element) return { ok: false, status: 409, error: 'element-mismatch' };

            const sessionId = deterministicBreedingSessionId(playerName, requestId);
            const sealedKey = breedingResultKey(playerName, sessionId);
            const recovered = await kv.get<SealedPetBreedingResult>(sealedKey);
            if (recovered && (recovered.requestId !== requestId
                || recovered.parentIds[0] !== parent1Id
                || recovered.parentIds[1] !== parent2Id)) {
                return { ok: false, status: 409, error: 'breeding-request-conflict' };
            }
            const sealed = recovered ?? buildSealedBreedingResult({ playerName, requestId, parent1, parent2, now });
            if (!recovered) await kv.set(sealedKey, sealed);
            const session: PetBreedingSession = {
                sessionId: sealed.sessionId,
                state: 'breeding',
                parentIds: [parent1Id, parent2Id],
                parentNames: [String(parent1.nickname || parent1.name || 'Parent 1'), String(parent2.nickname || parent2.name || 'Parent 2')],
                parentElement: eligible1.element,
                startedAt: sealed.createdAt,
                readyAt: sealed.createdAt + PET_BREEDING_DURATION_MS,
                rulesVersion: PET_BREEDING_RULES_VERSION,
                startRequestId: requestId,
            };
            const nextPets = pets.map((pet) => {
                if (pet !== parent1 && pet !== parent2) return pet;
                return { ...pet, breedingUsesRemaining: Number(pet.breedingUsesRemaining) - 1 };
            });
            const nextCharacter = {
                ...character,
                pets: nextPets,
                petBreeding: session,
                petBreedingReceipts: [...receipts, `start:${requestId}`],
            };
            const written = await writeVersionedPlayerSave(`save:${playerName}`, record, nextCharacter);
            return { ok: true, character: nextCharacter, version: written._saveVersion, replayed: Boolean(recovered) };
        }, { failClosed: true });
        if (!result.ok) return res.status(result.status).json({ error: result.error, ...(result.message ? { message: result.message } : {}) });
        if (!result.replayed) captureServerProductEvent('pet_breeding_started', { source: 'breeding_barn' });
        return res.status(200).json({
            ok: true,
            replayed: result.replayed,
            session: publicPetBreedingSession(result.character.petBreeding as PetBreedingSession),
            character: result.character,
            _saveVersion: result.version,
            serverTime: now,
        });
    } catch (error) {
        console.error('[pet/breeding/start]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
