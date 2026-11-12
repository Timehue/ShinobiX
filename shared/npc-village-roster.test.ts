/*
 * Proves the Cinderhold NPC roster (shared/npc-village-roster.ts) is made only
 * of things the real game accepts for a player character: the server bloodline
 * sanitizer, PvP hydration at every level band, the pet catalog + 3D roster +
 * Pet Arena picker, the Chronicle deck resolver, and the account-name gates.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    NPC_ACCOUNT_SLUGS,
    NPC_RANK_AI_TIER,
    NPC_RANK_LEVEL_OFFSET,
    NPC_VILLAGE_ROSTER,
    isNpcAccount,
    npcBySlug,
    npcCanonicalSlug,
    npcElementsForLevel,
    npcGearForLevel,
    npcJutsuLevelCap,
    npcLoadoutForLevel,
    npcSavedBloodlines,
    npcStatCap,
    npcStatsForLevel,
    npcEarnedForLevel,
    type NpcRank,
    type NpcShinobi,
} from './npc-village-roster.js';
import { normalizePlayerBloodlineJutsus } from '../api/bloodlines/_jutsu-schema.js';
import { bloodlinePoints, enforceBloodlineBudget, pointBudgetForRank } from '../api/_jutsu-points.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { safeName } from '../api/_utils.js';
import { hasStaffImpersonationName, isCleanPlayerName, isCleanText, TEXT_LIMITS } from '../api/_text-moderation.js';
import { isPresetAvatar, LOADOUT_CAP_BASE } from '../api/_entitlements.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import { allocatedStatPoints, earnedForLevel, levelForEarned } from '../api/_xp-engine.js';
import {
    countChronicleCards,
    getChronicleCard,
    MAIN_DECK_SIZE,
    tributeCountForLevel,
    validateDeckIds,
} from './chronicle-duel.js';
import { APPROVED_ROSTER_MODEL_IDS } from '../shinobij.client/src/lib/pet-3d-roster.js';

process.env.SHINOBIX_QA_MEMORY_KV ??= '1';
process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';

type Session = typeof import('../api/pvp/session.js');
let session: Session;
let sanitizeBloodlines: typeof import('../api/save/_sanitize-bloodlines.js');
let playerAuth: typeof import('../api/player-auth.js');
let ownedPet: typeof import('../api/pet/_owned-pet.js');
let arena: typeof import('../api/_pet-tactics/arena-showdown.js');
let chronicleDeck: typeof import('../api/card-clash/_deck.js');

before(async () => {
    session = await import('../api/pvp/session.js');
    sanitizeBloodlines = await import('../api/save/_sanitize-bloodlines.js');
    playerAuth = await import('../api/player-auth.js');
    ownedPet = await import('../api/pet/_owned-pet.js');
    arena = await import('../api/_pet-tactics/arena-showdown.js');
    chronicleDeck = await import('../api/card-clash/_deck.js');
});

// No roster NPC is the Kage: the seats are filled by defeated story Kages (api/_npc-village-leaders.ts).
const RANK_COUNTS: Record<NpcRank, number> = { kage: 0, commander: 3, elite: 5, jonin: 7, chunin: 7, genin: 8 };
const A_RANKS = new Set<NpcRank>(['kage', 'commander', 'elite', 'jonin']);
const LEVELS = [1, 20, 40, 60, 80, 100];
const byRank = (rank: NpcRank) => NPC_VILLAGE_ROSTER.filter((npc) => npc.rank === rank);
const isBloodlineJutsu = (npc: NpcShinobi, id: string) => npc.bloodline.jutsus.some((j) => j.id === id);

/** [width, height] from an AVIF's image-spatial-extents ('ispe') property box. */
function avifSize(bytes: Buffer): [number, number] | null {
    const at = bytes.indexOf('ispe', 0, 'ascii');
    // 'ispe' is a full box: 4 bytes of version/flags, then width and height (big-endian u32).
    return at < 0 ? null : [bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 12)];
}

