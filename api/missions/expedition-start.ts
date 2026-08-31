import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { activeBreedingParentIds } from '../pet/_pet-busy.js';
import { activeCarriedPetIds, PET_CAP_SUB } from '../_entitlements.js';
import { removePetItem } from '../pet/_progress.js';
import { currentPetHappiness } from '../pet/_happiness.js';
import {
    PET_EXPEDITION_DAILY_CAP,
    PET_EXPEDITION_PROVISION_RULES,
    PET_EXPEDITION_PROVISIONS,
    PET_EXPEDITION_RISK_RULES,
    PET_EXPEDITION_RISKS,
    PET_EXPEDITION_ROUTES,
    PET_EXPEDITION_TYPES,
    type PetExpeditionProvision,
    type PetExpeditionRisk,
    type PetExpeditionType,
} from '../../shared/pet-expedition-contract.js';
import { sectorBiomeOf, sectorName, sectorRegionLabel } from '../../shared/sector-geo.js';

/*
 * /api/missions/expedition-start - POST only
 *
 * The authoritative save commits the daily allowance, pet lease, and durable
 * launch receipt in ONE versioned write. A concurrent request that loses the
 * pet-busy race consumes nothing. Optional `launchId` (UUID) makes a lost HTTP
 * response replay the exact launch without another save bump or allowance use.
 */

const EXPEDITION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const EXPEDITION_START_RECEIPT_CAP = 64;

type ExpeditionStartReceipt = {
    token: string;
    petId: string;
    expType: PetExpeditionType;
    startedAt: number;
    endsAt: number;
    durationMinutes: number;
};

type ExpeditionStartDecision =
    | { receipt: ExpeditionStartReceipt; replayed: boolean; capped: false }
    | { receipt: null; replayed: false; capped: true };

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function expeditionStartReceipts(character: Record<string, unknown>): ExpeditionStartReceipt[] {
    if (!Array.isArray(character.expeditionStartReceipts)) return [];
    return (character.expeditionStartReceipts as unknown[]).filter((value): value is ExpeditionStartReceipt => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const receipt = value as Partial<ExpeditionStartReceipt>;
        return typeof receipt.token === 'string'
            && /^[A-Za-z0-9]+$/.test(receipt.token)
            && typeof receipt.petId === 'string'
            && PET_EXPEDITION_TYPES.includes(receipt.expType as PetExpeditionType)
            && Number.isSafeInteger(receipt.startedAt)
            && Number.isSafeInteger(receipt.endsAt)
            && Number.isSafeInteger(receipt.durationMinutes);
    });
}

