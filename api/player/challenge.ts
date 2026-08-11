import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomBytes } from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';
import { challengeBlock } from '../_realtime/presence-gating.js';
import { kickPlayer } from '../_realtime/notify.js';
import { PET_RANKED_DISABLED_REASON, petRankedPublicChallengesEnabled } from '../pet/_ranked-settlement.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petCombatBusyReason, type PetCombatBusyCode } from '../pet/_pet-busy.js';
import { blockRelationship } from './_blocks.js';
import {
    getPlayerRankedAdmission,
    isPlayerRankedMatchId,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    releaseQueuedPlayerRankedAdmission,
    type PlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import { PLAYER_RANKED_V2_DISABLED_MESSAGE, playerRankedV2AdmissionsEnabled } from '../pvp/_player-ranked-rollout.js';
import {
    cancelChallengeRecord,
    isChallengeId,
    isPlayerChallengeMode,
    loadChallengeRecord,
    resolveChallengeRecord,
    saveChallengeRecord,
    type AuthoritativeChallengeRecord,
} from '../pvp/_challenge-authorization.js';
import {
    parseWarfrontAuthoredSetup,
    type WarfrontAuthoredSetup,
} from '../pet/_warfront-setup.js';

const CHALLENGE_TTL = 180; // seconds (3 min) — challenge auto-cancels if unanswered
export const ARENA_MATCH_RECOVERY_TTL_SECONDS = 60 * 60;
const MAX_CHALLENGE_BODY_BYTES = 512 * 1024;
const MAX_CHALLENGE_INBOX = 20;
const CHALLENGE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const CHALLENGE_MODES = new Set(['standard', 'ranked', 'clanWar1v1', 'clanWar2v2', 'clanWarPet', 'rankedPet']);
const CHALLENGE_FIELDS = new Set([
    'id', 'fromName', 'toName', 'challenger', 'challengerJutsus', 'challengerBloodlineMult',
    'challengerPetId', 'petBattleSeed', 'responderPetId', 'responderPet', 'petParty',
    'challengerPetIds', 'responderPetIds', 'responderParty', 'arenaMatch', 'arenaSize',
    'challengerTeamIds', 'responderTeam', 'challengerWarfrontSetup', 'responderWarfrontSetup',
    'challengerSetupSealed', 'createdAt', 'mode', 'clanWarPoints', 'challengerPetRating',
    'responderPetRating', 'petRankedToken', 'sectorAttack', 'rankedMatchId',
    'rankedSeasonId', 'rankedSeasonEpoch', 'kageChallengeId', 'kageVillage', 'battleId',
    'accepted', 'declined',
]);
const SHARED_SETUP_FIELDS = new Set([
    'stance', 'doctrine', 'buyPolicy', 'deployment', 'buildPackage',
    'coachOrder', 'objectiveTechnique', 'counterstrike',
]);

type SharedWarfrontSetup = {
    stance: 'balanced' | 'siege' | 'jungle' | 'headhunt' | 'turtle';
    doctrine: 'none' | 'vanguard' | 'bulwark' | 'zealot' | 'warden-pact';
    buyPolicy: 'balanced' | 'offense' | 'defense';
} & WarfrontAuthoredSetup;
type SealedArenaSetup = {
    challengerName: string;
    responderName: string;
    setup: SharedWarfrontSetup;
    challenger: unknown;
    challengerTeamIds: string[];
    arenaSize: 2 | 4;
    petBattleSeed: number;
    clientCreatedAt: number;
    accepted?: {
        responderSetup: SharedWarfrontSetup;
        responderTeam: unknown;
    };
};
type ArenaSetupTombstone = {
    status: 'cancelled';
    challengerName: string;
    responderName: string;
    clientCreatedAt: number;
    cancelledAt: number;
};
type StoredArenaSetup = SealedArenaSetup | ArenaSetupTombstone;
type ArenaMatchRecovery = {
    version: 1;
    challengeId: string;
    challengerName: string;
    responderName: string;
    acceptedAt: number;
    expiresAt: number;
    challenge: Record<string, unknown>;
};

function arenaMatchRecoveryKey(id: string): string {
    return `arena-match-recovery:${id.slice(0, 128)}`;
}

function isArenaMatchRecovery(value: unknown, id: string): value is ArenaMatchRecovery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as Partial<ArenaMatchRecovery>;
    return item.version === 1
        && item.challengeId === id
        && typeof item.challengerName === 'string'
        && typeof item.responderName === 'string'
        && typeof item.acceptedAt === 'number'
        && typeof item.expiresAt === 'number'
        && item.expiresAt > Date.now()
        && Boolean(item.challenge && typeof item.challenge === 'object' && !Array.isArray(item.challenge));
}

function acceptedArenaChallenge(id: string, secret: SealedArenaSetup): Record<string, unknown> | null {
    if (!secret.accepted) return null;
    return {
        id,
        arenaMatch: true,
        mode: 'clanWarPet',
        accepted: true,
        declined: false,
        createdAt: secret.clientCreatedAt,
        fromName: secret.responderName,
        toName: secret.challengerName,
        challenger: secret.challenger,
        challengerTeamIds: secret.challengerTeamIds,
        arenaSize: secret.arenaSize,
        petBattleSeed: secret.petBattleSeed,
        responderTeam: secret.accepted.responderTeam,
        challengerWarfrontSetup: secret.setup,
        responderWarfrontSetup: secret.accepted.responderSetup,
        challengerSetupSealed: true,
    };
}

/** The challenges:* inbox is a broad Realtime delivery surface. Acceptance
 * carries only a wake-up signal there; the simultaneous reveal stays in the
 * authenticated, participant-only recovery record. The responder still gets
 * the full canonical reveal in its authenticated POST response. */
function acceptedArenaInboxNotice(challenge: Record<string, unknown>): Record<string, unknown> {
    return {
        id: challenge.id,
        arenaMatch: true,
        accepted: true,
        declined: false,
        fromName: challenge.fromName,
        toName: challenge.toName,
        challengerSetupSealed: true,
        recoveryRequired: true,
    };
}

export function petById(character: Record<string, unknown> | null, id: string): Record<string, unknown> | null {
    if (!character || !id) return null;
    const found = activeCarriedPets<Record<string, unknown>>(character)
        .find((pet) => pet && typeof pet === 'object' && !Array.isArray(pet) && String(pet.id ?? '') === id);
    return found && typeof found === 'object' && !Array.isArray(found) ? found : null;
}

export function selectedCombatPetBusyReason(
    character: Record<string, unknown> | null,
    ids: Iterable<string>,
): PetCombatBusyCode | null {
    if (!character) return null;
    for (const id of ids) {
        const pet = petById(character, id);
        if (!pet) continue;
        const busy = petCombatBusyReason(character, pet);
        if (busy) return busy;
    }
    return null;
}

function bodyByteLength(body: unknown): number {
    if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
    try { return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8'); } catch { return MAX_CHALLENGE_BODY_BYTES + 1; }
}

function unexpectedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
    return Object.keys(value).filter((key) => !allowed.has(key));
}

export function validateChallengeShape(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Challenge must be an object.';
    const record = value as Record<string, unknown>;
    const unknown = unexpectedKeys(record, CHALLENGE_FIELDS);
    if (unknown.length) return `Unsupported challenge field: ${unknown[0]}.`;
    if (!CHALLENGE_ID_RE.test(String(record.id ?? ''))) return 'Challenge id is invalid.';
    if (record.mode !== undefined && !CHALLENGE_MODES.has(String(record.mode))) return 'Challenge mode is invalid.';
    if (record.challengerJutsus !== undefined && (!Array.isArray(record.challengerJutsus)
        || record.challengerJutsus.length > 16
        || record.challengerJutsus.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)))) return 'Challenge jutsu loadout is invalid.';
    for (const field of ['challengerTeamIds', 'responderTeam'] as const) {
        const list = record[field];
        if (list !== undefined && (!Array.isArray(list) || list.length > 4)) return `Challenge ${field} is invalid.`;
    }
    for (const field of ['challengerPetIds', 'responderPetIds', 'responderParty'] as const) {
        const list = record[field];
        if (list !== undefined && (!Array.isArray(list) || list.length > 2)) return `Challenge ${field} is invalid.`;
    }
    for (const field of ['challengerTeamIds', 'challengerPetIds', 'responderPetIds'] as const) {
        const list = record[field];
        if (Array.isArray(list) && list.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 128)) {
            return `Challenge ${field} is invalid.`;
        }
    }
    for (const field of ['fromName', 'toName', 'challengerPetId', 'responderPetId'] as const) {
        const item = record[field];
        if (item !== undefined && (typeof item !== 'string' || item.length < 1 || item.length > 128)) return `Challenge ${field} is invalid.`;
    }
    for (const field of ['battleId', 'petRankedToken', 'rankedMatchId', 'kageChallengeId', 'kageVillage'] as const) {
        const item = record[field];
        if (item !== undefined && (typeof item !== 'string' || item.length > 256)) return `Challenge ${field} is invalid.`;
    }
    for (const field of ['arenaMatch', 'petParty', 'challengerSetupSealed', 'sectorAttack', 'accepted', 'declined'] as const) {
        const item = record[field];
        if (item !== undefined && typeof item !== 'boolean') return `Challenge ${field} is invalid.`;
    }
    if (record.accepted === true && record.declined === true) return 'Challenge cannot be both accepted and declined.';
    if (record.arenaSize !== undefined && record.arenaSize !== 2 && record.arenaSize !== 4) return 'Challenge arenaSize is invalid.';
    for (const field of ['petBattleSeed', 'createdAt', 'clanWarPoints', 'challengerPetRating', 'responderPetRating', 'challengerBloodlineMult', 'rankedSeasonId', 'rankedSeasonEpoch'] as const) {
        const item = record[field];
        if (item !== undefined && (typeof item !== 'number' || !Number.isFinite(item))) return `Challenge ${field} is invalid.`;
    }
    for (const field of ['challengerWarfrontSetup', 'responderWarfrontSetup'] as const) {
        const item = record[field];
        if (item === undefined) continue;
        if (!item || typeof item !== 'object' || Array.isArray(item)
            || unexpectedKeys(item as Record<string, unknown>, SHARED_SETUP_FIELDS).length
            || !parseSharedWarfrontSetup(item)) return `Challenge ${field} is invalid.`;
    }
    return null;
}

