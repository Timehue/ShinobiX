import { safeLogValue } from '../_safe-log.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { grantWildPet, type WildPetTrait } from './_encounter.js';
import { petAcquisitionDestination } from './_placement.js';
import { storePetInSanctuary } from './_sanctuary.js';
import { withKvLock } from '../_lock.js';
import {
    cleanPetEncounterPointer,
    petEncounterActiveKey,
    petEncounterRequestKey,
    PET_ENCOUNTER_POINTER_TTL_SECONDS,
} from './_encounter-pointer.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from '../world/_explore-authority.js';

type BefriendDestination = 'roster' | 'sanctuary';

const cleanToken = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9]{16,96}$/.test(v) ? v : '';
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const token = cleanToken(body.token);
        if (!playerName || !token) return res.status(400).json({ error: 'Invalid player or encounter token.' });
        const identity = playerName ? await authedPlayerOrAdmin(req, playerName) : null;
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-befriend', 20, 60_000, identity.name))) return;
        const key = `pet-encounter:${playerName}:${token}`;
        const result = await mutatePlayerSave<{ replayed: boolean; trait: WildPetTrait | null; destination: BefriendDestination | null; pet: Record<string, unknown> | null }>(playerName, async ({ character }) => {
            const receipts = Array.isArray(character.redeemedPetEncounters) ? character.redeemedPetEncounters as string[] : [];
            if (receipts.includes(token)) return { ok: true as const, character, value: { replayed: true, trait: null, destination: null, pet: null } };
            const encounter = await kv.get<{
                playerName: string;
                pet: Record<string, unknown>;
                sector?: number;
                exploreReceiptId?: string;
            }>(key);
            if (!encounter || encounter.playerName !== playerName) return { ok: false as const, status: 409, error: 'invalid-or-spent-encounter' };
            const exploreReceiptId = typeof encounter.exploreReceiptId === 'string' ? encounter.exploreReceiptId : '';
            const projectedExplored = exploreReceiptId && Array.isArray(character.redeemedSectorExplorations)
                && (character.redeemedSectorExplorations as Array<Record<string, unknown>>).some((entry) => entry?.id === exploreReceiptId);
            const durableExplore = exploreReceiptId
                ? cleanWorldExploreAuthorityReceipt(await kv.get(worldExploreAuthorityKey(playerName, exploreReceiptId)))
                : null;
            const encounterSector = Math.floor(Number(encounter.sector));
            const durableExplored = !!durableExplore
                && durableExplore.playerName.toLowerCase() === playerName.toLowerCase()
                && Number.isSafeInteger(encounterSector)
                && encounterSector >= 1
                && durableExplore.sector === encounterSector
                && durableExplore.outcome?.kind === 'external'
                && durableExplore.outcome?.source === 'pet';
            const explored = !!projectedExplored || durableExplored;
            if (!explored) return { ok: false as const, status: 409, error: 'pet-discovery-not-settled' };
            const granted = grantWildPet(character, encounter.pet, () => randomInt(1_000_000_000) / 1_000_000_000);
            if (!granted.ok) return { ok: false as const, status: 409, error: granted.reason };
            const destination: BefriendDestination = petAcquisitionDestination(character);
            const finalPet = destination === 'sanctuary'
                ? (await storePetInSanctuary(playerName, granted.pet, 'wild')).item.pet
                : granted.pet;
            const nextCharacter = destination === 'roster' ? granted.character : character;
            return {
                ok: true as const,
                character: { ...nextCharacter, redeemedPetEncounters: [...receipts.slice(-49), token] },
                value: { replayed: false, trait: finalPet.trait as WildPetTrait, destination, pet: finalPet },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const activeKey = petEncounterActiveKey(playerName);
        await withKvLock(activeKey, async () => {
            const active = cleanPetEncounterPointer(await kv.get(activeKey));
            const encounter = await kv.get<Record<string, unknown>>(key);
            const requestId = active?.outcome === 'hit' && active.token === token
                ? active.requestId
                : typeof encounter?.requestId === 'string'
                    ? encounter.requestId
                    : '';
            if (requestId) {
                const requestReceiptKey = petEncounterRequestKey(playerName, requestId);
                const request = await kv.get<Record<string, unknown>>(requestReceiptKey);
                if (request) {
                    await kv.set(requestReceiptKey, {
                        ...request,
                        resolvedAt: Date.now(),
                        resolution: 'befriended',
                    }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                }
            }
            await kv.del(key);
            if (active?.token === token) await kv.del(activeKey);
        }, { failClosed: true });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[pet/befriend]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
