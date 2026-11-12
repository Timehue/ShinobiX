/**
 * Seeds and rescales Cinderhold's 30 NPC accounts (2026-11-08).
 *
 * Each NPC is a real `save:<slug>` + `auth:<slug>` account, so every existing
 * path (PvP sealing, pets, decks, profiles, presence, admin control) treats it
 * like a player. The auth row has NO password hash: password login fails closed
 * (verifyAgainst), and the only way in is an admin control token
 * (api/admin/npc-possess.ts).
 *
 * The save is rebuilt from the roster (shared/npc-village-roster.ts) at the
 * NPC's scaled level on every daily pass. That keeps gear and jutsu legal for
 * the level, and it also wipes anything an admin-controlled NPC earned (ryo,
 * seals, XP, items): NPC accounts keep no economy. Pets keep their ids, so an
 * NPC's companions persist across rebuilds.
 */
import { cinderholdWorldModel } from '../shared/cinderhold-world-models.js';
import { kv } from './_storage.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { playerSessionsEnabled } from './_auth.js';
import { rankTitleForLevel } from './_xp-engine.js';
import { commitPlayerSaveExact } from './save/_commit-player-save.js';
import { applyCanonicalFirstSave } from './save/_first-save-baseline.js';
import { authKey } from './player-auth.js';
import { COMBAT_RESOURCES_V2, CHAKRA_BASE_V2, STAMINA_BASE_V2, maxChakraForLevel, maxHpForLevel, maxStaminaForLevel } from './_xp-engine.js';
import { createOwnedPet } from './pet/_owned-pet.js';
import { NPC_VILLAGE, NPC_GATE_SECTOR } from '../shared/npc-village.js';
import { WORLD_GEO_VERSION } from '../shared/sector-geo.js';
import { NPC_VILLAGE_ROSTER, npcLoadoutForLevel, npcSavedBloodlines, type NpcShinobi } from '../shared/npc-village-roster.js';
import { npcLevelFor, npcPetLevelFor, readNpcVillageScaling, NPC_MIN_LEVEL, NPC_SCALING_FLOOR } from './_npc-village-scaling.js';
import { MAX_LEVEL } from './_xp-engine.js';
import { growthPointsEarned, normalizePetGrowth, petGrowthBaseStats, PET_MAX_LEVEL, type PetGrowthAttribute, type PetGrowthStat } from './pet/_growth.js';
import { gainServerPetXp } from './pet/_progress.js';
import { PET_CATALOG } from './pet/_catalog.js';
import { npcPossessKey } from './_npc-possession.js';
import { withKvLock } from './_lock.js';
import { npcDuelRecordKey, type NpcDuelRecord } from './_npc-duel.js';
import { npcKitForLevel } from './_npc-kit.js';
import { REGISTRY_KEY, buildPublicPlayerIndexEntry } from './player/_public-index.js';
import { clanRecordKey } from './_utils.js';
import { NPC_CLANS, isNpcClanRecord, npcClanOfMember, type NpcClan } from '../shared/npc-clans.js';
import { publishNpcAvatar, publishNpcAvatars } from './_npc-avatars.js';
import { readKvProjection } from './_storage-projection.js';
import { onlineStore } from './_realtime/online-store.js';
import { forgetNpcOwnership, npcOwnsAccount } from './_npc-ownership.js';
import { forgetNpcWarParticipants } from './_npc-war-roster.js';

type SaveRecord = Record<string, unknown>;
export const saveKeyFor = (npc: NpcShinobi) => `save:${npc.id}`;

const ATTRIBUTE_FOR: Record<PetGrowthStat, PetGrowthAttribute> = { hp: 'vitality', attack: 'power', defense: 'guard', speed: 'agility' };
const GROWTH_STATS = Object.keys(ATTRIBUTE_FOR) as PetGrowthStat[];