describe('Cinderhold roster: shape and rank split', () => {
    it('holds 30 NPCs in the owner split, the lead commander first', () => {
        assert.equal(NPC_VILLAGE_ROSTER.length, 30);
        assert.equal(NPC_VILLAGE_ROSTER[0]!.rank, 'commander');
        for (const [rank, count] of Object.entries(RANK_COUNTS)) {
            assert.equal(byRank(rank as NpcRank).length, count, rank);
        }
    });

    it('gives every NPC its own bloodline: 15 A Rank (commander to jonin) and 15 B Rank, no S Rank', () => {
        const ranks = NPC_VILLAGE_ROSTER.map((npc) => npc.bloodline.rank);
        assert.equal(ranks.filter((r) => r === 'A Rank').length, 15);
        assert.equal(ranks.filter((r) => r === 'B Rank').length, 15);
        assert.ok(!ranks.includes('S Rank' as never));
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.bloodline.rank, A_RANKS.has(npc.rank) ? 'A Rank' : 'B Rank', npc.name);
        }
        const ids = NPC_VILLAGE_ROSTER.map((npc) => npc.bloodline.id);
        const names = NPC_VILLAGE_ROSTER.map((npc) => npc.bloodline.name);
        const jutsuIds = NPC_VILLAGE_ROSTER.flatMap((npc) => npc.bloodline.jutsus.map((j) => j.id));
        const jutsuNames = NPC_VILLAGE_ROSTER.flatMap((npc) => npc.bloodline.jutsus.map((j) => j.name));
        assert.equal(new Set(ids).size, 30);
        assert.equal(new Set(names).size, 30);
        assert.equal(new Set(jutsuIds).size, jutsuIds.length);
        assert.equal(new Set(jutsuNames).size, jutsuNames.length);
        for (const id of jutsuIds) assert.equal(JUTSU_CATALOG[id], undefined, `${id} collides with a built-in jutsu`);
    });

    it('stacks every commander and elite A-rank bloodline into 4 jutsu and spreads every jonin over 5 (owner, 2026-11-11)', () => {
        const stacked = NPC_VILLAGE_ROSTER.filter((npc) => npc.bloodline.rank === 'A Rank' && npc.bloodline.jutsus.length === 4);
        assert.equal(stacked.length, 8);
        const counts = stacked.reduce<Record<string, number>>((acc, npc) => ({ ...acc, [npc.rank]: (acc[npc.rank] ?? 0) + 1 }), {});
        assert.deepEqual(counts, { commander: 3, elite: 5 });
        for (const npc of NPC_VILLAGE_ROSTER) {
            const expected = npc.rank === 'commander' || npc.rank === 'elite' ? 4 : npc.rank === 'jonin' ? 5 : 4;
            assert.equal(npc.bloodline.jutsus.length, expected, npc.name);
        }
    });

    it('pins the rank level offsets and AI tiers', () => {
        assert.deepEqual({ ...NPC_RANK_LEVEL_OFFSET }, { genin: -10, chunin: -7, jonin: -4, elite: 0, commander: 3, kage: 5 });
        assert.deepEqual({ ...NPC_RANK_AI_TIER }, {
            genin: 'tactical', chunin: 'tactical', jonin: 'advanced', elite: 'master', commander: 'master', kage: 'apex',
        });
    });

    it('spreads all four personalities and uses only real specialties', () => {
        const personalities = NPC_VILLAGE_ROSTER.map((npc) => npc.personality);
        for (const p of ['aggressive', 'guardian', 'medic', 'trickster'] as const) {
            assert.ok(personalities.filter((x) => x === p).length >= 5, p);
        }
        for (const rank of ['elite', 'jonin', 'chunin', 'genin'] as const) {
            assert.ok(new Set(byRank(rank).map((npc) => npc.personality)).size >= 3, `${rank} personalities`);
        }
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.ok(['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'].includes(npc.specialty), npc.name);
            assert.equal(npc.elements.length, 2);
            assert.notEqual(npc.elements[0], npc.elements[1]);
        }
    });
});

