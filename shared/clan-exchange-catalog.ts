/** Canonical Clan Exchange shelf definitions, shared by the server and the storefront. */

export type ClanExchangeItemId =
    | 'smallRyoPouch'
    | 'boneCharmBundle'
    | 'fateShardBundle'
    | 'clanBannerFrame'
    | 'largeRyoPouch'
    | 'boneCharmCrate'
    | 'fateShardCrate'
    | 'auraStone'
    | 'warSupplyGrant'
    | 'honorSealBundle'
    | 'premiumFateShardCrate'
    | 'auraStoneBundle'
    | 'greaterWarSupplyGrant'
    | 'weaponCache'
    | 'armorCache'
    | 'kageCoffer';

export type ClanExchangeHall = 'camp' | 'dojo' | 'compound' | 'fortress' | 'citadel';

export type ClanExchangeLimit =
    | { kind: 'weekly'; count: number }
    | { kind: 'monthly'; count: number }
    | { kind: 'oneTime' };

export type ClanExchangeReward =
    | { kind: 'currency'; currency: 'ryo' | 'boneCharms' | 'fateShards' | 'auraStones' | 'honorSeals'; amount: number }
    | { kind: 'item'; itemId: string; count: number }
    | { kind: 'treasury'; currency: 'warSupply'; amount: number }
    | { kind: 'cache'; cache: 'weapon' | 'armor' }
    | {kind:'cosmetic';cosmetic:'clanBannerFrame'}
    | { kind: 'locked'; reason: string };

export type ClanExchangeItemDef = {
    id: ClanExchangeItemId;
    tier: 1 | 2 | 3;
    hall: ClanExchangeHall;
    requiredClanLevel: number;
    name: string;
    description: string;
    cost: number;
    limit: ClanExchangeLimit;
    rarity: 'standard' | 'rare' | 'epic' | 'legendary';
    reward: ClanExchangeReward;
};

export const CLAN_EXCHANGE_ITEMS: ClanExchangeItemDef[] = [
    // ── Camp (Lv 1+) — member issue ──────────────────────────────────
    {
        id: 'smallRyoPouch',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Genin Coin Cache',
        description: 'Redeem for 2,500 Ryo in your personal balance.',
        cost: 100,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'standard',
        reward: { kind: 'currency', currency: 'ryo', amount: 2_500 },
    },
    {
        id: 'boneCharmBundle',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Ossuary Charm Satchel',
        description: 'Ten carved bone charms strung for bloodline rites and events.',
        cost: 150,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 10 },
    },
    {
        id: 'fateShardBundle',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Fate Shard Offering',
        description: "Five Fate Shards drawn from the clan's offering bowl.",
        cost: 250,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'fateShards', amount: 5 },
    },
    {
        id: 'clanBannerFrame',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Clan Banner Sigil',
        description: 'An ornamental frame for your clan crest in the Hall and Exchange. A permanent cosmetic unlock with no combat bonus.',
        cost: 500,
        limit: { kind: 'oneTime' },
        rarity: 'epic',
        reward: {kind:'cosmetic',cosmetic:'clanBannerFrame'},
    },
    // ── Dojo (Lv 7+) — proven contributors ───────────────────────────
    {
        id: 'largeRyoPouch',
        tier: 1,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Chūnin War Chest',
        description: 'Redeem for 10,000 Ryo in your personal balance.',
        cost: 350,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'ryo', amount: 10_000 },
    },
    {
        id: 'boneCharmCrate',
        tier: 2,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Ossuary Reliquary',
        description: 'A lacquered reliquary of thirty-five bone charms.',
        cost: 450,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 35 },
    },
    {
        id: 'auraStone',
        tier: 2,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Kaguya Aura Stone',
        description: 'A single Kaguya aura stone for advanced shinobi growth.',
        cost: 800,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'auraStones', amount: 1 },
    },
    // ── Compound (Lv 15+) — officer stores ───────────────────────────
    {
        id: 'fateShardCrate',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: 'Sealed Fate Reliquary',
        description: 'A warded reliquary holding fifteen Fate Shards.',
        cost: 650,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'fateShards', amount: 15 },
    },
    {
        id: 'warSupplyGrant',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: "Quartermaster's Requisition",
        description: 'Requisition five hundred War Supply straight to the clan stores.',
        cost: 750,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 500 },
    },
    {
        id: 'honorSealBundle',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: 'Rite of Honor Seals',
        description: 'Ten ceremonial Honor Seals for high-value shinobi development.',
        cost: 650,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'honorSeals', amount: 10 },
    },
    // ── Fortress (Lv 25+) — war stores ───────────────────────────────
    {
        id: 'premiumFateShardCrate',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Grand Fate Reliquary',
        description: 'A grand reliquary packed with thirty-five Fate Shards.',
        cost: 1_200,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'fateShards', amount: 35 },
    },
    {
        id: 'greaterWarSupplyGrant',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Grand Quartermaster Requisition',
        description: 'Requisition fifteen hundred War Supply to the clan stores.',
        cost: 1_750,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 1_500 },
    },
    {
        id: 'weaponCache',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Forbidden Armory Scroll',
        description: 'A forbidden armory scroll — unseals one Epic or Legendary weapon from the live catalog. About one scroll in five instead holds an upgrade weapon with extra EP, for the best gear tier you have bought or crafted.',
        cost: 1_800,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'weapon' },
    },
    // ── Citadel (Lv 40+) — elite vault ───────────────────────────────
    {
        id: 'auraStoneBundle',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: 'Kaguya Aura Trove',
        description: 'A trove of three Kaguya aura stones bound in a clan scroll.',
        cost: 1_500,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'auraStones', amount: 3 },
    },
    {
        id: 'armorCache',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: 'Vault of the Fallen',
        description: 'A vault of the fallen — unseals one Epic or Legendary armor piece from the live catalog. About one vault in five instead holds an upgrade armor piece with extra damage reduction, for the best gear tier you have bought or crafted.',
        cost: 2_200,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'armor' },
    },
    {
        id: 'kageCoffer',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: "Kage's Coffer",
        description: 'Redeem for 50,000 Ryo in your personal balance.',
        cost: 1_500,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'ryo', amount: 50_000 },
    },
];