/** Each stat's catalog-wide mean, so a species' strengths compare across stats of different scales (HP is ~8x the rest). */
let catalogMeans: Record<PetGrowthStat, number> | null = null;
function statMeans(): Record<PetGrowthStat, number> {
    if (catalogMeans) return catalogMeans;
    const sums = { hp: 0, attack: 0, defense: 0, speed: 0 };
    let n = 0;
    for (const template of Object.values(PET_CATALOG)) {
        if (!GROWTH_STATS.every((stat) => Number(template[stat]) > 0)) continue;
        for (const stat of GROWTH_STATS) sums[stat] += Number(template[stat]);
        n++;
    }
    catalogMeans = Object.fromEntries(GROWTH_STATS.map((stat) => [stat, n ? sums[stat] / n : 1])) as Record<PetGrowthStat, number>;
    return catalogMeans;
}

/** XP a level-1 pet needs to reach `level` on the server's own curve (api/pet/_progress.ts). */
export function petXpToReach(level: number): number {
    let xp = 0;
    for (let l = 1; l < Math.min(PET_MAX_LEVEL, Math.max(1, Math.floor(level))); l++) xp += Math.max(100, l * 100);
    return xp;
}

/**
 * A companion raised to `level` the way a player's is: levelled through the
 * game's own XP path (gainServerPetXp: the per-level move power, the level-50
 * unlock), then every Growth Point spent, leaning into what the species does
 * best relative to the whole catalog (half into its strongest stat, a quarter
 * into its second, the rest split). Moves and the signature unlock from the level.
 */
export function grownNpcPet(pet: Record<string, unknown>, level: number): Record<string, unknown> {
    const target = Math.max(1, Math.min(PET_MAX_LEVEL, Math.floor(level)));
    const leveled = target > 1 ? gainServerPetXp({ ...pet, level: 1, xp: 0 }, petXpToReach(target)) : { ...pet, level: 1, xp: 0 };
    const base = petGrowthBaseStats(leveled);
    const means = statMeans();
    const ranked = [...GROWTH_STATS].sort((a, b) => base[b] / means[b] - base[a] / means[a] || a.localeCompare(b));
    const points = growthPointsEarned(target);
    const first = Math.floor(points / 2), second = Math.floor(points / 4);
    const rest = points - first - second;
    const allocation = { vitality: 0, power: 0, guard: 0, agility: 0 };
    allocation[ATTRIBUTE_FOR[ranked[0]!]] = first;
    allocation[ATTRIBUTE_FOR[ranked[1]!]] = second;
    allocation[ATTRIBUTE_FOR[ranked[2]!]] = Math.ceil(rest / 2);
    allocation[ATTRIBUTE_FOR[ranked[3]!]] = Math.floor(rest / 2);
    return normalizePetGrowth({ ...leveled, growthAllocation: allocation });
}

/**
 * A player's four companions are never all one level. Around the village's pet
 * level the signature companion stands highest and the others step down, the
 * spread summing to zero so the team's average is the scaled pet level.
 */
export const NPC_PET_LEVEL_SPREAD: readonly number[] = [2, 1, -1, -2];
export function npcPetLevels(npc: NpcShinobi, petLevel: number): number[] {
    const order = [...npc.pets.keys()].sort((a, b) => Number(!!npc.pets[b]!.signature) - Number(!!npc.pets[a]!.signature) || a - b);
    const levels: number[] = new Array(npc.pets.length).fill(petLevel);
    order.forEach((index, rank) => { levels[index] = Math.max(1, Math.min(PET_MAX_LEVEL, petLevel + (NPC_PET_LEVEL_SPREAD[rank] ?? 0))); });
    return levels;
}

/** A player's level never goes down: an NPC keeps the level it has reached, and a small per-NPC lean (−1, 0, +1) keeps a rank from moving in lockstep. */
export function npcLevelLean(npc: NpcShinobi): number {
    let h = 2166136261;
    for (const ch of `${npc.id}:lean`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 3) - 1;
}