describe('Cinderhold roster: bloodlines pass the server sanitizer unchanged', () => {
    it('each bloodline is a fixed point of the player schema and spends exactly its budget', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            const { rank, jutsus } = npc.bloodline;
            assert.deepEqual(normalizePlayerBloodlineJutsus(structuredClone(jutsus), rank), jutsus, npc.name);
            assert.deepEqual(enforceBloodlineBudget(structuredClone(jutsus), rank), jutsus, npc.name);
            const points = bloodlinePoints(jutsus, rank);
            assert.equal(points, pointBudgetForRank(rank), `${npc.name} spends ${points}`);
            assert.equal(points, rank === 'A Rank' ? 10 : 7);
            assert.equal(npc.bloodline.totalPoints, points);
            assert.ok(jutsus.some((j) => j.ap === 60), `${npc.name} has no 60 AP bloodline jutsu`);
        }
    });

    it('survives the save ingress normalizer (ordinary save and maker write) unchanged', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            const stored = npcSavedBloodlines(npc);
            const plain = sanitizeBloodlines.prepareBloodlineNormalization({}, {}, { savedBloodlines: stored });
            assert.deepEqual(plain.normalizeBloodlineArray(structuredClone(stored), stored, false), stored, npc.name);
            const maker = sanitizeBloodlines.prepareBloodlineNormalization({}, {}, { savedBloodlines: stored }, false, npc.bloodline.id);
            assert.deepEqual(maker.normalizeBloodlineArray(structuredClone(stored), stored, true), stored, npc.name);
        }
    });
});

describe('Cinderhold roster: PvP hydration at every level band', () => {
    function saveAt(npc: NpcShinobi, level: number) {
        const loadout = npcLoadoutForLevel(npc, level);
        const character: Record<string, unknown> = {
            ...loadout,
            village: 'Cinderhold Village',
            maxHp: 500 + (level - 1) * 100,
            maxChakra: 1000,
            maxStamina: 1000,
        };
        return { loadout, character, save: { character, savedBloodlines: npcSavedBloodlines(npc) } };
    }

    it('resolves every equipped jutsu, with mastery, at levels 1/20/40/60/80/100', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            for (const level of LEVELS) {
                const { loadout, character, save } = saveAt(npc, level);
                assert.ok(loadout.equippedJutsuIds.length <= LOADOUT_CAP_BASE, `${npc.name} L${level}`);
                const fighter = session.hydrateCharacterFromSave(character, {}, save);
                const ids = (fighter.jutsu as Array<{ id: string }>).map((j) => j.id);
                assert.deepEqual(ids, loadout.equippedJutsuIds, `${npc.name} L${level} dropped jutsu`);
                const sealed = session.normalizeHumanPvpLoadout(fighter);
                assert.deepEqual((sealed.jutsu as Array<{ id: string }>).map((j) => j.id), ids, `${npc.name} L${level} human PvP seal`);
                const cap = jutsuLevelCapForLevel(level);
                for (const id of ids) {
                    const row = loadout.jutsuMastery.find((m) => m.jutsuId === id);
                    assert.ok(row, `${npc.name} has no mastery row for ${id}`);
                    assert.ok(row.level <= cap && row.level >= 1, `${npc.name} ${id} mastery ${row.level} > cap ${cap}`);
                }
                // The client equips an elemental catalog jutsu only for an owned element.
                const elements = npcElementsForLevel(npc, level);
                for (const id of ids) {
                    if (isBloodlineJutsu(npc, id)) continue;
                    const element = JUTSU_CATALOG[id]!.element;
                    assert.ok(element === 'None' || elements.includes(element as never), `${npc.name} L${level} ${id} needs ${element}`);
                }
                // Bloodline jutsu are sealed with the bloodline's rank.
                for (const j of fighter.jutsu as Array<{ id: string; bloodlineRank?: string }>) {
                    if (isBloodlineJutsu(npc, j.id)) assert.equal(j.bloodlineRank, npc.bloodline.rank);
                }
                if (level >= 2) {
                    const aps = new Set(ids.filter((id) => !isBloodlineJutsu(npc, id) && JUTSU_CATALOG[id]!.ap >= 40).map((id) => JUTSU_CATALOG[id]!.ap));
                    assert.deepEqual([...aps].sort(), [40, 60], `${npc.name} L${level} mixes 40 and 60 AP catalog jutsu`);
                }
            }
        }
    });

    it('equips only real items whose levelReq the level meets, and seals the weapon', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.gearBands[0]!.minLevel, 1);
            for (const band of npc.gearBands) {
                for (const [slot, id] of Object.entries(band.equipment)) {
                    const item = ITEM_CATALOG[id!];
                    assert.ok(item, `${npc.name} ${id}`);
                    assert.equal(item.slot, slot, `${npc.name} ${id} in ${slot}`);
                    assert.ok((item.levelReq ?? 1) <= band.minLevel, `${npc.name} ${id} levelReq ${item.levelReq} > band ${band.minLevel}`);
                }
            }
            for (const level of [...LEVELS, 5, 10, 25, 55]) {
                const equipment = npcGearForLevel(npc, level);
                for (const id of Object.values(equipment)) assert.ok((ITEM_CATALOG[id!]!.levelReq ?? 1) <= level, `${npc.name} L${level} ${id}`);
                const { character, save } = saveAt(npc, level);
                const fighter = session.hydrateCharacterFromSave(character, {}, save);
                const sealed = (fighter.pvpItems as Array<{ id: string }>).map((i) => i.id);
                assert.ok(sealed.includes(equipment.hand!), `${npc.name} L${level} weapon not sealed`);
            }
        }
    });

    it('scales stats within the per-level stat cap', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            for (const level of LEVELS) {
                const stats = npcStatsForLevel(npc, level);
                assert.equal(Object.keys(stats).length, 12);
                for (const value of Object.values(stats)) assert.ok(value >= 10 && value <= statCapForLevel(level), `${npc.name} L${level}`);
            }
        }
    });
});