function referencedChallengerPetIds(record: Record<string, unknown>): string[] {
    const values = record.arenaMatch === true
        ? record.challengerTeamIds
        : record.petParty === true
            ? record.challengerPetIds
            : record.challengerPetId !== undefined ? [record.challengerPetId] : [];
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map((value) => String(value ?? '').slice(0, 128)).filter(Boolean))].slice(0, 4);
}

function isArenaSetupTombstone(value: StoredArenaSetup | null): value is ArenaSetupTombstone {
    return Boolean(value && 'status' in value && value.status === 'cancelled');
}

function cancelledArenaSetup(secret: SealedArenaSetup): ArenaSetupTombstone {
    return {
        status: 'cancelled',
        challengerName: secret.challengerName,
        responderName: secret.responderName,
        clientCreatedAt: secret.clientCreatedAt,
        cancelledAt: Date.now(),
    };
}

export function parseSharedWarfrontSetup(value: unknown): SharedWarfrontSetup | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const setup = value as Partial<SharedWarfrontSetup>;
    if (!['balanced', 'siege', 'jungle', 'headhunt', 'turtle'].includes(String(setup.stance))) return null;
    if (!['none', 'vanguard', 'bulwark', 'zealot', 'warden-pact'].includes(String(setup.doctrine))) return null;
    if (!['balanced', 'offense', 'defense'].includes(String(setup.buyPolicy))) return null;
    const authored = parseWarfrontAuthoredSetup(value);
    if (!authored) return null;
    // Store a canonical projection rather than the caller's object. Both
    // players therefore reveal the same bounded setup, with deterministic
    // authored defaults for a legacy three-field challenge.
    return {
        stance: setup.stance as SharedWarfrontSetup['stance'],
        doctrine: setup.doctrine as SharedWarfrontSetup['doctrine'],
        buyPolicy: setup.buyPolicy as SharedWarfrontSetup['buyPolicy'],
        ...authored,
    };
}

function sealedArenaSetupKey(id: string): string {
    return `arena-challenge-setup:${id.slice(0, 128)}`;
}

// Public projection for the challenger character stored alongside a
// challenges:<name> entry. Keep the broad Realtime delivery surface minimal,
// so the FULL challenger
// character — including ryo, jutsu, equipment, stats — would otherwise
// would be unnecessary private data on that delivery path. Strip down to the bare
// minimum the recipient's inbox needs to render: name, level, village,
// avatar, cosmetic title, ranked rating.
const CHALLENGER_PUBLIC_FIELDS = new Set<string>([
    'name', 'level', 'village', 'specialty',
    'avatarImage', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'rankedRating',
    'clan',
    // Pet-challenge accept handlers (App.tsx :9090, :9107, :17624,
    // :17635, :36432) read challenge.challenger.pets to find the
    // matching pet by id at accept time. Stripping it broke every
    // pet challenge (TypeError on .find).
    'pets',
]);
// Inline base64 (data:) images are unnecessary bulk on the Realtime delivery
// path (a live challenge with a
// full avatar + pet sprites measured ~450KB). Hosted-URL image refs are fine
// (small, already public) — only inline `data:` blobs are stripped. Pets keep
// their combat stats (the accept handler matches by id and needs them) but lose
// inline sprite blobs. The recipient resolves avatars/pet art by name from the
// shared-image cache, same as presence does.
function isInlineImage(v: unknown): boolean {
    return typeof v === 'string' && v.startsWith('data:');
}
const CHALLENGE_PET_FIELDS = new Set([
    'id', 'name', 'rarity', 'level', 'xp', 'maxLevel', 'hp', 'attack', 'defense',
    'speed', 'moveRange', 'element', 'role', 'jutsus', 'unlockedForPve',
    'expedition', 'templateId', 'evolutionStage', 'paletteVariantId', 'image', 'bodyImage',
]);
function projectChallengeJutsus(value: unknown): unknown[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const source = entry as Record<string, unknown>;
        return {
            name: String(source.name ?? 'Technique').slice(0, 80),
            kind: String(source.kind ?? 'damage').slice(0, 32),
            power: Math.max(0, Math.min(100_000, Number.isFinite(Number(source.power)) ? Number(source.power) : 0)),
            cooldown: Math.max(0, Math.min(100, Number.isFinite(Number(source.cooldown)) ? Number(source.cooldown) : 0)),
            currentCooldown: Math.max(0, Math.min(100, Number.isFinite(Number(source.currentCooldown)) ? Number(source.currentCooldown) : 0)),
        };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}
function projectChallengePet(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of CHALLENGE_PET_FIELDS) {
        if (!(key in source)) continue;
        const item = source[key];
        if ((key === 'image' || key === 'bodyImage')) {
            if (!isInlineImage(item) && typeof item === 'string' && item.length <= 2_048) out[key] = item;
        } else if (key === 'jutsus') {
            out.jutsus = projectChallengeJutsus(item);
        } else if (typeof item === 'string') {
            out[key] = item.slice(0, key === 'name' ? 80 : 128);
        } else if (typeof item === 'number' && Number.isFinite(item)) {
            out[key] = Math.max(-100_000, Math.min(100_000, item));
        } else if (typeof item === 'boolean') {
            out[key] = item;
        }
    }
    return typeof out.id === 'string' && out.id ? out : null;
}
function stripPetInlineImages(pets: unknown): unknown {
    if (!Array.isArray(pets)) return pets;
    return pets.slice(0, 4).map(projectChallengePet).filter(Boolean);
}
function projectChallengerCharacterValue(c: unknown, entitlementFiltered: boolean): unknown {
    if (!c || typeof c !== 'object') return c;
    const src = c as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS) {
        if (!(k in src)) continue;
        const item = src[k];
        out[k] = typeof item === 'string' ? item.slice(0, 256) : item;
    }
    if (isInlineImage(out.avatarImage)) delete out.avatarImage;
    if ('pets' in out) {
        const pets = entitlementFiltered
            ? out.pets
            : activeCarriedPets<Record<string, unknown>>(src);
        out.pets = stripPetInlineImages(pets);
    }
    return out;
}

export function projectChallengerCharacter(c: unknown): unknown {
    return projectChallengerCharacterValue(c, false);
}

function projectChallenge(c: unknown): unknown {
    if (!c || typeof c !== 'object') return c;
    const rec = c as Record<string, unknown>;
    const out: Record<string, unknown> = { ...rec };
    if ('challenger' in rec) out.challenger = projectChallengerCharacterValue(rec.challenger, true);
    if ('challengerJutsus' in rec) out.challengerJutsus = projectChallengeJutsus(rec.challengerJutsus);
    if ('responderPet' in rec) out.responderPet = projectChallengePet(rec.responderPet);
    if ('responderParty' in rec) out.responderParty = stripPetInlineImages(rec.responderParty);
    if ('responderTeam' in rec) out.responderTeam = stripPetInlineImages(rec.responderTeam);
    return out;
}

function challengeKey(name: string) {
    return `challenges:${safeName(name)}`;
}

function outgoingKey(name: string) {
    return `challenge-outgoing:${safeName(name)}`;
}

type OutgoingChallenge = {
    targetName?: string;
    challengeId?: string;
    createdAt?: number;
    clientCreatedAt?: number;
    terminal?: { responderName: string; status: 'accepted' | 'declined' };
};
type GenericTerminalRecord = {
    version: 1;
    challengeId: string;
    challengerName: string;
    responderName: string;
    status: 'accepted' | 'declined';
    challenge: Record<string, unknown>;
};
type ChallengePvpSession = {
    battleId?: string;
    challengeId?: string;
    status?: string;
    winner?: unknown;
    p1?: { name?: string; character?: { name?: string } };
    p2?: { name?: string; character?: { name?: string } };
    realFighters?: { p1?: boolean; p2?: boolean };
};

