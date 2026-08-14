import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';
import { challengeBlock } from '../_realtime/presence-gating.js';
import { kickPlayer } from '../_realtime/notify.js';
import { PET_RANKED_DISABLED_REASON, petRankedStartsEnabled } from '../pet/_ranked-settlement.js';
import { blockRelationship } from './_blocks.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import type { PvpSession } from '../pvp/session.js';
import {
    getPlayerRankedAdmission,
    isPlayerRankedMatchId,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    releaseQueuedPlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import {
    PLAYER_RANKED_V2_DISABLED_MESSAGE,
    playerRankedV2AdmissionsEnabled,
} from '../pvp/_player-ranked-rollout.js';
import {
    cancelChallengeRecord,
    isChallengeId,
    isPlayerChallengeMode,
    loadChallengeRecord,
    resolveChallengeRecord,
    saveChallengeRecord,
    type AuthoritativeChallengeRecord,
} from '../pvp/_challenge-authorization.js';

const CHALLENGE_TTL = 180; // seconds (3 min) — challenge auto-cancels if unanswered

const MAX_CHALLENGE_INBOX = 20;

const CHALLENGE_INPUT_FIELDS = new Set([
    'id', 'fromName', 'toName', 'challenger', 'challengerJutsus', 'challengerBloodlineMult',
    'challengerPetId', 'petBattleSeed', 'responderPetId', 'responderPet', 'petParty',
    'challengerPetIds', 'responderPetIds', 'responderParty', 'arenaMatch', 'arenaSize',
    'challengerTeamIds', 'responderTeam', 'createdAt', 'mode', 'clanWarPoints',
    'challengerPetRating', 'responderPetRating', 'petRankedToken', 'sectorAttack',
    'rankedMatchId', 'rankedSeasonId', 'rankedSeasonEpoch',
    'kageChallengeId', 'kageVillage', 'battleId', 'accepted', 'declined',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max = 100): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isBattleId(value: unknown): value is string {
    return typeof value === 'string'
        && value.length >= 8
        && value.length <= 100
        && /^[A-Za-z0-9_-]+$/.test(value);
}

function boundedIdList(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((entry) => boundedString(entry, 80))
        .filter((entry) => entry && /^[A-Za-z0-9_.:-]+$/.test(entry)))]
        .slice(0, maxItems);
}

function petById(character: Record<string, unknown> | null, id: string): Record<string, unknown> | null {
    if (!character || !id) return null;
    const found = activeCarriedPets<Record<string, unknown>>(character)
        .find((pet) => String(pet.id ?? '') === id && !petCombatBusyReason(character, pet));
    return isPlainRecord(found) ? found : null;
}

async function loadCharacter(name: string): Promise<Record<string, unknown> | null> {
    const save = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
    return isPlainRecord(save?.character) ? save.character : null;
}

// Public projection for the challenger character stored alongside a
// challenges:<name> entry. The challenges:* prefix is anon-readable via
// Supabase Realtime (see supabase-schema.sql), so the FULL challenger
// character — including ryo, jutsu, equipment, stats — would otherwise
// be world-readable to any anon WS subscriber. Strip down to the bare
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
// The challenges:* prefix is anon-readable via Supabase Realtime, so any inline
// base64 (data:) image kept here is BOTH world-readable to any anon WS
// subscriber AND a large recurring payload on the wire (a live challenge with a
// full avatar + pet sprites measured ~450KB). Hosted-URL image refs are fine
// (small, already public) — only inline `data:` blobs are stripped. Pets keep
// their combat stats (the accept handler matches by id and needs them) but lose
// inline sprite blobs. The recipient resolves avatars/pet art by name from the
// shared-image cache, same as presence does.
function isInlineImage(v: unknown): boolean {
    return typeof v === 'string' && v.startsWith('data:');
}
function stripPetInlineImages(pets: unknown): unknown {
    if (!Array.isArray(pets)) return pets;
    return pets.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const pet = p as Record<string, unknown>;
        if (!isInlineImage(pet.image) && !isInlineImage(pet.bodyImage)) return pet;
        const out = { ...pet };
        if (isInlineImage(out.image)) delete out.image;
        if (isInlineImage(out.bodyImage)) delete out.bodyImage;
        return out;
    });
}
function projectChallengerCharacterValue(c: unknown, entitlementFiltered: boolean): unknown {
    if (!c || typeof c !== 'object') return c;
    const src = c as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of CHALLENGER_PUBLIC_FIELDS) if (k in src) out[k] = src[k];
    if (isInlineImage(out.avatarImage)) delete out.avatarImage;
    if ('pets' in out) {
        const pets = entitlementFiltered ? out.pets : activeCarriedPets<Record<string, unknown>>(src);
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
    // buildNewChallenge already projected the authoritative character while its
    // private Patreon entitlement was available. Do not derive a second cap
    // after that ledger has intentionally been stripped from the public DTO.
    if ('challenger' in rec) out.challenger = projectChallengerCharacterValue(rec.challenger, true);
    return out;
}