/** What the account has really done, carried into each rebuild (never invented). */
export type NpcHistory = { wins?: number; days?: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirror of the ranked fields a new character is created with (shinobij.client/src/lib/create-character.ts). */
export const NPC_UNRANKED_DEFAULTS = Object.freeze({
    rankedRating: 1000, rankedWins: 0, rankedLosses: 0,
    petRankedRating: 1000, petRankedWins: 0, petRankedLosses: 0,
});

/**
 * The NPC's whole save at `level`, its pets around `petLevel` (api/_npc-village-scaling.ts).
 * Pure: the same NPC at the same levels and history always builds the same save.
 * `history.wins` is its real duel record (npc-village:record) shown as PvP kills,
 * and `history.days` the UTC days its account has existed, shown as its login
 * streak (it is in the world every day).
 */
export function buildNpcSave(npc: NpcShinobi, level: number, prior?: SaveRecord | null, petLevel = 1, history: NpcHistory = {},
    opts: { takenClans?: ReadonlySet<string> } = {}): SaveRecord {
    const base = applyCanonicalFirstSave({ name: npc.name, village: NPC_VILLAGE });
    const maxHp = maxHpForLevel(level);
    const loadout = npcLoadoutForLevel(npc, level);
    const kit = npcKitForLevel(npc, level);
    const maxChakra = COMBAT_RESOURCES_V2 ? CHAKRA_BASE_V2 : maxChakraForLevel(level);
    const maxStamina = COMBAT_RESOURCES_V2 ? STAMINA_BASE_V2 : maxStaminaForLevel(level);
    // Rolled from the pet's own id, so the same level always builds the same
    // pet (a rebuild that changes nothing writes nothing). A Cinderhold
    // companion is well kept: content, never "restless".
    const petLevels = npcPetLevels(npc, petLevel);
    const pets: Array<Record<string, unknown>> = npc.pets.map((p, index) => ({
        ...grownNpcPet(createOwnedPet(p.templateId, { origin: 'wild', instanceId: p.instanceId, trait: p.trait, secureInt: seededInt(p.instanceId) } as never), petLevels[index] ?? petLevel),
        happiness: 100,
        nickname: p.nickname,
    }));
    const worldModel = cinderholdWorldModel(npc.id, npc.avatar);
    const character: SaveRecord = {
        ...base,
        ...loadout,
        ...(worldModel ? { playerModel: worldModel } : {}),
        // Weapon and armor from the level band, the combat slots from its kit.
        equipment: { ...loadout.equipment, ...kit.equipment },
        village: NPC_VILLAGE,
        onboardingStep: 'done',
        ryo: 0,
        inventory: [],
        itemStacks: kit.itemStacks,
        hp: maxHp, maxHp, chakra: maxChakra, maxChakra, stamina: maxStamina, maxStamina,
        rankTitle: rankTitleForLevel({} as never, level),
        totalPvpKills: Math.max(0, Math.floor(Number(history.wins) || 0)),
        // The unranked standing every new character starts with
        // (shinobij.client/src/lib/create-character.ts). Defaults only: an NPC
        // never queues for ranked, so it never earns or loses any.
        ...NPC_UNRANKED_DEFAULTS,
        ...(Number(history.days) > 0 ? { loginStreak: Math.floor(Number(history.days)) } : {}),
        pets,
        activePetId: npc.pets.find((p) => p.signature)?.instanceId ?? pets[0]?.id,
        // Its permanent Cinderhold clan (shared/npc-clans.ts), part of the build
        // so a rebuild keeps it, as a player's save keeps theirs. Not when a
        // player clan already holds that name: the NPC would claim their clan.
        ...npcClanFields(npc.id, opts.takenClans),
    };
    return {
        ...(prior && typeof prior._saveVersion === 'number' ? { _saveVersion: prior._saveVersion } : {}),
        character,
        savedBloodlines: npcSavedBloodlines(npc),
        currentSector: NPC_GATE_SECTOR,
        worldGeoV: WORLD_GEO_VERSION,
    };
}

function npcClanFields(npcId: string, takenClans?: ReadonlySet<string>): { clan?: string; clanFounder?: boolean } {
    const clan = npcClanOfMember(npcId);
    return clan && !takenClans?.has(clan.name) ? { clan: clan.name, clanFounder: clan.founder === npcId } : {};
}

// Moved to api/_npc-ownership.ts (2026-11-11) so every NPC driver can ask it
// without loading the seeder; re-exported for the existing callers.
export { npcOwnsAccount };

/** The Cinderhold clan names a PLAYER clan already holds (their record exists and is not an NPC clan's). */
export async function takenNpcClanNames(): Promise<Set<string>> {
    const records = await kv.mget<Array<SaveRecord | null>>(...NPC_CLANS.map((clan) => clanRecordKey(clan.name)));
    return new Set(NPC_CLANS.filter((_, i) => !!records[i] && !isNpcClanRecord(records[i])).map((clan) => clan.name));
}

/**
 * `warnings`: expected, lasting conditions an operator should know about (a
 * player clan holding a Cinderhold clan's name). Unlike `failures` they do not
 * mark the daily pass incomplete, so it is not retried forever.
 */
export type NpcSeedResult = { seeded: string[]; rescaled: string[]; unchanged: string[]; skipped: string[]; failures: string[]; warnings: string[] };

/** A small deterministic integer source (FNV seed, xorshift) standing in for the crypto roll. */
function seededInt(seed: string): (min: number, max: number) => number {
    let x = 2166136261;
    for (let i = 0; i < seed.length; i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (min, max) => {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        return min + ((x >>> 0) % Math.max(1, max - min));
    };
}

/** What a build is, minus its version stamp: equal fingerprints mean nothing to write. */
function buildFingerprint(save: SaveRecord): string {
    const { _saveVersion: _v, ...rest } = save;
    return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 24);
}

/**
 * Creates any missing NPC account and rebuilds every save at its scaled level.
 * An NPC currently under admin control is skipped so a live session is never
 * rewritten underneath the admin. Idempotent.
 */
export async function seedNpcVillage(now = Date.now(), isPossessed: (slug: string) => Promise<boolean> = async () => false): Promise<NpcSeedResult> {
    const result: NpcSeedResult = { seeded: [], rescaled: [], unchanged: [], skipped: [], failures: [], warnings: [] };
    const scaling = await readNpcVillageScaling();
    let takenClans = new Set<string>();
    try { takenClans = await takenNpcClanNames(); } catch (error) { result.failures.push(`clans: ${(error as Error).message}`); }
    for (const npc of NPC_VILLAGE_ROSTER) {
        try {
            const outcome = await rebuildNpcAccount(npc, now, { scaling, takenClans, isPossessed });
            if (outcome === 'taken') result.warnings.push(`${npc.id}: the account name belongs to a player; this NPC is not seeded`);
            else result[outcome.outcome].push(npc.id);
        } catch (error) {
            result.failures.push(`${npc.id}: ${(error as Error).message}`);
        }
    }
    // An account created (or found to be a player's) on this pass is known to
    // every NPC driver at once (api/_npc-ownership.ts).
    forgetNpcOwnership();
    forgetNpcWarParticipants();
    await seedNpcClans(now).then((clans) => { result.failures.push(...clans.failures); result.warnings.push(...clans.warnings); })
        .catch((error) => { result.failures.push(`clans: ${(error as Error).message}`); });
    await indexNpcVillage(now).catch((error) => { result.failures.push(`registry: ${(error as Error).message}`); });
    // The portrait a viewer finds by name while the NPC is online (api/_npc-avatars.ts).
    await readOwnedNpcSaves().then(publishNpcAvatars)
        .catch((error) => { result.failures.push(`avatars: ${(error as Error).message}`); });
    return result;
}

type RebuildContext = {
    scaling: Awaited<ReturnType<typeof readNpcVillageScaling>>;
    takenClans: ReadonlySet<string>;
    isPossessed: (slug: string) => Promise<boolean>;
};
type RebuildOutcome = 'taken' | { outcome: 'seeded' | 'rescaled' | 'unchanged' | 'skipped'; save: SaveRecord | null; prior?: SaveRecord | null };

/**
 * Creates or rebuilds ONE NPC's account at its scaled level, under its
 * possession lock and its save lock (the daily pass runs this for each of the
 * thirty; a duel win runs it for one, reseedNpc). Returns the save as it now
 * stands, or 'taken' when the name belongs to a player.
 */
async function rebuildNpcAccount(npc: NpcShinobi, now: number, ctx: RebuildContext): Promise<RebuildOutcome> {
    const base = ctx.scaling?.baseLevel ?? NPC_SCALING_FLOOR;
    // Held across check + rebuild, and taken by admin takeover too, so a
    // takeover can never start between the check and the commit.
    return withKvLock(npcPossessKey(npc.id), async (): Promise<RebuildOutcome> => {
        if (await ctx.isPossessed(npc.id)) return { outcome: 'skipped', save: null };
        const key = saveKeyFor(npc);
        // Every save commit holds the save's own lock (commitPlayerSaveRecord's contract).
        return withKvLock(key, async (): Promise<RebuildOutcome> => {
            const prior = await kv.get<SaveRecord>(key);
            // A password-less account is never created without session
            // tokens (CLAUDE.md); NPCs are useless then anyway (no duels,
            // no admin control), so the village simply waits for them.
            if (!prior && !playerSessionsEnabled()) return { outcome: 'skipped', save: null };
            const auth = await kv.get<Record<string, unknown>>(authKey(npc.id));
            // The account name may already belong to a PLAYER (a name they
            // registered before it became an NPC's). Only an account this
            // seeder created (auth row stamped npcVillage) is ever written:
            // anything else is a real person's character and login.
            if (!npcOwnsAccount(auth, prior)) return 'taken';
            const record = await kv.get<NpcDuelRecord>(npcDuelRecordKey(npc.id)).catch(() => null);
            const createdAt = Number(auth?.createdAt) || now;
            const history: NpcHistory = { wins: record?.wins ?? 0, days: Math.floor(now / DAY_MS) - Math.floor(createdAt / DAY_MS) + 1 };
            const priorLevel = Math.floor(Number((prior?.character as SaveRecord | undefined)?.level) || 0);
            const level = Math.max(priorLevel, Math.min(MAX_LEVEL, Math.max(NPC_MIN_LEVEL, npcLevelFor(npc.rank, 1), npcLevelFor(npc.rank, base) + npcLevelLean(npc))));
            const built = buildNpcSave(npc, level, prior, npcPetLevelFor(npc.rank, ctx.scaling?.petBaseLevel), history, { takenClans: ctx.takenClans });
            const fingerprint = buildFingerprint(built);
            // The stored CONTENT must still be exactly the build: anything an
            // admin-controlled NPC earned or changed makes it differ, and is wiped.
            if (prior && buildFingerprint(prior) === fingerprint && auth) return { outcome: 'unchanged', save: prior, prior };
            // Password-less on purpose: no hash, no salt, never a guest. Stamped
            // BEFORE the save, so a crash between the two never leaves a save
            // with no NPC stamp (which npcOwnsAccount would read as a player's).
            if (!auth) await kv.set(authKey(npc.id), { createdAt: now, npcVillage: true });
            await commitPlayerSaveExact(kv, { playerName: npc.id, saveKey: key, expected: prior ?? null, intended: built });
            return { outcome: prior ? 'rescaled' : 'seeded', save: built, prior: prior ?? null };
        }, { failClosed: true });
    }, { failClosed: true });
}

/** How far back a new NPC clan's founding and its members' joining are dated: past the clan-war age (7 d) and membership (48 h) rules. */
export const NPC_CLAN_BACKDATE_MS = 10 * DAY_MS;
const EMPTY_CLAN_TREASURY = Object.freeze({ ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, provisions: 0, items: [] as unknown[] });

function storedTime(value: unknown): number | null {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * One NPC clan's record. Pure. Only roster and identity fields are authored
 * (name, village, founder, members, join dates, officer roles) and the economy
 * is pinned empty (no treasury, no upgrades, no join requests): Cinderhold's
 * clans earn and hold nothing. Everything the server legitimately writes into a
 * clan record (war history, campaign history, receipts, XP) is carried over.
 * The founding and join dates are set once and never move, so the clan-war age
 * and membership rules read the same on every rebuild.
 */
export function buildNpcClanRecord(clan: NpcClan, prior: SaveRecord | null, characters: ReadonlyMap<string, SaveRecord>, now: number): SaveRecord {
    const createdAt = storedTime(prior?.serverCreatedAt) ?? storedTime(prior?.createdAt) ?? now - NPC_CLAN_BACKDATE_MS;
    const priorJoined = prior?.memberJoinedAt && typeof prior.memberJoinedAt === 'object' ? prior.memberJoinedAt as Record<string, unknown> : {};
    const priorMembers = new Map((Array.isArray(prior?.members) ? prior!.members as SaveRecord[] : [])
        .map((member) => [String(member?.name ?? '').toLowerCase().replace(/[^a-z0-9\-_]/g, ''), member]));
    const roster = clan.members.map((id) => NPC_VILLAGE_ROSTER.find((npc) => npc.id === id)!);
    const founder = roster.find((npc) => npc.id === clan.founder)!;
    const month = new Date(now).toISOString().slice(0, 7);
    const members = roster.map((npc) => {
        const before = priorMembers.get(npc.id) ?? {};
        return {
            battleContrib: 0, eventContrib: 0, missionContrib: 0, month,
            ...before,
            name: npc.name, village: NPC_VILLAGE, level: Math.max(1, Math.floor(Number(characters.get(npc.id)?.level) || 1)),
            specialty: npc.specialty, isFounder: npc.id === clan.founder,
        };
    });
    return {
        xp: 0, level: 1, notices: [], warHistory: [],
        ...(prior ?? {}),
        name: clan.name,
        village: NPC_VILLAGE,
        founderName: founder.name,
        createdAt,
        serverCreatedAt: createdAt,
        members,
        memberJoinedAt: Object.fromEntries(roster.map((npc) => [npc.id, storedTime(priorJoined[npc.id]) ?? createdAt])),
        roleOverrides: Object.fromEntries(roster.filter((npc) => clan.officers.includes(npc.id)).map((npc) => [npc.name, 'Officer'])),
        joinRequests: [],
        treasury: { ...EMPTY_CLAN_TREASURY, items: [] },
        upgrades: {},
    };
}

export type NpcClanSeedResult = { written: string[]; unchanged: string[]; failures: string[]; warnings: string[] };

/**
 * Writes Cinderhold's three clan records straight to storage (never through
 * /api/save, which refuses NPC clans), each under its own record lock, and only
 * when the authored part changed. A clan name already held by a PLAYER clan is
 * left alone and reported: that clan stays theirs.
 */
export async function seedNpcClans(now = Date.now()): Promise<NpcClanSeedResult> {
    const result: NpcClanSeedResult = { written: [], unchanged: [], failures: [], warnings: [] };
    const ids = NPC_CLANS.flatMap((clan) => clan.members);
    const saves = await kv.mget<Array<SaveRecord | null>>(...ids.map((id) => `save:${id}`));
    const characters = new Map<string, SaveRecord>();
    ids.forEach((id, i) => { const ch = saves[i]?.character; if (ch && typeof ch === 'object') characters.set(id, ch as SaveRecord); });
    for (const clan of NPC_CLANS) {
        try {
            const key = clanRecordKey(clan.name);
            const outcome = await withKvLock(key, async () => {
                const prior = await kv.get<SaveRecord>(key);
                if (prior && !isNpcClanRecord(prior)) return 'taken' as const;
                const next = buildNpcClanRecord(clan, prior, characters, now);
                if (prior && isDeepStrictEqual(prior, next)) return 'unchanged' as const;
                await kv.set(key, next);
                return 'written' as const;
            }, { failClosed: true });
            // A lasting state, not a fault: the daily pass is complete without it.
            if (outcome === 'taken') result.warnings.push(`clan ${clan.name}: the name belongs to a player clan`);
            else result[outcome].push(clan.name);
        } catch (error) {
            result.failures.push(`clan ${clan.name}: ${(error as Error).message}`);
        }
    }
    return result;
}

/**
 * Lists every NPC in `player:registry`, the public index a player's own saves
 * keep, so its profile opens like an offline player's while it is off the map
 * (wounded, logged off, admin-played) instead of reading "not on the roster".
 * Leaderboards, census, scaling and telemetry already skip NPC rows. One write
 * for all thirty, and only when a row changed.
 */
/**
 * Every NPC's save in roster order, or null where the account name belongs to
 * a PLAYER (npcOwnsAccount): the registry row and the portrait rows are that
 * player's, never the NPC's to write.
 */
export async function readOwnedNpcSaves(): Promise<Array<SaveRecord | null>> {
    const [saves, auths] = await Promise.all([
        kv.mget<Array<SaveRecord | null>>(...NPC_VILLAGE_ROSTER.map(saveKeyFor)),
        kv.mget<Array<Record<string, unknown> | null>>(...NPC_VILLAGE_ROSTER.map((npc) => authKey(npc.id))),
    ]);
    return NPC_VILLAGE_ROSTER.map((_npc, i) => (npcOwnsAccount(auths[i], saves[i]) ? saves[i] ?? null : null));
}

export async function indexNpcVillage(now = Date.now()): Promise<number> {
    const saves = await readOwnedNpcSaves();
    const existing = (await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY).catch(() => null)) ?? {};
    const patch: Record<string, unknown> = {};
    NPC_VILLAGE_ROSTER.forEach((npc, i) => {
        const entry = npcRegistryPatch(npc, saves[i]?.character, existing[npc.id], now);
        if (entry) patch[npc.id] = entry;
    });
    if (Object.keys(patch).length) await kv.hset(REGISTRY_KEY, patch);
    return Object.keys(patch).length;
}

/** The registry row to write for this NPC, or null when its stored row (`prior`) is still current. */
function npcRegistryPatch(npc: NpcShinobi, character: unknown, prior: unknown, now: number): Record<string, unknown> | null {
    if (!character || typeof character !== 'object') return null;
    const parsed = typeof prior === 'string' ? (() => { try { return JSON.parse(prior) as Record<string, unknown>; } catch { return null; } })() : prior as Record<string, unknown> | null;
    // "Last seen" is real: the presence tick stamps the moment the NPC
    // leaves the map (api/_npc-presence.ts), so a rebuild while it is away
    // keeps that stamp. Only an NPC on the map now is seen now.
    const online = !!onlineStore.get(npc.name);
    const priorSeen = Number(parsed?.lastSeen) || 0;
    const entry = buildPublicPlayerIndexEntry(character, npc.id, now, online || !priorSeen ? now : priorSeen);
    const { lastSeen: _a, ...next } = entry as unknown as Record<string, unknown>;
    const { lastSeen: _b, ...was } = (parsed ?? {}) as Record<string, unknown>;
    // An online NPC's half-day-old stamp is refreshed too, as a playing player's saves refresh theirs.
    const stale = !parsed || JSON.stringify(next) !== JSON.stringify(was) || (online && now - priorSeen > DAY_MS / 2);
    return stale ? entry as unknown as Record<string, unknown> : null;
}

/**
 * Rebuilds ONE NPC now (after a duel win changed its record), under the same
 * locks as the daily pass: its save, its own registry row (one projected field
 * read and a one-field write, never the whole registry) and its own portrait
 * rows. The clans, the other twenty-nine NPCs and the full registry are the
 * daily pass's.
 */
export async function reseedNpc(npcId: string, now = Date.now()): Promise<void> {
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.id === npcId);
    if (!npc) return;
    const { isNpcPossessed } = await import('./_npc-possession.js');
    const clan = npcClanOfMember(npc.id);
    const [scaling, clanRecord] = await Promise.all([
        readNpcVillageScaling(),
        clan ? kv.get<SaveRecord>(clanRecordKey(clan.name)) : Promise.resolve(null),
    ]);
    // Only its own clan's name matters to its build (npcClanFields).
    const takenClans = new Set<string>(clan && clanRecord && !isNpcClanRecord(clanRecord) ? [clan.name] : []);
    const rebuilt = await rebuildNpcAccount(npc, now, { scaling, takenClans, isPossessed: (slug) => isNpcPossessed(slug, now) });
    if (rebuilt === 'taken' || !rebuilt.save) return;
    const [row] = await readKvProjection(kv, [REGISTRY_KEY], { entry: [npc.id] });
    const entry = npcRegistryPatch(npc, rebuilt.save.character, row?.entry, now);
    if (entry) await kv.hset(REGISTRY_KEY, { [npc.id]: entry });
    // Its portrait rows only when its portrait (or name) changed: a win
    // changes neither, so it reads no avatar row and takes no lock.
    const before = rebuilt.prior?.character as SaveRecord | undefined;
    const after = rebuilt.save.character as SaveRecord | undefined;
    if (!before || before.avatarImage !== after?.avatarImage || before.name !== after?.name) await publishNpcAvatar(npc, rebuilt.save);
}