function genericTerminalKey(challengerName: string, id: string): string {
    return `challenge-terminal:${safeName(challengerName)}:${id.slice(0, 128)}`;
}

function freshArenaSeed(): number {
    return (randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1;
}

function outgoingMatches(value: OutgoingChallenge | null, id: string, targetName?: string): boolean {
    return Boolean(value
        && value.challengeId === id
        && (!targetName || safeName(String(value.targetName ?? '')) === safeName(targetName)));
}

function challengeId(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'id' in challenge
        ? String((challenge as { id?: unknown }).id ?? '')
        : '';
}

function challengeFromName(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'fromName' in challenge
        ? String((challenge as { fromName?: unknown }).fromName ?? '').trim()
        : '';
}

function challengeToName(challenge: unknown) {
    return challenge && typeof challenge === 'object' && 'toName' in challenge
        ? String((challenge as { toName?: unknown }).toName ?? '').trim()
        : '';
}

// Server-clamp clanWarPoints to the mode's legal value. Without this,
// a malicious challenger could set clanWarPoints: 9999 on the body and
// the client's `addClanWarPoints` call after a win would credit the
// inflated value to the clan leaderboard.
//
// Keep in sync with the client's challengePlayer() call sites
// (App.tsx ~33901-33903):
//   clanWar1v1 → +50
//   clanWar2v2 → +100
//   clanWarPet → +25
//   anything else → 0
const CLAN_WAR_POINTS_BY_MODE: Record<string, number> = {
    clanWar1v1: 50,
    clanWar2v2: 100,
    clanWarPet: 25,
};

function clampClanWarPoints(challenge: unknown): unknown {
    if (!challenge || typeof challenge !== 'object') return challenge;
    const rec = challenge as Record<string, unknown>;
    const mode = String(rec.mode ?? '');
    const cap = CLAN_WAR_POINTS_BY_MODE[mode] ?? 0;
    if (typeof rec.clanWarPoints !== 'number' && rec.clanWarPoints !== undefined) {
        // Non-number — coerce to 0.
        return { ...rec, clanWarPoints: 0 };
    }
    const pts = Number(rec.clanWarPoints ?? 0);
    if (!Number.isFinite(pts) || pts <= 0) {
        // Strip any falsy or NaN value so downstream UI doesn't choke.
        if ('clanWarPoints' in rec) {
            const { clanWarPoints: _drop, ...rest } = rec;
            void _drop;
            return rest;
        }
        return rec;
    }
    if (pts > cap) {
        return { ...rec, clanWarPoints: cap };
    }
    return rec;
}

async function releaseRankedChallengeAdmission(record: AuthoritativeChallengeRecord): Promise<void> {
    if (record.mode !== 'ranked') return;
    const rawMatchId = record.challenge.rankedMatchId;
    const matchId = typeof rawMatchId === 'string' ? rawMatchId.trim().slice(0, 100) : '';
    if (!isPlayerRankedMatchId(matchId)) return;
    await releaseQueuedPlayerRankedAdmission(kv, matchId, record.from);
}

async function secureChallengeHandler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store, private');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        if (req.method === 'GET') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'arena-match-recovery', 30, 60_000, identity.name, { strict: true }))) return;
            const id = String(req.query.challengeId ?? '').trim();
            if (!CHALLENGE_ID_RE.test(id)) return res.status(400).json({ error: 'Challenge id is invalid.' });
            const recoveryKey = arenaMatchRecoveryKey(id);
            let recovery = await kv.get<ArenaMatchRecovery>(recoveryKey);

            // Repair the one possible crash window: acceptance and its private
            // reveal were committed, but the HTTP response/recovery write was
            // interrupted. The sealed setup contains both authoritative plans,
            // rosters, parties, and seed, so reconstruction reveals nothing new.
            if (!isArenaMatchRecovery(recovery, id)) {
                const stored = await kv.get<StoredArenaSetup>(sealedArenaSetupKey(id));
                if (!stored || isArenaSetupTombstone(stored)) {
                    return res.status(404).json({ error: 'Accepted Arena match recovery was not found or expired.', code: 'arena-match-recovery-missing' });
                }
                if (!stored.accepted) {
                    return res.status(409).json({ error: 'This Arena challenge has not been accepted yet.', code: 'arena-match-not-accepted', retryAfterMs: 500 });
                }
                const challenge = acceptedArenaChallenge(id, stored)!;
                const acceptedAt = Date.now();
                const repaired: ArenaMatchRecovery = {
                    version: 1,
                    challengeId: id,
                    challengerName: stored.challengerName,
                    responderName: stored.responderName,
                    acceptedAt,
                    expiresAt: acceptedAt + ARENA_MATCH_RECOVERY_TTL_SECONDS * 1000,
                    challenge,
                };
                recovery = await withKvLock(recoveryKey, async () => {
                    const current = await kv.get<ArenaMatchRecovery>(recoveryKey);
                    if (isArenaMatchRecovery(current, id)) return current;
                    await kv.set(recoveryKey, repaired, { ex: ARENA_MATCH_RECOVERY_TTL_SECONDS });
                    return repaired;
                }, { failClosed: true });
            }
            const me = identity.admin ? safeName(String(req.query.name ?? '')) : identity.name;
            if (!identity.admin && me !== recovery.challengerName && me !== recovery.responderName) {
                return res.status(403).json({ error: 'Only the accepted match participants may recover this reveal.' });
            }
            return res.status(200).json({ ok: true, recovered: true, challenge: recovery.challenge });
        }

        if (bodyByteLength(req.body) > MAX_CHALLENGE_BODY_BYTES) {
            return res.status(413).json({ error: 'Challenge payload is too large.' });
        }
        const rate = req.method === 'DELETE'
            ? { bucket: 'player-challenge-delete', limit: 30 }
            : { bucket: 'player-challenge-write', limit: 20 };
        if (!identity.admin && !(await enforceRateLimitKv(req, res, rate.bucket, rate.limit, 60_000, identity.name, { strict: true }))) return;

        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const body = parsed.body as Record<string, unknown>;

        if (req.method === 'DELETE') {
            const extra = unexpectedKeys(body as Record<string, unknown>, new Set(['targetName', 'challengeId', 'fromName']));
            if (extra.length) return res.status(400).json({ error: `Unsupported request field: ${extra[0]}.` });
            const { targetName, challengeId: id, fromName } = body as { targetName?: string; challengeId?: string; fromName?: string };
            const normalizedId = typeof id === 'string' ? id.trim() : '';
            if (!targetName || !fromName || !isChallengeId(normalizedId)) {
                return res.status(400).json({ error: 'targetName, fromName, and a valid challengeId are required.' });
            }
            const requestedTarget = targetName ? safeName(targetName) : '';
            const requestedFrom = fromName ? safeName(fromName) : '';
            const authoritative = await loadChallengeRecord(normalizedId);
            if (!authoritative) return res.status(404).json({ error: 'Challenge not found or expired.' });
            const resolved = authoritative.status === 'accepted' || authoritative.status === 'declined';
            const expectedTarget = resolved ? authoritative.from : authoritative.to;
            const expectedFrom = resolved ? authoritative.to : authoritative.from;
            if (requestedTarget !== expectedTarget || requestedFrom !== expectedFrom) {
                return res.status(409).json({ error: 'Challenge participants do not match the stored challenge.' });
            }
            if (!identity.admin && identity.name !== authoritative.from && identity.name !== authoritative.to) {
                return res.status(403).json({ error: 'Cannot clear another player\'s challenge.' });
            }
            if (authoritative.status === 'session-started' && !identity.admin && identity.name === authoritative.from) {
                return res.status(409).json({ error: 'That accepted battle has already started.' });
            }
            let matchedChallenge: unknown = null;
            let storedFrom = '';
            let storedTo = '';
            let inboxDeleteDenied = false;

            // The body only locates a candidate inbox. Authorization comes from
            // that stored challenge's actual parties so a caller cannot spoof
            // fromName and remove another player's notice. An accepted Arena
            // reveal is stricter: only its recipient may consume it.
            const pendingKey = requestedTarget ? challengeKey(requestedTarget) : '';
            // Lock the recipient's inbox during the read-filter-write so a
            // concurrent POST adding a new challenge can't be silently
            // overwritten by our DELETE (or vice versa).
            if (pendingKey) {
                await withKvLock(pendingKey, async () => {
                    const existing = await kv.get<unknown[]>(pendingKey) ?? [];
                    const matched = existing.find(challenge => challengeId(challenge) === normalizedId);
                    if (!matched) return;

                    const actualFrom = safeName(challengeFromName(matched));
                    const actualTo = safeName(challengeToName(matched));
                    const challengeRecord = matched as Record<string, unknown>;
                    const acceptedArenaNotice = challengeRecord.arenaMatch === true && challengeRecord.accepted === true;
                    const callerIsSender = !identity.admin && Boolean(actualFrom) && identity.name === actualFrom;
                    const callerIsRecipient = !identity.admin && Boolean(actualTo) && identity.name === actualTo;
                    const validStoredTarget = Boolean(actualTo) && actualTo === requestedTarget;
                    const authorized = identity.admin
                        || (validStoredTarget && (callerIsRecipient || (!acceptedArenaNotice && callerIsSender)));
                    if (!authorized) {
                        inboxDeleteDenied = true;
                        return;
                    }

                    matchedChallenge = matched;
                    storedFrom = actualFrom;
                    storedTo = actualTo;
                    const updated = existing.filter(challenge => challengeId(challenge) !== normalizedId);
                    if (updated.length) await kv.set(pendingKey, updated, { ex: CHALLENGE_TTL });
                    else await kv.del(pendingKey);
                }, { failClosed: true });
            }

            if (inboxDeleteDenied) {
                return res.status(403).json({ error: 'Only the stored challenge parties may delete this notice.' });
            }
            if (!matchedChallenge && !identity.admin && requestedFrom && requestedFrom !== identity.name) {
                if (requestedTarget === identity.name) return res.status(200).json({ ok: true });
                return res.status(403).json({ error: 'Cannot delete another player\'s challenges.' });
            }
            if (!matchedChallenge && !identity.admin && !requestedFrom) {
                if (requestedTarget === identity.name) return res.status(200).json({ ok: true });
                return res.status(403).json({ error: 'Cannot delete another player\'s challenges.' });
            }

            const effectiveFrom = matchedChallenge ? storedFrom : requestedFrom;
            const effectiveTarget = matchedChallenge ? storedTo : requestedTarget;
            if (effectiveFrom) {
                const senderKey = outgoingKey(effectiveFrom);
                await withKvLock(senderKey, async () => {
                    const current = await kv.get<OutgoingChallenge>(senderKey);
                    if (outgoingMatches(current, normalizedId, effectiveTarget || undefined)) {
                        await kv.del(senderKey);
                    }
                    const setupKey = sealedArenaSetupKey(normalizedId);
                    await withKvLock(setupKey, async () => {
                        const secret = await kv.get<StoredArenaSetup>(setupKey);
                        if (!secret || isArenaSetupTombstone(secret) || secret.accepted) return;
                        const isParty = identity.admin
                            || identity.name === secret.challengerName
                            || identity.name === secret.responderName;
                        const matchesParties = secret.challengerName === effectiveFrom
                            && (!effectiveTarget || secret.responderName === effectiveTarget);
                        if (isParty && matchesParties) await kv.set(setupKey, cancelledArenaSetup(secret), { ex: CHALLENGE_TTL });
                    }, { failClosed: true });
                }, { failClosed: true });
            }
            if (authoritative.status === 'pending' && (identity.admin || identity.name === authoritative.from)) {
                const cancelled = await cancelChallengeRecord(normalizedId, authoritative.from);
                if (cancelled) await releaseRankedChallengeAdmission(cancelled);
            }
            if (resolved) {
                if (authoritative.status === 'declined') await releaseRankedChallengeAdmission(authoritative);
                const authoritativeOutgoingKey = outgoingKey(authoritative.from);
                await withKvLock(authoritativeOutgoingKey, async () => {
                    const current = await kv.get<OutgoingChallenge>(authoritativeOutgoingKey);
                    if (outgoingMatches(current, normalizedId, authoritative.to)) await kv.del(authoritativeOutgoingKey);
                }, { failClosed: true });
            }
            return res.status(200).json({ ok: true });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const extra = unexpectedKeys(body as Record<string, unknown>, new Set(['targetName', 'challenge']));
        if (extra.length) return res.status(400).json({ error: `Unsupported request field: ${extra[0]}.` });
        const { targetName, challenge } = body as { targetName?: string; challenge?: unknown };
        if (!targetName || !challenge) return res.status(400).json({ error: 'Missing targetName or challenge.' });
        const shapeError = validateChallengeShape(challenge);
        if (shapeError) return res.status(400).json({ error: shapeError });

        const requestChallenge = challenge as Record<string, unknown>;
        const requestedAccepted = requestChallenge.accepted === true;
        const requestedDeclined = requestChallenge.declined === true;
        const requestedTerminal = requestedAccepted || requestedDeclined;
        const requestId = challengeId(requestChallenge);
        if (!isChallengeId(requestId)) return res.status(400).json({ error: 'Challenge id is missing or malformed.' });
        const targetPlayer = safeName(targetName);
        if (!targetPlayer) return res.status(400).json({ error: 'Target player is invalid.' });
        let authoritativeRecord: AuthoritativeChallengeRecord | null = null;
        let rankedAdmission: PlayerRankedAdmission | null = null;
        let challengeRecord: Record<string, unknown> = { ...requestChallenge };
        if (requestedTerminal) {
            authoritativeRecord = await loadChallengeRecord(requestId);
            if (!authoritativeRecord) {
                return res.status(409).json({
                    error: 'This challenge response does not match an active outgoing challenge.',
                    code: 'challenge-terminal-not-authorized',
                });
            }
            if (!identity.admin && identity.name !== authoritativeRecord.to) {
                return res.status(409).json({
                    error: 'This challenge response does not match an active outgoing challenge.',
                    code: 'challenge-terminal-not-authorized',
                });
            }
            if (targetPlayer !== authoritativeRecord.from
                || safeName(challengeFromName(requestChallenge)) !== authoritativeRecord.to) {
                return res.status(409).json({ error: 'Challenge response does not match the outstanding challenge.' });
            }
            if (requestedAccepted) {
                const blocked = await blockRelationship(authoritativeRecord.from, authoritativeRecord.to);
                if (blocked.aBlockedB || blocked.bBlockedA) {
                    return res.status(403).json({ error: 'A player block prevents accepting this challenge.' });
                }
            }
            const responseFields: Record<string, unknown> = {};
            for (const field of [
                'responderPetId', 'responderPet', 'responderPetIds', 'responderParty',
                'responderTeam', 'responderWarfrontSetup', 'battleId',
            ]) {
                if (field in requestChallenge) responseFields[field] = requestChallenge[field];
            }
            challengeRecord = {
                ...authoritativeRecord.challenge,
                ...responseFields,
                id: authoritativeRecord.id,
                mode: authoritativeRecord.mode,
                fromName: authoritativeRecord.to,
                toName: authoritativeRecord.from,
                accepted: requestedAccepted,
                declined: requestedDeclined,
            };
        } else {
            if (requestChallenge.accepted !== undefined || requestChallenge.declined !== undefined) {
                return res.status(400).json({ error: 'False response flags must be omitted.' });
            }
            const requestedMode = requestChallenge.mode ?? 'standard';
            if (!isPlayerChallengeMode(requestedMode)) return res.status(400).json({ error: 'Unsupported challenge mode.' });
            const actorName = identity.admin ? safeName(challengeFromName(requestChallenge)) : identity.name;
            if (!actorName) return res.status(400).json({ error: 'Challenge sender is invalid.' });
            if (safeName(challengeToName(requestChallenge)) !== targetPlayer) {
                return res.status(400).json({ error: 'Challenge recipient does not match targetName.' });
            }
            if (actorName === targetPlayer) return res.status(400).json({ error: 'You cannot challenge yourself.' });
            if (requestChallenge.battleId && requestChallenge.sectorAttack !== true) {
                return res.status(400).json({ error: 'Only a sector-attack notice may carry a battleId before acceptance.' });
            }
            if (requestChallenge.arenaMatch === true && requestedMode !== 'clanWarPet') {
                return res.status(400).json({ error: 'Arena challenges must use the clanWarPet protocol.' });
            }
            const blocked = await blockRelationship(actorName, targetPlayer);
            if (blocked.aBlockedB || blocked.bBlockedA) {
                return res.status(403).json({ error: 'A player block prevents this challenge.' });
            }
            if (requestedMode === 'ranked') {
                if (!playerRankedV2AdmissionsEnabled()) {
                    return res.status(503).json({ error: PLAYER_RANKED_V2_DISABLED_MESSAGE });
                }
                const rankedMatchId = typeof requestChallenge.rankedMatchId === 'string'
                    ? requestChallenge.rankedMatchId.trim().slice(0, 100)
                    : '';
                const rankedSeasonId = requestChallenge.rankedSeasonId;
                const rankedSeasonEpoch = requestChallenge.rankedSeasonEpoch;
                if (!isPlayerRankedMatchId(rankedMatchId)
                    || typeof rankedSeasonId !== 'number'
                    || !Number.isSafeInteger(rankedSeasonId)
                    || rankedSeasonId <= 0
                    || typeof rankedSeasonEpoch !== 'number'
                    || !Number.isSafeInteger(rankedSeasonEpoch)
                    || rankedSeasonEpoch <= 0) {
                    return res.status(409).json({ error: 'A complete server-ranked match proof is required.' });
                }
                rankedAdmission = await getPlayerRankedAdmission(kv, rankedMatchId);
                const rankedPair = [actorName, targetPlayer].sort();
                const rankedAgeMs = rankedAdmission ? Date.now() - rankedAdmission.createdAt : Number.POSITIVE_INFINITY;
                if (!rankedAdmission
                    || rankedAdmission.phase !== 'queued'
                    || rankedAdmission.a !== rankedPair[0]
                    || rankedAdmission.b !== rankedPair[1]
                    || !Number.isFinite(rankedAgeMs)
                    || rankedAgeMs < 0
                    || rankedAgeMs > PLAYER_RANKED_ADMISSION_TTL_MS
                    || rankedAdmission.seasonId !== rankedSeasonId
                    || rankedAdmission.seasonEpoch !== rankedSeasonEpoch) {
                    return res.status(409).json({ error: 'That ranked match proof is stale or belongs to another pairing.' });
                }
                challengeRecord.rankedMatchId = rankedAdmission.matchId;
                challengeRecord.rankedSeasonId = rankedAdmission.seasonId;
                challengeRecord.rankedSeasonEpoch = rankedAdmission.seasonEpoch;
            } else {
                delete challengeRecord.rankedMatchId;
                delete challengeRecord.rankedSeasonId;
                delete challengeRecord.rankedSeasonEpoch;
            }
            challengeRecord.mode = requestedMode;
            const legalClanWarPoints = CLAN_WAR_POINTS_BY_MODE[requestedMode] ?? 0;
            if (legalClanWarPoints > 0) challengeRecord.clanWarPoints = legalClanWarPoints;
            else delete challengeRecord.clanWarPoints;
        }
        const record = challengeRecord as { accepted?: boolean; declined?: boolean; battleId?: string; mode?: string };

        // No notice carries a client-owned challenger snapshot. New requests
        // resolve it from the authenticated sender; terminal replies resolve
        // the original challenger from the authenticated target's current
        // save. This remains correct even when the responder consumed their
        // inbox copy before posting acceptance.
        if (!record.accepted && !record.declined) {
            const actorName = identity.admin ? safeName(challengeFromName(challengeRecord)) : identity.name;
            if (!actorName) return res.status(400).json({ error: 'Challenge sender is invalid.' });
            const actorSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
            const actorCharacter = actorSave?.character as Record<string, unknown> | undefined;
            if (!actorCharacter) return res.status(404).json({ error: 'Challenge sender save was not found.' });
            const allPets = activeCarriedPets<Record<string, unknown>>(actorCharacter);
            let referencedPetIds = referencedChallengerPetIds(challengeRecord);
            if (referencedPetIds.length === 0 && (record.mode === 'clanWarPet' || record.mode === 'rankedPet')) {
                const fallback = allPets.find((pet) => String(pet.id ?? '') && !petCombatBusyReason(actorCharacter, pet));
                if (!fallback) return res.status(409).json({ error: 'No eligible challenger pet is available.' });
                challengeRecord.challengerPetId = String(fallback.id);
                referencedPetIds = [String(fallback.id)];
            }
            const selectedPets = referencedPetIds
                .map((id) => allPets.find((pet) => String(pet.id ?? '') === id))
                .filter(Boolean);
            if (selectedPets.length !== referencedPetIds.length
                || selectedPets.some((pet) => pet ? petCombatBusyReason(actorCharacter, pet) : true)) {
                return res.status(409).json({ error: 'Every selected challenger pet must be available in the stored roster.' });
            }
            const authoritativeChallenger = { ...actorCharacter, pets: selectedPets };
            challengeRecord.fromName = actorName;
            challengeRecord.toName = targetPlayer;
            challengeRecord.challenger = projectChallengerCharacter(authoritativeChallenger);
            if (challengeRecord.challengerBloodlineMult !== undefined) {
                const multiplier = Number(challengeRecord.challengerBloodlineMult);
                challengeRecord.challengerBloodlineMult = Number.isFinite(multiplier)
                    ? Math.max(0, Math.min(5, multiplier))
                    : 1;
            }
        } else {
            const actorName = identity.admin ? safeName(challengeFromName(challengeRecord)) : identity.name;
            if (!actorName) return res.status(400).json({ error: 'Challenge responder is invalid.' });
            const originalSave = await kv.get<Record<string, unknown>>(`save:${targetPlayer}`);
            const originalCharacter = originalSave?.character as Record<string, unknown> | undefined;
            if (!originalCharacter) return res.status(404).json({ error: 'Original challenger save was not found.' });
            const originalPets = activeCarriedPets<Record<string, unknown>>(originalCharacter);
            const referencedPetIds = referencedChallengerPetIds(challengeRecord);
            challengeRecord.fromName = actorName;
            challengeRecord.toName = targetPlayer;
            challengeRecord.challenger = projectChallengerCharacter({
                ...originalCharacter,
                pets: referencedPetIds
                    .map((id) => originalPets.find((pet) => String(pet.id ?? '') === id))
                    .filter(Boolean),
            });

            // Pet-duel acceptance snapshots also come from the authenticated
            // responder save. IDs are caller selections; stats/art/loadouts are
            // never accepted from the request body.
            if (record.accepted && (challengeRecord.responderPetId !== undefined
                || challengeRecord.responderPet !== undefined
                || challengeRecord.responderPetIds !== undefined
                || challengeRecord.responderParty !== undefined)) {
                const responderSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                const responderCharacter = responderSave?.character as Record<string, unknown> | undefined;
                if (!responderCharacter) return res.status(404).json({ error: 'Challenge responder save was not found.' });
                const responderPets = activeCarriedPets<Record<string, unknown>>(responderCharacter);
                const requestedSingleId = String(challengeRecord.responderPetId
                    ?? ((challengeRecord.responderPet && typeof challengeRecord.responderPet === 'object')
                        ? (challengeRecord.responderPet as Record<string, unknown>).id
                        : '')
                    ?? '').slice(0, 128);
                if (requestedSingleId) {
                    const pet = responderPets.find((candidate) => String(candidate.id ?? '') === requestedSingleId);
                    if (!pet || petCombatBusyReason(responderCharacter, pet)) {
                        return res.status(409).json({ error: 'The selected responder pet is unavailable.' });
                    }
                    challengeRecord.responderPetId = requestedSingleId;
                    challengeRecord.responderPet = projectChallengePet(pet);
                }
                if (challengeRecord.petParty === true) {
                    const ids = Array.isArray(challengeRecord.responderPetIds)
                        ? challengeRecord.responderPetIds.map((value) => String(value ?? '').slice(0, 128)).slice(0, 2)
                        : Array.isArray(challengeRecord.responderParty)
                            ? challengeRecord.responderParty.map((value) => value && typeof value === 'object'
                                ? String((value as Record<string, unknown>).id ?? '').slice(0, 128)
                                : '').slice(0, 2)
                            : [];
                    const party = ids.map((id) => responderPets.find((pet) => String(pet.id ?? '') === id));
                    if (ids.length !== 2 || new Set(ids).size !== 2
                        || party.some((pet) => !pet || petCombatBusyReason(responderCharacter, pet))) {
                        return res.status(409).json({ error: 'The selected responder party is unavailable.' });
                    }
                    challengeRecord.responderPetIds = ids;
                    challengeRecord.responderParty = party.map(projectChallengePet).filter(Boolean);
                }
            }
        }
        const fromName = challengeFromName(challengeRecord);

        // The challenge's fromName (sender) must match the authed identity unless admin.
        if (!identity.admin && fromName && safeName(fromName) !== identity.name) {
            return res.status(403).json({ error: 'Cannot send a challenge as another player.' });
        }
        // The private queue/engine can be certified without reopening this
        // legacy live-challenge surface. Public promotion requires its own
        // explicit flag in addition to the server-engine flag.
        if (!requestedTerminal && record.mode === 'rankedPet' && !petRankedPublicChallengesEnabled()) {
            return res.status(503).json({ error: PET_RANKED_DISABLED_REASON });
        }

        // A battleId notice is a routing capability, not client metadata.
        // Hydrate it from the live server session and enforce its directional
        // roles: initial/sector notice p1 -> p2; acceptance/decline p2 -> p1.
        // Both sides must be authoritative player saves and the fight must
        // still be active. This prevents any logged-in caller from forcing an
        // arbitrary victim into App's PvP route with a made-up id.
        if (record.battleId) {
            const battleId = String(record.battleId);
            const session = await kv.get<ChallengePvpSession>(`pvp:${battleId}`);
            const p1Name = safeName(String(session?.p1?.name ?? session?.p1?.character?.name ?? ''));
            const p2Name = safeName(String(session?.p2?.name ?? session?.p2?.character?.name ?? ''));
            const isTerminalDirection = record.accepted === true || record.declined === true;
            const expectedFrom = isTerminalDirection ? p2Name : p1Name;
            const expectedTo = isTerminalDirection ? p1Name : p2Name;
            const validSession = session?.battleId === battleId
                && (!isTerminalDirection || session.challengeId === requestId)
                && session.status === 'active'
                && (session.winner === null || session.winner === undefined)
                && session.realFighters?.p1 === true
                && session.realFighters?.p2 === true
                && Boolean(expectedFrom && expectedTo)
                && safeName(fromName) === expectedFrom
                && targetPlayer === expectedTo;
            if (!validSession) {
                return res.status(409).json({
                    error: 'This PvP routing notice does not match an active server session and its exact parties.',
                    code: 'challenge-battle-session-invalid',
                });
            }
            challengeRecord.fromName = expectedFrom;
            challengeRecord.toName = expectedTo;
            challengeRecord.battleId = battleId;
        }

        // For new challenges (not accept/decline/battle routing), gate on travel + battle state.
        if (!record.accepted && !record.declined && !record.battleId) {
            // The target must be a real, existing player. A challenge typed to a
            // mistyped/nonexistent name would otherwise store at challenges:<typo>
            // — a key no heartbeat ever reads — and return 200 as if delivered,
            // so the sender is never told it went nowhere (they'd wait for an
            // accept that can't come). Player saves live at save:<safeName>, so a
            // missing save = no such player. Only new outgoing challenges are
            // gated; accept/decline/battle-routing replies legitimately target
            // the counterparty and are handled above.
            const targetExists = await kv.get(`save:${targetPlayer}`);
            if (!targetExists) return res.status(404).json({ error: `No player named "${targetName}" was found.` });
            // Presence is in process memory; challengeBlock carries the
            // traveling / in-battle / engaged gates AND the Academy-Student
            // protection (sub-Genin can't be challenged). Spar and pet-battle
            // modes are exempt from the Academy gate (passed via record.mode) so
            // brand-new players can still practice-fight; ranked / clan-war keep
            // it. An OFFLINE target is NOT blocked — the challenge is queued in
            // their inbox for later.
            const block = challengeBlock(onlineStore.get(targetPlayer), record.mode);
            if (block) return res.status(block.status).json({ error: block.error });
        }

        // Hollow Warfront uses a server-held simultaneous reveal. The
        // challenger's setup is removed from the broad Realtime incoming inbox
        // and stored behind the challenge id. Only after the responder submits
        // their own validated setup does the accepted payload reveal both.
        let routedChallenge: unknown = challengeRecord;
        const candidateCreatedAt = Number(challengeRecord.createdAt);
        const challengeClientCreatedAt = Number.isSafeInteger(candidateCreatedAt)
            && candidateCreatedAt >= Date.now() - CHALLENGE_TTL * 1000
            && candidateCreatedAt <= Date.now() + 30_000
            ? candidateCreatedAt
            : null;
        const candidateArenaId = challengeId(challengeRecord);
        const candidateArenaSetupKey = candidateArenaId ? sealedArenaSetupKey(candidateArenaId) : '';
        // The private commitment, not the client-supplied arenaMatch flag, owns
        // the protocol. Once an id has ever been sealed as Arena, stripping the
        // flag cannot fall through to generic challenge routing and overwrite a
        // terminal accepted notice.
        const serverArenaState = candidateArenaSetupKey
            ? await kv.get<StoredArenaSetup>(candidateArenaSetupKey)
            : null;
        const isArenaChallenge = challengeRecord.arenaMatch === true || Boolean(serverArenaState);
        const genericTerminalStatus = record.accepted
            ? 'accepted' as const
            : record.declined ? 'declined' as const : null;
        if (genericTerminalStatus && !isArenaChallenge) {
            const responderName = safeName(fromName);
            const senderKey = outgoingKey(targetPlayer);
            const authorized = await withKvLock(senderKey, async () => {
                const current = await kv.get<OutgoingChallenge>(senderKey);
                if (!outgoingMatches(current, candidateArenaId, responderName)) return false;
                if (current?.terminal) {
                    return current.terminal.responderName === responderName
                        && current.terminal.status === genericTerminalStatus;
                }
                await kv.set(senderKey, {
                    ...current,
                    terminal: { responderName, status: genericTerminalStatus },
                }, { ex: CHALLENGE_TTL });
                return true;
            }, { failClosed: true });
            if (!authorized) {
                return res.status(409).json({
                    error: 'This challenge response does not match an active outgoing challenge.',
                    code: 'challenge-terminal-not-authorized',
                });
            }
        }
        if (isArenaChallenge) {
            const actorName = identity.admin ? safeName(fromName) : identity.name;
            if (!actorName) return res.status(400).json({ error: 'Arena challenge is missing an authenticated sender.' });
            const id = candidateArenaId;
            if (!id) return res.status(400).json({ error: 'Arena challenge is missing an id.' });
            const setupKey = candidateArenaSetupKey;
            if (!record.accepted && !record.declined && !record.battleId) {
                const setup = parseSharedWarfrontSetup(challengeRecord.challengerWarfrontSetup);
                const arenaSize: 2 | 4 = challengeRecord.arenaSize === 2 ? 2 : 4;
                const challengerTeamIds = Array.isArray(challengeRecord.challengerTeamIds)
                    ? challengeRecord.challengerTeamIds.map((value) => String(value)).slice(0, arenaSize)
                    : [];
                if (challengeClientCreatedAt === null) {
                    return res.status(409).json({ error: 'This Arena challenge generation is stale or has an invalid clock.' });
                }
                const clientCreatedAt = challengeClientCreatedAt;
                if (!setup) return res.status(400).json({ error: 'Arena challenge is missing a valid sealed opening setup.' });
                if (new Set(challengerTeamIds).size !== arenaSize) {
                    return res.status(400).json({ error: 'Arena challenge is missing a valid sealed roster.' });
                }
                const challengerSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                const challengerCharacter = challengerSave?.character as Record<string, unknown> | undefined;
                if (!challengerCharacter) return res.status(404).json({ error: 'Arena challenger save was not found.' });
                const challengerPets = activeCarriedPets<Record<string, unknown>>(challengerCharacter);
                const sealedChallengerPets = challengerTeamIds.map((id) => challengerPets.find((pet) => String(pet.id ?? '') === id));
                if (sealedChallengerPets.some((pet) => !pet || petCombatBusyReason(challengerCharacter, pet))) {
                    return res.status(409).json({ error: 'Every sealed challenger pet must be available in the stored roster.' });
                }
                const authoritativeChallenger = { ...challengerCharacter, pets: sealedChallengerPets };
                const secret: SealedArenaSetup = {
                    challengerName: actorName,
                    responderName: safeName(targetName),
                    setup,
                    challenger: projectChallengerCharacter(authoritativeChallenger),
                    challengerTeamIds,
                    arenaSize,
                    // Neither player chooses the deterministic battlefield. It
                    // remains private beside both plans until acceptance.
                    petBattleSeed: freshArenaSeed(),
                    clientCreatedAt,
                };
                const sealed = await kv.set(setupKey, secret, { nx: true, ex: CHALLENGE_TTL });
                if (!sealed) {
                    const existing = await kv.get<StoredArenaSetup>(setupKey);
                    if (isArenaSetupTombstone(existing)) {
                        return res.status(409).json({ error: 'This Arena challenge was already cancelled or superseded.' });
                    }
                    if (existing?.accepted) {
                        return res.status(409).json({ error: 'This Arena challenge was already accepted.' });
                    }
                    const sameCommitment = Boolean(existing
                        && existing.challengerName === secret.challengerName
                        && existing.responderName === secret.responderName
                        && existing.arenaSize === secret.arenaSize
                        && existing.clientCreatedAt === secret.clientCreatedAt
                        && JSON.stringify(existing.setup) === JSON.stringify(secret.setup)
                        && JSON.stringify(existing.challengerTeamIds) === JSON.stringify(secret.challengerTeamIds));
                    if (!sameCommitment) return res.status(409).json({ error: 'This Arena challenge id is already sealed to a different opening setup.' });
                }
                const {
                    challengerWarfrontSetup: _hiddenSetup,
                    challengerTeamIds: _hiddenTeamIds,
                    petBattleSeed: _hiddenSeed,
                    ...publicChallenge
                } = challengeRecord;
                void _hiddenSetup;
                void _hiddenTeamIds;
                void _hiddenSeed;
                const projectedChallenger = projectChallengerCharacterValue(challengeRecord.challenger, true);
                const publicChallenger = projectedChallenger && typeof projectedChallenger === 'object' && !Array.isArray(projectedChallenger)
                    ? Object.fromEntries(Object.entries(projectedChallenger).filter(([key]) => key !== 'pets'))
                    : projectedChallenger;
                routedChallenge = {
                    ...publicChallenge,
                    arenaMatch: true,
                    accepted: false,
                    declined: false,
                    fromName: secret.challengerName,
                    toName: secret.responderName,
                    challenger: publicChallenger,
                    challengerSetupSealed: true,
                };
            } else if (record.accepted) {
                const challengerOutgoingKey = outgoingKey(targetName);
                const acceptance = await withKvLock(challengerOutgoingKey, () => withKvLock(setupKey, async () => {
                    const stored = await kv.get<StoredArenaSetup>(setupKey);
                    const secret = stored && !isArenaSetupTombstone(stored) ? stored : null;
                    const validParties = secret
                        && secret.challengerName === safeName(targetName)
                        && secret.responderName === actorName;
                    if (!validParties) return { error: 'The sealed Arena setup is missing, expired, or belongs to different players.', status: 409 } as const;
                    if (secret.accepted) return { secret, accepted: secret.accepted } as const;
                    const currentOutgoing = await kv.get<OutgoingChallenge>(challengerOutgoingKey);
                    if (!outgoingMatches(currentOutgoing, id, actorName)) {
                        return { error: 'This Arena challenge was cancelled or replaced before acceptance.', status: 409 } as const;
                    }

                    const responderSetup = parseSharedWarfrontSetup(challengeRecord.responderWarfrontSetup);
                    if (!responderSetup) return { error: 'Arena acceptance is missing a valid responder setup.', status: 400 } as const;
                    const requestedResponderPets = Array.isArray(challengeRecord.responderTeam)
                        ? challengeRecord.responderTeam.map((value) => value && typeof value === 'object' ? String((value as Record<string, unknown>).id ?? '') : '')
                        : [];
                    if (requestedResponderPets.length !== secret.arenaSize || new Set(requestedResponderPets).size !== secret.arenaSize) {
                        return { error: 'Arena acceptance is missing a valid responder roster.', status: 400 } as const;
                    }
                    const responderSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                    const responderCharacter = responderSave?.character as Record<string, unknown> | undefined;
                    if (!responderCharacter) return { error: 'Arena responder save was not found.', status: 404 } as const;
                    const responderPets = activeCarriedPets<Record<string, unknown>>(responderCharacter);
                    const authoritativeResponderTeam = requestedResponderPets.map((id) => responderPets.find((pet) => String(pet.id ?? '') === id));
                    if (authoritativeResponderTeam.some((pet) => !pet || petCombatBusyReason(responderCharacter, pet))) {
                        return { error: 'Every sealed responder pet must be available in the stored roster.', status: 409 } as const;
                    }
                    const accepted = {
                        responderSetup,
                        responderTeam: stripPetInlineImages(authoritativeResponderTeam),
                    };
                    const sealedAcceptance: SealedArenaSetup = { ...secret, accepted };
                    // Accepted commitments must outlive a regulation match and
                    // a dropped response. Pending challenges retain the short
                    // inbox TTL; only the terminal reveal gets the recovery TTL.
                    await kv.set(setupKey, sealedAcceptance, { ex: ARENA_MATCH_RECOVERY_TTL_SECONDS });
                    return { secret: sealedAcceptance, accepted } as const;
                }, { failClosed: true }), { failClosed: true });
                if ('error' in acceptance) return res.status(acceptance.status ?? 409).json({ error: acceptance.error });
                const { secret, accepted } = acceptance;
                routedChallenge = acceptedArenaChallenge(id, { ...secret, accepted })!;
            } else if (record.declined) {
                // Decline and acceptance race on the same private commitment.
                // Whichever transition seals first is terminal: a decline keeps
                // the plans hidden, while an accepted reveal can never be
                // overwritten or retracted after the responder has seen it.
                const decline = await withKvLock(setupKey, async () => {
                    const stored = await kv.get<StoredArenaSetup>(setupKey);
                    if (!stored) return { error: 'The sealed Arena setup is missing or expired.', status: 409 } as const;
                    const validParties = stored.challengerName === safeName(targetName)
                        && stored.responderName === actorName;
                    if (!validParties) {
                        return { error: 'The sealed Arena setup belongs to different players.', status: 409 } as const;
                    }
                    if (isArenaSetupTombstone(stored)) return { declined: true, state: stored } as const;
                    if (stored.accepted) {
                        return { error: 'This Arena match is already accepted; its reveal is final.', status: 409 } as const;
                    }
                    const state = cancelledArenaSetup(stored);
                    await kv.set(setupKey, state, { ex: CHALLENGE_TTL });
                    return { declined: true, state } as const;
                }, { failClosed: true });
                if ('error' in decline) return res.status(decline.status ?? 409).json({ error: decline.error });
                routedChallenge = {
                    id,
                    arenaMatch: true,
                    accepted: false,
                    declined: true,
                    fromName: decline.state.responderName,
                    toName: decline.state.challengerName,
                    challengerSetupSealed: true,
                };
            } else {
                return res.status(409).json({ error: 'Unsupported Arena challenge transition.' });
            }
        }

        let authoritativeReplay = false;
        let resolutionReplay = false;
        let pendingProjection: Record<string, unknown> | null = null;
        if (genericTerminalStatus) {
            if (!authoritativeRecord) throw new Error('Terminal challenge lost its authoritative record.');
            const resolution: 'accepted' | 'declined' = genericTerminalStatus;
            const battleId = record.battleId ? String(record.battleId) : '';
            const petProtocol = authoritativeRecord.mode === 'clanWarPet' || authoritativeRecord.mode === 'rankedPet';
            if (resolution === 'accepted' && !petProtocol) {
                if (!battleId || authoritativeRecord.battleId !== battleId) {
                    return res.status(409).json({ error: 'Accepted challenge is not bound to its server-created battle.' });
                }
            } else if (resolution === 'accepted' && battleId) {
                return res.status(409).json({ error: 'Pet challenge acceptance cannot attach a client-routed battle.' });
            }
            const resolvedRecord = await resolveChallengeRecord({
                id: authoritativeRecord.id,
                responder: authoritativeRecord.to,
                target: authoritativeRecord.from,
                resolution,
                ...(resolution === 'accepted' && battleId ? { battleId } : {}),
            });
            if (!resolvedRecord) {
                return res.status(409).json({ error: 'Challenge was already resolved differently or no longer matches.' });
            }
            if (resolution === 'declined') await releaseRankedChallengeAdmission(resolvedRecord.record);
            authoritativeRecord = resolvedRecord.record;
            resolutionReplay = resolvedRecord.replay;
        } else {
            const mode = record.mode ?? 'standard';
            if (!isPlayerChallengeMode(mode)) return res.status(400).json({ error: 'Unsupported challenge mode.' });
            const projected = projectChallenge(clampClanWarPoints(routedChallenge)) as Record<string, unknown>;
            const proposed: AuthoritativeChallengeRecord = {
                id: candidateArenaId,
                from: safeName(fromName),
                to: targetPlayer,
                mode,
                status: 'pending',
                createdAt: Date.now(),
                challenge: projected,
            };
            if (!(await saveChallengeRecord(proposed))) {
                const existing = await loadChallengeRecord(candidateArenaId);
                const samePending = existing?.status === 'pending'
                    && existing.from === proposed.from
                    && existing.to === proposed.to
                    && existing.mode === proposed.mode
                    && JSON.stringify(existing.challenge) === JSON.stringify(proposed.challenge);
                if (!samePending || !existing) {
                    return res.status(409).json({ error: 'That challenge id is already in use. Create a fresh challenge and retry.' });
                }
                authoritativeRecord = existing;
                authoritativeReplay = true;
                pendingProjection = existing.challenge;
            } else {
                authoritativeRecord = proposed;
                pendingProjection = projected;
            }
        }

        if (record.accepted || record.declined) {
            const senderKey = outgoingKey(targetName);
            const id = challengeId(challenge);
            await withKvLock(senderKey, async () => {
                const current = await kv.get<OutgoingChallenge>(senderKey);
                // A delayed response to an older challenge must never erase the
                // challenger's newer outgoing slot.
                // Generic transitions retain their bounded terminal marker so
                // a lost HTTP response can replay exactly. Arena has its own
                // one-hour participant recovery record and can release here.
                if (isArenaChallenge && id && outgoingMatches(current, id, fromName)) await kv.del(senderKey);
                if (record.declined && id) {
                    const setupKey = sealedArenaSetupKey(id);
                    await withKvLock(setupKey, async () => {
                        const stored = await kv.get<StoredArenaSetup>(setupKey);
                        const secret = stored && !isArenaSetupTombstone(stored) ? stored : null;
                        if (secret && !secret.accepted
                            && secret.challengerName === safeName(targetName)
                            && secret.responderName === safeName(fromName)) {
                            await kv.set(setupKey, cancelledArenaSetup(secret), { ex: CHALLENGE_TTL });
                        }
                    }, { failClosed: true });
                }
            }, { failClosed: true });
        } else if (fromName && !record.battleId) {
            const senderKey = outgoingKey(fromName);
            const outgoingUpdate = await withKvLock(senderKey, async () => {
            const existingOutgoing = await kv.get<OutgoingChallenge>(senderKey);
            const nextId = challengeId(challenge);
            if (existingOutgoing?.challengeId === nextId && existingOutgoing.terminal) {
                return { stale: true } as const;
            }
            if (challengeClientCreatedAt !== null
                && existingOutgoing?.challengeId !== nextId
                && typeof existingOutgoing?.clientCreatedAt === 'number'
                && challengeClientCreatedAt <= existingOutgoing.clientCreatedAt) {
                const delayedSetupKey = sealedArenaSetupKey(nextId);
                await withKvLock(delayedSetupKey, async () => {
                    const delayedStored = await kv.get<StoredArenaSetup>(delayedSetupKey);
                    const delayed = delayedStored && !isArenaSetupTombstone(delayedStored) ? delayedStored : null;
                    if (delayed && !delayed.accepted
                        && delayed.challengerName === safeName(fromName)
                        && delayed.responderName === safeName(targetName)) {
                        await kv.set(delayedSetupKey, cancelledArenaSetup(delayed), { ex: CHALLENGE_TTL });
                    }
                }, { failClosed: true });
                return { stale: true } as const;
            }
            // Supersede the sender's prior pending challenge instead of rejecting
            // the new one. A challenge that was never answered (recipient
            // offline) — or one the sender lost track of after a page reload —
            // used to lock the sender out for the full CHALLENGE_TTL window with
            // a "you already have a pending challenge" error and no way to clear
            // it. Clear the previous recipient's inbox copy here; the outgoing
            // slot is overwritten just below. This preserves the "one
            // outstanding challenge per sender" invariant — the new challenge
            // simply replaces the old, dead one.
            if (existingOutgoing?.targetName && existingOutgoing.challengeId !== challengeId(challenge)) {
                const prevKey = challengeKey(String(existingOutgoing.targetName));
                const prevId = existingOutgoing.challengeId ? String(existingOutgoing.challengeId) : '';
                await withKvLock(prevKey, async () => {
                    const inbox = await kv.get<unknown[]>(prevKey) ?? [];
                    const filtered = prevId ? inbox.filter(c => challengeId(c) !== prevId) : inbox;
                    if (filtered.length) await kv.set(prevKey, filtered, { ex: CHALLENGE_TTL });
                    else await kv.del(prevKey);
                }, { failClosed: true });
                if (prevId) {
                    const previousSetupKey = sealedArenaSetupKey(prevId);
                    await withKvLock(previousSetupKey, async () => {
                        const storedPrevious = await kv.get<StoredArenaSetup>(previousSetupKey);
                        const previous = storedPrevious && !isArenaSetupTombstone(storedPrevious) ? storedPrevious : null;
                        if (previous && !previous.accepted
                            && previous.challengerName === safeName(fromName)
                            && previous.responderName === safeName(String(existingOutgoing.targetName))) {
                            await kv.set(previousSetupKey, cancelledArenaSetup(previous), { ex: CHALLENGE_TTL });
                        }
                    }, { failClosed: true });
                    const cancelled = await cancelChallengeRecord(prevId, safeName(fromName));
                    if (cancelled) await releaseRankedChallengeAdmission(cancelled);
                }
            }
            await kv.set(senderKey, {
                targetName,
                challengeId: nextId,
                createdAt: Date.now(),
                ...(challengeClientCreatedAt !== null ? { clientCreatedAt: challengeClientCreatedAt } : {}),
            }, { ex: CHALLENGE_TTL });
            return { stale: false } as const;
            }, { failClosed: true });
            if (outgoingUpdate.stale) {
                const cancelled = await cancelChallengeRecord(candidateArenaId, safeName(fromName));
                if (cancelled) await releaseRankedChallengeAdmission(cancelled);
                return res.status(409).json({ error: 'This Arena challenge was superseded by a newer generation.' });
            }
        }

        // Two server-side transforms before the challenge hits KV:
        //   1. clampClanWarPoints — keeps the win-credit path honest.
        //   2. projectChallenge   — strips the challenger's full character
        //      down to the inbox-renderable public projection. The
        //      challenges:* delivery record is intentionally minimal; the full
        //      payload would unnecessarily copy ryo / jutsu / equipment / stats.
        let safeChallenge = pendingProjection ?? projectChallenge(clampClanWarPoints(routedChallenge));

        // Generic terminal replies also converge on one immutable server-
        // projected payload. Authorization was claimed above before routing;
        // this record closes the crash/lost-response window and prevents a
        // retry from replacing the terminal row with changed client fields.
        if (genericTerminalStatus && !isArenaChallenge) {
            const safeRecord = safeChallenge as Record<string, unknown>;
            const id = challengeId(safeRecord);
            const challengerName = safeName(String(safeRecord.toName ?? ''));
            const responderName = safeName(String(safeRecord.fromName ?? ''));
            const terminalKey = genericTerminalKey(challengerName, id);
            const terminal = await withKvLock(terminalKey, async () => {
                const existing = await kv.get<GenericTerminalRecord>(terminalKey);
                if (existing) {
                    if (existing.version !== 1
                        || existing.challengeId !== id
                        || existing.challengerName !== challengerName
                        || existing.responderName !== responderName
                        || existing.status !== genericTerminalStatus) {
                        throw new Error('Generic challenge terminal record conflicts with its authorized transition.');
                    }
                    return existing;
                }
                const committed: GenericTerminalRecord = {
                    version: 1,
                    challengeId: id,
                    challengerName,
                    responderName,
                    status: genericTerminalStatus,
                    challenge: safeRecord,
                };
                await kv.set(terminalKey, committed, { ex: CHALLENGE_TTL });
                return committed;
            }, { failClosed: true });
            safeChallenge = terminal.challenge;
        }

        // Store the accepted simultaneous reveal as a durable, participant-only
        // recovery record before relying on either HTTP delivery or the short
        // inbox notice. Identical retries converge; a divergent terminal object
        // is rejected instead of overwriting the first accepted reveal.
        if (record.accepted && isArenaChallenge) {
            const id = challengeId(safeChallenge);
            const safeRecord = safeChallenge as Record<string, unknown>;
            const challengerName = safeName(String(safeRecord.toName ?? ''));
            const responderName = safeName(String(safeRecord.fromName ?? ''));
            if (!id || !challengerName || !responderName) throw new Error('Accepted Arena recovery lacks canonical parties.');
            const recoveryKey = arenaMatchRecoveryKey(id);
            await withKvLock(recoveryKey, async () => {
                const existing = await kv.get<ArenaMatchRecovery>(recoveryKey);
                if (isArenaMatchRecovery(existing, id)) {
                    if (existing.challengerName !== challengerName
                        || existing.responderName !== responderName
                        || JSON.stringify(existing.challenge) !== JSON.stringify(safeRecord)) {
                        throw new Error('Accepted Arena recovery conflicts with its terminal reveal.');
                    }
                    return;
                }
                const acceptedAt = Date.now();
                const recovery: ArenaMatchRecovery = {
                    version: 1,
                    challengeId: id,
                    challengerName,
                    responderName,
                    acceptedAt,
                    expiresAt: acceptedAt + ARENA_MATCH_RECOVERY_TTL_SECONDS * 1000,
                    challenge: safeRecord,
                };
                await kv.set(recoveryKey, recovery, { ex: ARENA_MATCH_RECOVERY_TTL_SECONDS });
            }, { failClosed: true });
        }

        // Never publish the accepted seed, rosters, or either sealed plan to
        // the broad Realtime inbox. The opaque notice wakes the
        // challenger, who recovers the reveal through authenticated GET.
        const inboxChallenge = record.accepted && isArenaChallenge
            ? acceptedArenaInboxNotice(safeChallenge as Record<string, unknown>)
            : safeChallenge;

        // Lock the recipient's inbox around the read-dedupe-write so two
        // simultaneous challengers can't both read the same snapshot and
        // both produce a final list that's missing the other's entry.
        const key = challengeKey(targetName);
        const cid = candidateArenaId;
        await withKvLock(key, async () => {
            const existing = await kv.get<unknown[]>(key) ?? [];
            const deduped = cid ? existing.filter(c => challengeId(c) !== cid) : existing;
            const updated = [...deduped, inboxChallenge].slice(-MAX_CHALLENGE_INBOX);
            await kv.set(key, updated, { ex: CHALLENGE_TTL });
        }, { failClosed: true });

        // Instant delivery: nudge the recipient to poll now. The HTTP heartbeat
        // remains the authoritative carrier of pendingChallenges; this just makes
        // it arrive immediately. No-op when realtime is off / they have no socket.
        kickPlayer(targetName, 'challenge');

        return res.status(200).json({
            ok: true,
            challenge: safeChallenge,
            challengeId: candidateArenaId,
            replay: authoritativeReplay || resolutionReplay,
        });
    } catch (err) {
        console.error('[challenge]', err);
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Challenge state is busy. Retry the same action.', retryAfterMs: 250 });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    return secureChallengeHandler(req, res);
}