function challengeKey(name: string) {
    return `challenges:${safeName(name)}`;
}

function outgoingKey(name: string) {
    return `challenge-outgoing:${safeName(name)}`;
}

async function removeFromInbox(owner: string, id: string): Promise<boolean> {
    const key = challengeKey(owner);
    return withKvLock(key, async () => {
        const existing = await kv.get<unknown[]>(key) ?? [];
        const had = existing.some((challenge) => challengeId(challenge) === id);
        const updated = existing.filter((challenge) => challengeId(challenge) !== id);
        if (updated.length) await kv.set(key, updated, { ex: CHALLENGE_TTL });
        else await kv.del(key);
        return had;
    });
}

async function enqueueChallenge(owner: string, challenge: Record<string, unknown>): Promise<void> {
    const key = challengeKey(owner);
    const id = challengeId(challenge);
    await withKvLock(key, async () => {
        const existing = await kv.get<unknown[]>(key) ?? [];
        const deduped = existing.filter((entry) => challengeId(entry) !== id);
        await kv.set(key, [...deduped, challenge].slice(-MAX_CHALLENGE_INBOX), { ex: CHALLENGE_TTL });
    });
}

async function clearExactOutgoing(sender: string, id: string): Promise<void> {
    const key = outgoingKey(sender);
    const outgoing = await kv.get<{ challengeId?: string }>(key);
    if (String(outgoing?.challengeId ?? '') === id) await kv.del(key);
}

