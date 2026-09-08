import { maxPets, activeCarriedPetIds } from '../_entitlements.js';
import { PET_IDENTITY_FIELDS } from './_state-ownership.js';
import { activeBreedingParentIds } from '../pet/_pet-busy.js';
import { petStatCeil } from '../_pet-stat-ceil.js';
import { copyStoredField } from './_sanitize-ledger.js';

export function sanitizePetRoster(
    char: Record<string, unknown>,
    exChar: Record<string, unknown>,
    strictLedger: boolean,
) {

    // Pet roster cap: a tampered client cannot grow the carried roster beyond
    // its entitlement. Subscriber-aware (Patreon perk): 5 for the base tier,
    // 6 for subscribers. Read the entitlement from the authoritative stored
    // character, never the incoming save payload.
    //
    // NON-DESTRUCTIVE downgrade: never truncate BELOW the already-stored roster,
    // so a lapsed subscriber (or a legacy larger roster) keeps every pet — the
    // cap only prevents GROWING past it. A legit base-tier roster is <=5, so a
    // tampered save still can't grow the roster past 5.
    const existingPets = Array.isArray(exChar.pets) ? exChar.pets as Array<Record<string, unknown>> : [];
    const PET_CAP = Math.max(maxPets(exChar), existingPets.length);
    const existingPetById = new Map(existingPets.map((pet) => [String(pet?.id ?? ''), pet]));
    const submittedPets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
    // PET_IDENTITY_FIELDS derives from the ownership manifest ('pet-identity'):
    // combat progression, timers, paid identity, and gear are all committed by
    // dedicated pet endpoints. A generic save cannot add/remove ownership or
    // train, feed, rename, equip, or fabricate expedition state.
    // Once strict settlement is enabled, pet identity and progression must
    // come from dedicated endpoints. Compatibility mode retains bounded legacy
    // pet rewards until every caller has migrated.
    char.pets = submittedPets
        .filter((pet) => {
            if (existingPetById.has(String(pet?.id ?? ''))) return true;
            if (strictLedger || existingPets.length > 0) return false;
            const stats = ['hp', 'attack', 'defense', 'speed'].map((field) => Number(pet?.[field]));
            return typeof pet?.id === 'string'
                && stats.every((value) => Number.isFinite(value) && value >= 1 && value <= 100)
                && !Array.isArray(pet.jutsus)
                && pet.level === undefined
                && pet.xp === undefined;
        })
        .map((pet) => {
            const stored = existingPetById.get(String(pet.id));
            if (!stored) return pet;
            const next = { ...pet };
            for (const field of PET_IDENTITY_FIELDS) {
                if (stored[field] !== undefined) next[field] = stored[field];
                else delete next[field];
            }
            return next;
        });
    // Defense in depth for older partial-save callers: a breeding parent stays
    // server-locked until readyAt. The authoritative rebuild below preserves all
    // owned pets; this also restores locked selections before that rebuild.
    const breedingLockedIds = activeBreedingParentIds(exChar, Date.now());
    if (breedingLockedIds.size > 0) {
        const keptIds = new Set((char.pets as Array<Record<string, unknown>>).map((pet) => String(pet.id ?? '')));
        for (const storedPet of existingPets) {
            const id = String(storedPet.id ?? '');
            if (breedingLockedIds.has(id) && !keptIds.has(id)) {
                (char.pets as Array<Record<string, unknown>>).push(storedPet);
                keptIds.add(id);
            }
        }
        for (const field of ['activePetId', 'activePetId2v2'] as const) {
            if (breedingLockedIds.has(String(char[field] ?? ''))) copyStoredField(char, exChar, field);
        }
    }
    // Generic, partial, or stale saves may neither remove nor reorder owned
    // pets. Roster membership/order changes only through dedicated pet and
    // Sanctuary endpoints, which can safely coordinate the ownership move.
    if (existingPets.length > 0) {
        const retainedById = new Map(
            (char.pets as Array<Record<string, unknown>>)
                .map((pet) => [String(pet?.id ?? ''), pet] as const)
                .filter(([id]) => Boolean(id)),
        );
        char.pets = existingPets.map((storedPet) =>
            retainedById.get(String(storedPet?.id ?? '')) ?? storedPet,
        );
    }
    const inPets = char.pets as Array<Record<string, unknown>>;
    if (inPets && inPets.length > PET_CAP) {
        const activeId = String(char.activePetId ?? '');
        const active = activeId ? inPets.find(p => String(p?.id) === activeId) : null;
        const others = inPets.filter(p => String(p?.id) !== activeId);
        const kept = active ? [active, ...others.slice(0, PET_CAP - 1)] : others.slice(0, PET_CAP);
        char.pets = kept;
    }
    // A generic save cannot rotate lapsed/legacy overflow into the current-use
    // 5/6 projection by changing active ids. Keep valid prior selections; swaps
    // happen by depositing/withdrawing through the Sanctuary.
    const eligibleStoredPetIds = new Set(activeCarriedPetIds(exChar, existingPets));
    const retainedPetIds = new Set(
        (char.pets as Array<Record<string, unknown>>)
            .map((pet) => String(pet?.id ?? ''))
            .filter(Boolean),
    );
    for (const field of ['activePetId', 'activePetId2v2'] as const) {
        const requestedId = String(char[field] ?? '');
        if (requestedId && eligibleStoredPetIds.has(requestedId) && retainedPetIds.has(requestedId)) continue;
        const previousId = String(exChar[field] ?? '');
        if (previousId && eligibleStoredPetIds.has(previousId) && retainedPetIds.has(previousId)) char[field] = previousId;
        else delete char[field];
    }

    // Pet stat ceiling: HP/ATK/DEF/SPD are uncapped client-side by design. Reset-era
    // growth reaches at most 2.4425× immutable base before species variance, so
    // the only guard against a
    // tampered save injecting absurd values into the deterministic ranked pet ladder
    // is a server clamp. Per-rarity at base*5 — well
    // above any legit build (native or evolved), far below the old flat 100k that
    // let a ~300x pet through. See _pet-stat-ceil.ts.
    if (Array.isArray(char.pets)) {
        for (const p of char.pets as Array<Record<string, unknown>>) {
            if (!p || typeof p !== 'object') continue;
            for (const k of ['hp', 'attack', 'defense', 'speed'] as const) {
                const v = Number(p[k]);
                if (Number.isFinite(v)) p[k] = Math.max(1, Math.min(petStatCeil(p.rarity, k), Math.round(v)));
            }
        }
    }
}