describe('Cinderhold roster: pets', () => {
    const RARITY_ORDER = ['standard', 'rare', 'legendary', 'mythic'];
    const SIGNATURE_RARITY: Record<NpcRank, string[]> = {
        kage: ['mythic'], commander: ['mythic'], elite: ['mythic', 'legendary'],
        jonin: ['legendary'], chunin: ['rare'], genin: ['rare', 'standard'],
    };

    it('uses 120 distinct wild-obtainable species, every one with an approved 3D model', () => {
        const species = NPC_VILLAGE_ROSTER.flatMap((npc) => npc.pets.map((p) => p.templateId));
        assert.equal(species.length, 120);
        assert.equal(new Set(species).size, 120);
        for (const id of species) {
            const template = PET_CATALOG[id] as Record<string, unknown> | undefined;
            assert.ok(template, id);
            assert.notEqual(template.wildSpawnable, false, `${id} is not wild-obtainable`);
            assert.ok(APPROVED_ROSTER_MODEL_IDS.has(id), `${id} has no approved 3D model`);
        }
    });

    it('carries a signature plus three supports, rarer at higher ranks, with clean unique nicknames', () => {
        const nicknames = NPC_VILLAGE_ROSTER.flatMap((npc) => npc.pets.map((p) => p.nickname));
        assert.equal(new Set(nicknames).size, 120);
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.pets.length, 4);
            assert.deepEqual(npc.pets.map((p) => p.signature), [true, false, false, false], npc.name);
            const signature = npc.pets[0]!;
            assert.ok(SIGNATURE_RARITY[npc.rank].includes(signature.rarity), `${npc.name} signature ${signature.rarity}`);
            for (const pet of npc.pets) {
                assert.equal(pet.rarity, PET_CATALOG[pet.templateId]!.rarity);
                assert.ok(RARITY_ORDER.indexOf(pet.rarity) <= RARITY_ORDER.indexOf(signature.rarity), `${npc.name} support outranks signature`);
                // The same gate api/pet/progress.ts applies to a player nickname.
                assert.ok(pet.nickname.length <= 24);
                assert.ok(isCleanText(pet.nickname) && isCleanPlayerName(pet.nickname) && !hasStaffImpersonationName(pet.nickname), pet.nickname);
            }
        }
    });

    it('builds through createOwnedPet and is accepted by the Pet Arena picker', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            const pets: Array<Record<string, unknown>> = npc.pets.map((p) => ({
                ...ownedPet.createOwnedPet(p.templateId, { origin: 'wild', instanceId: p.instanceId, trait: p.trait }),
                nickname: p.nickname,
            }));
            const ids = pets.map((pet) => String(pet.id));
            for (const [i, pet] of pets.entries()) {
                assert.equal(pet.id, npc.pets[i]!.instanceId);
                assert.equal(pet.templateId, npc.pets[i]!.templateId);
                assert.equal(pet.trait, npc.pets[i]!.trait);
                assert.equal(ownedPet.resolvePetTemplateId(pet), npc.pets[i]!.templateId);
            }
            const character = { name: npc.name, level: 50, pets, activePetId: ids[0] };
            const chosen = arena.chooseArenaPets(character, ids);
            assert.deepEqual(chosen.map((p) => p.id), ids, npc.name);
        }
    });
});