async function releaseRankedChallengeAdmission(record: AuthoritativeChallengeRecord): Promise<void> {
    if (record.mode !== 'ranked') return;
    const matchId = typeof record.challenge.rankedMatchId === 'string'
        ? record.challenge.rankedMatchId.trim().slice(0, 100)
        : '';
    if (!isPlayerRankedMatchId(matchId)) return;
    await releaseQueuedPlayerRankedAdmission(kv, matchId, record.from);
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

function validateChallengeShape(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
    if (!isPlainRecord(value)) return { ok: false, error: 'Challenge must be an object.' };
    const unknown = Object.keys(value).filter((key) => !CHALLENGE_INPUT_FIELDS.has(key));
    if (unknown.length) return { ok: false, error: `Unknown challenge field: ${unknown[0]}.` };
    if (!isChallengeId(value.id)) return { ok: false, error: 'Challenge id is missing or malformed.' };
    if (value.accepted === true && value.declined === true) {
        return { ok: false, error: 'A challenge cannot be both accepted and declined.' };
    }
    if (value.accepted !== undefined && typeof value.accepted !== 'boolean') {
        return { ok: false, error: 'accepted must be a boolean.' };
    }
    if (value.declined !== undefined && typeof value.declined !== 'boolean') {
        return { ok: false, error: 'declined must be a boolean.' };
    }
    return { ok: true, value };
}

async function buildNewChallenge(
    raw: Record<string, unknown>,
    identityName: string,
    targetName: string,
): Promise<{ ok: true; challenge: Record<string, unknown>; record: AuthoritativeChallengeRecord } | { ok: false; status: number; error: string }> {
    const from = safeName(boundedString(raw.fromName, 64));
    const to = safeName(targetName);
    if (!from || from !== identityName) return { ok: false, status: 403, error: 'Cannot send a challenge as another player.' };
    if (!to || safeName(boundedString(raw.toName, 64)) !== to) {
        return { ok: false, status: 400, error: 'Challenge recipient does not match targetName.' };
    }
    if (from === to) return { ok: false, status: 400, error: 'You cannot challenge yourself.' };
    const blocked = await blockRelationship(from, to);
    if (blocked.aBlockedB || blocked.bBlockedA) {
        return { ok: false, status: 403, error: 'A player block prevents this challenge.' };
    }
    const mode = raw.mode ?? 'standard';
    if (!isPlayerChallengeMode(mode)) return { ok: false, status: 400, error: 'Unsupported challenge mode.' };
    if (mode === 'ranked' && !playerRankedV2AdmissionsEnabled()) {
        return { ok: false, status: 503, error: PLAYER_RANKED_V2_DISABLED_MESSAGE };
    }
    if (raw.battleId !== undefined && !isBattleId(raw.battleId)) {
        return { ok: false, status: 400, error: 'Malformed battleId.' };
    }
    if (raw.battleId && raw.sectorAttack !== true) {
        return { ok: false, status: 400, error: 'Only a sector-attack notice may carry a battleId before acceptance.' };
    }

    const [senderCharacter, targetCharacter] = await Promise.all([
        loadCharacter(from),
        loadCharacter(to),
    ]);
    if (!senderCharacter) return { ok: false, status: 404, error: 'Your character save was not found.' };
    if (!targetCharacter) return { ok: false, status: 404, error: `No player named "${targetName}" was found.` };

    let rankedAuthority: { matchId: string; seasonId: number; seasonEpoch: number } | null = null;
    if (mode === 'ranked') {
        const matchId = typeof raw.rankedMatchId === 'string' ? raw.rankedMatchId.trim().slice(0, 100) : '';
        const seasonId = raw.rankedSeasonId;
        const seasonEpoch = raw.rankedSeasonEpoch;
        if (!isPlayerRankedMatchId(matchId)
            || !Number.isSafeInteger(seasonId)
            || Number(seasonId) <= 0
            || !Number.isSafeInteger(seasonEpoch)
            || Number(seasonEpoch) <= 0) {
            return { ok: false, status: 409, error: 'A complete server-ranked match proof is required.' };
        }
        const admission = await getPlayerRankedAdmission(kv, matchId);
        const pair = [from, to].sort();
        const age = admission ? Date.now() - admission.createdAt : Number.POSITIVE_INFINITY;
        if (!admission
            || admission.phase !== 'queued'
            || admission.a !== pair[0]
            || admission.b !== pair[1]
            || age < 0
            || age > PLAYER_RANKED_ADMISSION_TTL_MS
            || admission.seasonId !== seasonId
            || admission.seasonEpoch !== seasonEpoch) {
            return { ok: false, status: 409, error: 'That ranked match proof is stale or belongs to another pairing.' };
        }
        rankedAuthority = {
            matchId: admission.matchId,
            seasonId: admission.seasonId,
            seasonEpoch: admission.seasonEpoch,
        };
    }

    if (raw.battleId) {
        const battle = await kv.get<PvpSession>(`pvp:${raw.battleId}`);
        const fighters = battle ? [safeName(battle.p1?.name ?? ''), safeName(battle.p2?.name ?? '')] : [];
        if (!battle || !fighters.includes(from) || !fighters.includes(to)) {
            return { ok: false, status: 403, error: 'Sector-attack notice does not match that battle.' };
        }
    }

    const displayFrom = boundedString(senderCharacter.name, 64) || boundedString(raw.fromName, 64);
    const displayTo = boundedString(targetCharacter.name, 64) || boundedString(raw.toName, 64);
    const safe: Record<string, unknown> = {
        id: raw.id,
        fromName: displayFrom,
        toName: displayTo,
        challenger: projectChallengerCharacter(senderCharacter),
        createdAt: Date.now(),
        mode,
    };
    const clanWarPoints = CLAN_WAR_POINTS_BY_MODE[mode] ?? 0;
    if (clanWarPoints > 0) safe.clanWarPoints = clanWarPoints;
    if (raw.sectorAttack === true) safe.sectorAttack = true;
    if (raw.battleId) safe.battleId = raw.battleId;
    if (raw.petParty === true) safe.petParty = true;
    if (raw.arenaMatch === true) safe.arenaMatch = true;
    if (raw.arenaSize === 2 || raw.arenaSize === 4) safe.arenaSize = raw.arenaSize;
    if (rankedAuthority) {
        safe.rankedMatchId = rankedAuthority.matchId;
        safe.rankedSeasonId = rankedAuthority.seasonId;
        safe.rankedSeasonEpoch = rankedAuthority.seasonEpoch;
    }

    const challengerPetId = boundedString(raw.challengerPetId, 80);
    if (challengerPetId && petById(senderCharacter, challengerPetId)) safe.challengerPetId = challengerPetId;
    const petIds = boundedIdList(raw.challengerPetIds, 2).filter((id) => !!petById(senderCharacter, id));
    if (petIds.length === 2) safe.challengerPetIds = petIds;
    const teamIds = boundedIdList(raw.challengerTeamIds, 4).filter((id) => !!petById(senderCharacter, id));
    if (teamIds.length) safe.challengerTeamIds = teamIds;
    if (Number.isSafeInteger(raw.petBattleSeed) && Number(raw.petBattleSeed) >= 0) safe.petBattleSeed = Number(raw.petBattleSeed);
    const petRankedToken = boundedString(raw.petRankedToken, 100);
    if (petRankedToken) safe.petRankedToken = petRankedToken;
    if (mode === 'rankedPet') safe.challengerPetRating = Number(senderCharacter.petRankedRating ?? 1000);
    const kageChallengeId = boundedString(raw.kageChallengeId, 100);
    const kageVillage = boundedString(raw.kageVillage, 64);
    if (kageChallengeId) safe.kageChallengeId = kageChallengeId;
    if (kageVillage) safe.kageVillage = kageVillage;

    const record: AuthoritativeChallengeRecord = {
        id: String(raw.id),
        from,
        to,
        mode,
        status: 'pending',
        createdAt: Number(safe.createdAt),
        challenge: safe,
    };
    return { ok: true, challenge: safe, record };
}

async function buildResolutionNotice(
    record: AuthoritativeChallengeRecord,
    raw: Record<string, unknown>,
    resolution: 'accepted' | 'declined',
): Promise<Record<string, unknown>> {
    const responder = await loadCharacter(record.to);
    const base = record.challenge;
    const notice: Record<string, unknown> = {
        ...base,
        fromName: boundedString(responder?.name, 64) || record.to,
        toName: boundedString((base.challenger as Record<string, unknown> | undefined)?.name, 64) || record.from,
        accepted: resolution === 'accepted',
        declined: resolution === 'declined',
    };
    if (record.battleId) notice.battleId = record.battleId;
    if (resolution === 'accepted' && responder) {
        const responderPetId = boundedString(raw.responderPetId, 80);
        const responderPet = petById(responder, responderPetId);
        if (responderPet) {
            notice.responderPetId = responderPetId;
            notice.responderPet = stripPetInlineImages([responderPet]) instanceof Array
                ? (stripPetInlineImages([responderPet]) as unknown[])[0]
                : responderPet;
        }
        const responderPetIds = boundedIdList(raw.responderPetIds, 2).filter((id) => !!petById(responder, id));
        if (responderPetIds.length === 2) {
            notice.responderPetIds = responderPetIds;
            notice.responderParty = stripPetInlineImages(responderPetIds.map((id) => petById(responder, id)!));
        }
        const responseTeamIds = Array.isArray(raw.responderTeam)
            ? boundedIdList(raw.responderTeam.map((pet) => isPlainRecord(pet) ? pet.id : ''), 4)
            : [];
        const responseTeam = responseTeamIds.map((id) => petById(responder, id)).filter(Boolean) as Record<string, unknown>[];
        if (responseTeam.length) notice.responderTeam = stripPetInlineImages(responseTeam);
        if (record.mode === 'rankedPet') notice.responderPetRating = Number(responder.petRankedRating ?? 1000);
    }
    return notice;
}

async function secureChallengeHandler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'player-challenge', 30, 60_000, identity.name))) return;

    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const body = parsed.body as Record<string, unknown>;

        if (req.method === 'DELETE') {
            const id = boundedString(body.challengeId, 80);
            const targetName = boundedString(body.targetName, 64);
            const fromName = boundedString(body.fromName, 64);
            if (!isChallengeId(id) || !targetName || !fromName) {
                return res.status(400).json({ error: 'targetName, fromName, and a valid challengeId are required.' });
            }
            const record = await loadChallengeRecord(id);
            if (!record) return res.status(404).json({ error: 'Challenge not found or expired.' });

            const resolved = record.status === 'accepted' || record.status === 'declined';
            const expectedTarget = resolved ? record.from : record.to;
            const expectedFrom = resolved ? record.to : record.from;
            if (safeName(targetName) !== expectedTarget || safeName(fromName) !== expectedFrom) {
                return res.status(409).json({ error: 'Challenge participants do not match the stored challenge.' });
            }
            if (!identity.admin && identity.name !== record.from && identity.name !== record.to) {
                return res.status(403).json({ error: 'Cannot clear another player\'s challenge.' });
            }
            if (record.status === 'session-started' && !identity.admin && identity.name === record.from) {
                return res.status(409).json({ error: 'That accepted battle has already started.' });
            }

            await removeFromInbox(expectedTarget, id);
            if (record.status === 'pending' && (identity.admin || identity.name === record.from)) {
                const cancelled = await cancelChallengeRecord(id, record.from);
                if (cancelled) await releaseRankedChallengeAdmission(cancelled);
                await clearExactOutgoing(record.from, id);
            } else if (resolved) {
                await clearExactOutgoing(record.from, id);
            }
            return res.status(200).json({ ok: true });
        }

        if (req.method !== 'POST') return res.status(405).end();

        const targetName = boundedString(body.targetName, 64);
        const shaped = validateChallengeShape(body.challenge);
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });
        if (!shaped.ok) return res.status(400).json({ error: shaped.error });
        const rawChallenge = shaped.value;
        const accepted = rawChallenge.accepted === true;
        const declined = rawChallenge.declined === true;
        const id = String(rawChallenge.id);

        if (accepted || declined) {
            const record = await loadChallengeRecord(id);
            if (!record) return res.status(404).json({ error: 'The original challenge was not found or has expired.' });
            if (!identity.admin && identity.name !== record.to) {
                return res.status(403).json({ error: 'Only the challenged player may accept or decline.' });
            }
            if (safeName(targetName) !== record.from || safeName(boundedString(rawChallenge.fromName, 64)) !== record.to) {
                return res.status(409).json({ error: 'Challenge response does not match the outstanding challenge.' });
            }
            if (accepted) {
                const blocked = await blockRelationship(record.from, record.to);
                if (blocked.aBlockedB || blocked.bBlockedA) {
                    return res.status(403).json({ error: 'A player block prevents accepting this challenge.' });
                }
            }

            const resolution: 'accepted' | 'declined' = accepted ? 'accepted' : 'declined';
            const battleId = boundedString(rawChallenge.battleId, 100);
            const petProtocol = record.mode === 'clanWarPet' || record.mode === 'rankedPet';
            let refreshedChallenger: unknown = null;
            if (accepted && petProtocol) {
                const stored = record.challenge;
                const arenaSize = stored.arenaMatch === true && (stored.arenaSize === 2 || stored.arenaSize === 4)
                    ? stored.arenaSize
                    : null;
                const challengerIds = arenaSize
                    ? boundedIdList(stored.challengerTeamIds, arenaSize)
                    : stored.petParty === true
                        ? boundedIdList(stored.challengerPetIds, 2)
                        : [boundedString(stored.challengerPetId, 80)].filter(Boolean);
                const responderIds = arenaSize
                    ? boundedIdList(
                        Array.isArray(rawChallenge.responderTeam)
                            ? rawChallenge.responderTeam.map((pet) => isPlainRecord(pet) ? pet.id : '')
                            : [],
                        arenaSize,
                    )
                    : stored.petParty === true
                        ? boundedIdList(rawChallenge.responderPetIds, 2)
                        : [boundedString(rawChallenge.responderPetId, 80)].filter(Boolean);
                const required = arenaSize ?? (stored.petParty === true ? 2 : 1);
                const [challengerCharacter, responderCharacter] = await Promise.all([
                    loadCharacter(record.from),
                    loadCharacter(record.to),
                ]);
                const challengerReady = challengerCharacter
                    && challengerIds.length === required
                    && new Set(challengerIds).size === required
                    && challengerIds.every((petId) => Boolean(petById(challengerCharacter, petId)));
                const responderReady = responderCharacter
                    && responderIds.length === required
                    && new Set(responderIds).size === required
                    && responderIds.every((petId) => Boolean(petById(responderCharacter, petId)));
                if (!challengerReady || !responderReady) {
                    return res.status(409).json({ error: 'Both sides must reselect eligible, combat-ready carried pets.' });
                }
                refreshedChallenger = projectChallengerCharacter(challengerCharacter);
            }
            if (accepted && !petProtocol) {
                if (!isBattleId(battleId) || record.battleId !== battleId) {
                    return res.status(409).json({ error: 'Accepted challenge is not bound to its server-created battle.' });
                }
                const battle = await kv.get<PvpSession>(`pvp:${battleId}`);
                const p1 = safeName(battle?.p1?.name ?? '');
                const p2 = safeName(battle?.p2?.name ?? '');
                if (!battle || battle.challengeId !== id || p1 !== record.from || p2 !== record.to) {
                    return res.status(409).json({ error: 'Accepted battle does not match the original challenge.' });
                }
            }

            const resolutionResult = await resolveChallengeRecord({
                id,
                responder: record.to,
                target: record.from,
                resolution,
                ...(battleId ? { battleId } : {}),
            });
            if (!resolutionResult) {
                return res.status(409).json({ error: 'Challenge was already resolved differently or no longer matches.' });
            }
            if (resolution === 'declined') await releaseRankedChallengeAdmission(resolutionResult.record);

            const noticeRecord = refreshedChallenger
                ? {
                    ...resolutionResult.record,
                    challenge: { ...resolutionResult.record.challenge, challenger: refreshedChallenger },
                }
                : resolutionResult.record;
            const notice = await buildResolutionNotice(noticeRecord, rawChallenge, resolution);
            await Promise.all([
                removeFromInbox(record.to, id),
                clearExactOutgoing(record.from, id),
            ]);
            await enqueueChallenge(record.from, notice);
            kickPlayer(record.from, 'challenge');
            return res.status(200).json({ ok: true, replay: resolutionResult.replay });
        }

        if (rawChallenge.accepted !== undefined || rawChallenge.declined !== undefined) {
            return res.status(400).json({ error: 'False response flags must be omitted.' });
        }

        const creator = identity.admin
            ? safeName(boundedString(rawChallenge.fromName, 64))
            : identity.name;
        const built = await buildNewChallenge(rawChallenge, creator, targetName);
        if (!built.ok) return res.status(built.status).json({ error: built.error });

        if (built.record.mode === 'rankedPet' && !petRankedStartsEnabled()) {
            return res.status(503).json({ error: PET_RANKED_DISABLED_REASON });
        }
        if (!built.challenge.battleId) {
            const block = challengeBlock(onlineStore.get(built.record.to), built.record.mode);
            if (block) return res.status(block.status).json({ error: block.error });
        }

        const senderKey = outgoingKey(built.record.from);
        if (!built.challenge.battleId) {
            const prior = await kv.get<{ targetName?: string; challengeId?: string }>(senderKey);
            if (prior?.challengeId && prior.targetName) {
                await removeFromInbox(String(prior.targetName), String(prior.challengeId));
                const cancelled = await cancelChallengeRecord(String(prior.challengeId), built.record.from);
                if (cancelled) await releaseRankedChallengeAdmission(cancelled);
            }
        }

        if (!(await saveChallengeRecord(built.record))) {
            const existing = await loadChallengeRecord(built.record.id);
            if (existing?.from === built.record.from && existing.to === built.record.to && existing.mode === built.record.mode) {
                await enqueueChallenge(existing.to, existing.challenge);
                if (!existing.challenge.battleId) {
                    await kv.set(outgoingKey(existing.from), {
                        targetName: existing.to,
                        challengeId: existing.id,
                        createdAt: existing.createdAt,
                    }, { ex: CHALLENGE_TTL });
                }
                kickPlayer(existing.to, 'challenge');
                return res.status(200).json({ ok: true, replay: true, challengeId: built.record.id });
            }
            return res.status(409).json({ error: 'That challenge id is already in use. Create a fresh challenge and retry.' });
        }
        await enqueueChallenge(built.record.to, projectChallenge(clampClanWarPoints(built.challenge)) as Record<string, unknown>);
        if (!built.challenge.battleId) {
            await kv.set(senderKey, {
                targetName: built.record.to,
                challengeId: built.record.id,
                createdAt: built.record.createdAt,
            }, { ex: CHALLENGE_TTL });
        }

        kickPlayer(built.record.to, 'challenge');
        return res.status(200).json({ ok: true, challengeId: built.record.id });
    } catch (err) {
        console.error('[challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    return secureChallengeHandler(req, res);
}