function expeditionStartsToday(
    character: Record<string, unknown>,
    today: string,
    legacyStartedToday: number,
): number {
    const counter = character.expeditionStartAllowance;
    if (!counter || typeof counter !== 'object' || Array.isArray(counter)) return legacyStartedToday;
    const value = counter as { date?: unknown; count?: unknown };
    if (value.date !== today) return legacyStartedToday;
    const count = Number(value.count);
    return Number.isSafeInteger(count) && count > 0 ? Math.max(count, legacyStartedToday) : legacyStartedToday;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Pre-auth rate limit so spam at unknown names also throttles. The budget is
    // the supporter carried-pet cap, allowing every carried pet one launch.
    const bodyPeek = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'expedition-start', PET_CAP_SUB, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const expType = (body.expType && PET_EXPEDITION_TYPES.includes(body.expType)
            ? body.expType
            : null) as PetExpeditionType | null;
        const petIdRaw = typeof body.petId === 'string' ? body.petId.trim().slice(0, 64) : '';
        const petId = /^[A-Za-z0-9:_-]+$/.test(petIdRaw) ? petIdRaw : '';
        const risk = (PET_EXPEDITION_RISKS.includes(body.risk) ? body.risk : 'safe') as PetExpeditionRisk;
        const provision = (PET_EXPEDITION_PROVISIONS.includes(body.provision) ? body.provision : 'none') as PetExpeditionProvision;
        const launchIdRaw = typeof body.launchId === 'string' ? body.launchId.trim() : '';
        const launchId = /^[0-9a-f-]{36}$/i.test(launchIdRaw) ? launchIdRaw.toLowerCase() : '';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!expType) return res.status(400).json({ error: 'Invalid expedition type.' });
        if (!petId) return res.status(400).json({ error: 'Invalid pet id.' });
        if (launchIdRaw && !launchId) return res.status(400).json({ error: 'Invalid launchId.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own expeditions.' });
        }

        // The UUID is chosen before the save lock, so concurrent invocations of
        // the same request share one stable token. Legacy clients without a UUID
        // remain safe: an identical active lease is recognized as a replay.
        const requestedToken = (launchId || randomUUID()).replace(/-/g, '');
        const today = utcDateKey();
        const requestedAt = Date.now();
        // One-day deployment bridge: retain the old out-of-save counter so a
        // deploy cannot reset today's already-consumed allowance. New starts no
        // longer write this key; tomorrow the save-native counter resets itself.
        const legacyCountRaw = Number(await kv.get<number>(`pet-exp-start-count:${playerName}:${today}`) ?? 0);
        const legacyStartedToday = Number.isSafeInteger(legacyCountRaw) && legacyCountRaw > 0
            ? legacyCountRaw
            : 0;

        const mutation = await mutatePlayerSave<ExpeditionStartDecision>(playerName, ({ record, character }) => {
            const pets = Array.isArray(character.pets)
                ? character.pets as Array<Record<string, unknown>>
                : [];
            const petIndex = pets.findIndex((pet) => String(pet?.id ?? '') === petId);
            if (petIndex < 0) return { ok: false as const, status: 404, error: 'Pet not found.' };
            if (!activeCarriedPetIds(character, pets).includes(petId)) {
                return { ok: false as const, status: 409, error: 'Move this preserved companion into your carried roster before starting an expedition.' };
            }
            const pet = pets[petIndex];
            if (activeBreedingParentIds(character, requestedAt).has(petId)) {
                return { ok: false as const, status: 409, error: 'This pet is in the breeding barn.' };
            }

            const receipts = expeditionStartReceipts(character);
            const activeExpedition = pet.expedition && typeof pet.expedition === 'object'
                ? pet.expedition as Record<string, unknown>
                : null;
            const exactReceipt = receipts.find((receipt) => receipt.token === requestedToken);
            if (exactReceipt && activeExpedition?.token === requestedToken) {
                return {
                    ok: true as const,
                    character,
                    value: { receipt: exactReceipt, replayed: true, capped: false },
                    write: false,
                };
            }
            if (exactReceipt) {
                return { ok: false as const, status: 409, error: 'This launchId has already been settled or replaced.' };
            }
            // Old clients cannot send a stable UUID. Recover their lost response
            // only for the exact active pet/type and a protected server receipt.
            if (!launchId && activeExpedition) {
                const activeToken = String(activeExpedition.token ?? '');
                const priorReceipt = receipts.find((receipt) => receipt.token === activeToken);
                if (priorReceipt && priorReceipt.petId === petId && priorReceipt.expType === expType) {
                    return {
                        ok: true as const,
                        character,
                        value: { receipt: priorReceipt, replayed: true, capped: false },
                        write: false,
                    };
                }
            }

            const realLevel = Number(pet.level ?? 0);
            const realMaxLevel = Number(pet.maxLevel ?? 100);
            const isTamer = character.profession === 'petTamer';
            const petMaxed = realLevel >= realMaxLevel;
            if (realLevel < 20) return { ok: false as const, status: 409, error: 'Pet must reach level 20.' };
            if (pet.training || pet.expedition) return { ok: false as const, status: 409, error: 'Pet is already busy.' };
            // Gate on the happiness the pet ACTUALLY has, not the stored number:
            // happiness decays at every daily reset (shared/pet-happiness.ts), so a
            // pet stored at 7 that has missed a reset really holds 2 and must not
            // clear a 5-happiness bold route on a value it no longer owns.
            if (risk === 'bold' && currentPetHappiness(pet, requestedAt) < PET_EXPEDITION_RISK_RULES.bold.happinessCost) {
                return { ok: false as const, status: 409, error: `Bold routes require at least ${PET_EXPEDITION_RISK_RULES.bold.happinessCost} happiness.` };
            }

            const caravanBonus = masteryHasCapstone(
                character.profession,
                character.masterySpec,
                'caravan-master',
            ) ? 2 : 0;
            const startedToday = expeditionStartsToday(character, today, legacyStartedToday);
            if (startedToday >= PET_EXPEDITION_DAILY_CAP + caravanBonus) {
                return {
                    ok: true as const,
                    character,
                    value: { receipt: null, replayed: false, capped: true },
                    write: false,
                };
            }

            const rewardScale = isTamer ? 1 : petMaxed ? 0.5 : 0;
            // Pet level is always read from the saved pet. The client cannot
            // inflate the level term in the authoritative ryo formula.
            const sealedPetLevel = Math.max(1, Math.min(100, realLevel));
            const expRewardMult = isTamer
                ? 1 + masteryBonus(character.profession, character.masterySpec, 'expRewardPct') / 100
                : 1;
            const expMaterialMult = isTamer
                ? 1 + masteryBonus(character.profession, character.masterySpec, 'expMaterialPct') / 100
                : 1;
            const provisionedCharacter = provision === 'none'
                ? character
                : removePetItem(character, provision);
            if (!provisionedCharacter) {
                return { ok: false as const, status: 409, error: `${PET_EXPEDITION_PROVISION_RULES[provision].label} are no longer in your inventory.` };
            }
            const sector = Math.max(0, Math.floor(Number(record.currentSector ?? 0)));
            const place = (sectorName(sector) ?? 'the village outskirts').slice(0, 80);
            const region = (sectorRegionLabel(sector) ?? 'the surrounding country').slice(0, 80);
            const biome = (sector > 0 ? sectorBiomeOf(sector) : String(record.currentBiome ?? 'central')).slice(0, 24);
            const durationMinutes = PET_EXPEDITION_ROUTES[expType].durationMinutes;
            const endsAt = requestedAt + durationMinutes * 60_000;
            const receipt: ExpeditionStartReceipt = {
                token: requestedToken,
                petId,
                expType,
                startedAt: requestedAt,
                endsAt,
                durationMinutes,
            };
            const nextPets = pets.map((candidate, index) => index === petIndex ? {
                ...candidate,
                expedition: {
                    type: expType,
                    startedAt: requestedAt,
                    endsAt,
                    durationMs: durationMinutes * 60_000,
                    token: requestedToken,
                    risk,
                    provision,
                    sector,
                    place,
                    region,
                    biome,
                    choiceVersion: 1,
                    // Durable fallback authority if the acceleration token cache
                    // is unavailable. report-pet-event verifies this exact lease.
                    serverSeal: {
                        petLevel: sealedPetLevel,
                        expRewardMult,
                        expMaterialMult,
                        rewardScale,
                        tamer: isTamer,
                        risk,
                        provision,
                        sector,
                        place,
                        region,
                        biome,
                        choiceVersion: 1,
                    },
                },
            } : candidate);
            return {
                ok: true as const,
                character: {
                    ...provisionedCharacter,
                    pets: nextPets,
                    expeditionStartAllowance: { date: today, count: startedToday + 1 },
                    expeditionStartReceipts: [
                        ...receipts.slice(-(EXPEDITION_START_RECEIPT_CAP - 1)),
                        receipt,
                    ],
                },
                value: { receipt, replayed: false, capped: false },
            };
        });

        if (!mutation.ok) return res.status(mutation.status).json({ error: mutation.error });
        const finalCharacter = mutation.character;
        const isTamer = finalCharacter.profession === 'petTamer';
        if (mutation.value.capped || !mutation.value.receipt) {
            const dailyCap = PET_EXPEDITION_DAILY_CAP + (masteryHasCapstone(finalCharacter.profession, finalCharacter.masterySpec, 'caravan-master') ? 2 : 0);
            return res.status(200).json({
                ok: true,
                petTamer: isTamer,
                reason: 'daily-mint-cap',
                token: null,
                dailyStarts: dailyCap,
                dailyCap,
                resetAt: Date.parse(`${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`),
                character: finalCharacter,
                _saveVersion: mutation._saveVersion,
            });
        }

        const receipt = mutation.value.receipt;
        const committedPet = (Array.isArray(finalCharacter.pets)
            ? finalCharacter.pets as Array<Record<string, unknown>>
            : []).find((pet) => String(pet?.id ?? '') === receipt.petId);
        const expedition = committedPet?.expedition as Record<string, unknown> | undefined;
        const seal = expedition?.serverSeal as Record<string, unknown> | undefined;
        const tokenKey = `pet-exp-token:${playerName}:${receipt.token}`;
        await kv.set(tokenKey, {
            playerName,
            petId: receipt.petId,
            expType: receipt.expType,
            durationMinutes: receipt.durationMinutes,
            petLevel: Number(seal?.petLevel ?? committedPet?.level ?? 1),
            mintedAt: receipt.startedAt,
            endsAt: receipt.endsAt,
            expRewardMult: Number(seal?.expRewardMult ?? 1),
            expMaterialMult: Number(seal?.expMaterialMult ?? 1),
            rewardScale: Number(seal?.rewardScale ?? 0),
            tamer: seal?.tamer === true,
            risk: seal?.risk,
            provision: seal?.provision,
            sector: Number(seal?.sector ?? expedition?.sector ?? 0),
            place: String(seal?.place ?? expedition?.place ?? ''),
            region: String(seal?.region ?? expedition?.region ?? ''),
            biome: String(seal?.biome ?? expedition?.biome ?? ''),
            choiceVersion: Number(seal?.choiceVersion ?? 1),
        }, { ex: EXPEDITION_TOKEN_TTL_SECONDS });

        return res.status(200).json({
            ok: true,
            petTamer: isTamer,
            token: receipt.token,
            durationMinutes: receipt.durationMinutes,
            endsAt: receipt.endsAt,
            replayed: mutation.value.replayed,
            dailyStarts: Number((finalCharacter.expeditionStartAllowance as { count?: unknown } | undefined)?.count ?? 0),
            dailyCap: PET_EXPEDITION_DAILY_CAP + (masteryHasCapstone(finalCharacter.profession, finalCharacter.masterySpec, 'caravan-master') ? 2 : 0),
            resetAt: Date.parse(`${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`),
            character: finalCharacter,
            _saveVersion: mutation._saveVersion,
        });
    } catch (error) {
        console.error('[missions/expedition-start]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