describe('Cinderhold roster: Chronicle decks', () => {
    it('gives 30 distinct, named, legal 40-card decks with a summonable curve', () => {
        const keys = NPC_VILLAGE_ROSTER.map((npc) => [...npc.deck.cards].sort().join(','));
        assert.equal(new Set(keys).size, 30);
        assert.equal(new Set(NPC_VILLAGE_ROSTER.map((npc) => npc.deck.name)).size, 30);
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.deck.cards.length, MAIN_DECK_SIZE);
            const validation = validateDeckIds(npc.deck.cards, countChronicleCards(npc.collection));
            assert.ok(validation.valid, `${npc.name}: ${validation.errors.join('; ')}`);
            const bands = [0, 0, 0];
            for (const id of npc.deck.cards) {
                const card = getChronicleCard(id);
                if (card?.cardClass === 'monster') bands[tributeCountForLevel(card.level)]!++;
            }
            const [free, one, two] = bands as [number, number, number];
            assert.ok(free >= 12, `${npc.name} fields only ${free} free-summon Monsters`);
            assert.ok(one + two <= free, `${npc.name} holds ${one + two} Tribute Monsters for ${free} free bodies`);
            const element = npc.elements[0];
            const monsters = npc.deck.cards.map(getChronicleCard).filter((c) => c?.cardClass === 'monster');
            const themed = monsters.filter((c) => (c as { element?: string }).element === element).length;
            assert.ok(themed * 2 >= monsters.length, `${npc.name} deck is not themed to ${element}`);
        }
    });

    it('resolves through the server deck resolver with no starter top-up', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            const result = chronicleDeck.resolveChronicleDeckMutation(
                { tileCards: [...npc.collection], cardClashDeck: [...npc.deck.cards] },
                [],
            );
            assert.ok(result.ok, npc.name);
            if (!result.ok) continue;
            assert.deepEqual(result.value.deck, npc.deck.cards, npc.name);
            assert.deepEqual(result.character.tileCards, npc.collection, `${npc.name} collection needed a top-up`);
        }
    });
});

describe('Cinderhold roster: names, slugs and avatars', () => {
    it('uses unique names that pass every new-account name gate, slugged like the server', () => {
        assert.equal(new Set(NPC_VILLAGE_ROSTER.map((npc) => npc.name.toLowerCase())).size, 30);
        assert.equal(new Set(NPC_ACCOUNT_SLUGS).size, 30);
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.id, safeName(npc.name), npc.name);
            assert.ok(npc.name.length <= TEXT_LIMITS.playerName);
            assert.ok(isCleanPlayerName(npc.name), npc.name);
            assert.ok(!hasStaffImpersonationName(npc.name), npc.name);
            assert.ok(!playerAuth.isReservedNameShape(npc.name), npc.name);
            // Every gate passes except the one that reserves NPC names for the
            // seeder: a player can never register or rename into one of them.
            assert.equal(playerAuth.newAccountNameError({ headers: {} } as never, npc.name)?.status, 409, npc.name);
            assert.equal(playerAuth.newAccountNameError({ headers: {} } as never, `${npc.name}x`.slice(0, 20)), null, `${npc.name} variant`);
        }
        assert.deepEqual(NPC_ACCOUNT_SLUGS, NPC_VILLAGE_ROSTER.map((npc) => npc.id));
    });

    it('isNpcAccount recognizes names and slugs and rejects ordinary names', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(isNpcAccount(npc.name), true, npc.name);
            assert.equal(isNpcAccount(npc.id), true, npc.id);
            assert.equal(isNpcAccount(`  ${npc.name.toUpperCase()}  `), true, npc.name);
            assert.equal(npcBySlug(npc.name)?.id, npc.id);
        }
        for (const other of ['Tyler', 'Shadowblade', 'kuroto2', 'Admin', 'cinderhold', '', '   ']) {
            assert.equal(isNpcAccount(other), false, other);
        }
        for (const other of [null, undefined, 42, {}, ['kuroto']]) assert.equal(isNpcAccount(other), false);
    });

    it('carries the owner\'s thirty names, slot by slot (2026-11-11)', () => {
        const names = Object.fromEntries((['commander', 'elite', 'jonin', 'chunin', 'genin'] as const)
            .map((rank) => [rank, byRank(rank).map((npc) => npc.name)]));
        assert.deepEqual(names, {
            commander: ['Kuroto', 'Renji', 'Virath'],
            elite: ['Kat', 'Raku', 'Nozomi', 'Nyra', 'Roy'],
            jonin: ['Mizuki', 'Sly', 'Seiran', 'Akari', 'Kaien', 'Kairo', 'Suiren'],
            chunin: ['Tavi', 'Sayo', 'Hayate', 'Kohaku', 'Alisia', 'Ayame', 'Shion'],
            genin: ['Veyl', 'Riven', 'Vesper', 'Reika', 'Jiro', 'Daigo', 'Isamu', 'Lumen'],
        });
    });

    it('gives every NPC its own shipped 256x256 AVIF portrait, which no player can pick as a preset', () => {
        const publicDir = fileURLToPath(new URL('../shinobij.client/public/', import.meta.url));
        let total = 0;
        for (const npc of NPC_VILLAGE_ROSTER) {
            assert.equal(npc.avatar, `/npc-portraits/${npc.id}.avif`, npc.name);
            assert.equal(isPresetAvatar(npc.avatar), false, `${npc.avatar} must not become a player preset`);
            const bytes = readFileSync(join(publicDir, npc.avatar.slice(1)));
            assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', npc.avatar);
            assert.equal(bytes.toString('ascii', 8, 12), 'avif', npc.avatar);
            assert.deepEqual(avifSize(bytes), [256, 256], npc.avatar);
            assert.ok(bytes.length <= 24 * 1024, `${npc.avatar} is ${bytes.length} B`);
            total += bytes.length;
        }
        assert.equal(new Set(NPC_VILLAGE_ROSTER.map((npc) => npc.avatar)).size, 30);
        // The 30 together fit in the room the AVIF Founding Stone paintings freed (scripts/verify-dist.mjs).
        assert.ok(total <= 340 * 1024, `the portraits total ${total} B`);
    });

    it('mirrors the server slug, jutsu-cap and stat-cap rules exactly', () => {
        for (const sample of ['Kuroto Vale', 'Night_Fox', 'x-Y_z 9!', 'ÁdmÍn', 'a'.repeat(40), '']) {
            assert.equal(npcCanonicalSlug(sample), safeName(sample), sample);
        }
        for (let level = 0; level <= 120; level++) {
            assert.equal(npcJutsuLevelCap(level), jutsuLevelCapForLevel(level), `jutsu cap L${level}`);
            assert.equal(npcStatCap(level), statCapForLevel(level), `stat cap L${level}`);
            assert.equal(npcEarnedForLevel(level), earnedForLevel(level), `earned curve L${level}`);
        }
    });

    it('gives every NPC exactly the stat budget of the weakest real player at its level (never more)', () => {
        for (const npc of NPC_VILLAGE_ROSTER) {
            for (let level = 1; level <= 100; level++) {
                const stats = npcStatsForLevel(npc, level);
                assert.equal(allocatedStatPoints(stats as never), earnedForLevel(level), `${npc.name} L${level} stat budget`);
                assert.equal(levelForEarned(allocatedStatPoints(stats as never)), level, `${npc.name} L${level} reads as its own level`);
                for (const value of Object.values(stats)) assert.ok(value <= statCapForLevel(level), `${npc.name} L${level} over the stat cap`);
            }
        }
    });
});
