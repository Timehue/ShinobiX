/*
 * Old picture names for the base weapons and armor whose art was refreshed.
 *
 * The refreshed pictures carry new names so players do not keep a cached copy of the old
 * art, and the old files were deleted. Anything that still asks for an old name (a
 * published admin override, a custom item copied from a built in one, a tab opened before
 * the deploy) is redirected to the new picture by server.ts instead of showing a broken
 * image. scripts/legacy-item-art.test.mjs keeps this table honest: every old name must be
 * gone from public/items and every target must exist.
 */
export const LEGACY_ITEM_ART: Readonly<Record<string, string>> = {
    "shop-ashen-leaf-saber-v1.webp": "shop-ashen-leaf-saber-v2.webp",
    "shop-ashglass-katana-v1.webp": "shop-ashglass-katana-v2.webp",
    "shop-ash-wrapped-tanto-v1.webp": "shop-ash-wrapped-tanto-v2.webp",
    "shop-blue-thread-dagger-v1.webp": "shop-blue-thread-dagger-v2.webp",
    "shop-chain-obi-v1.webp": "shop-chain-obi-v2.webp",
    "shop-cloth-hood-v1.webp": "shop-cloth-hood-v2.webp",
    "shop-cloth-pants-v1.webp": "shop-cloth-pants-v2.webp",
    "shop-cloth-robe-v1.webp": "shop-cloth-robe-v2.webp",
    "shop-cloth-sandals-v1.webp": "shop-cloth-sandals-v2.webp",
    "shop-cloth-sash-v1.webp": "shop-cloth-sash-v2.webp",
    "shop-cracked-bone-dagger-v1.webp": "shop-cracked-bone-dagger-v2.webp",
    "shop-frostbite-cleaver-v1.webp": "shop-frostbite-cleaver-v2.webp",
    "shop-iron-fang-knuckles-v1.webp": "shop-iron-fang-knuckles-v2.webp",
    "shop-iron-kabuto-v1.webp": "shop-iron-kabuto-v2.webp",
    "shop-leather-belt-v1.webp": "shop-leather-belt-v2.webp",
    "shop-leather-headband-v1.webp": "shop-leather-headband-v2.webp",
    "shop-mistfang-tanto-v1.webp": "shop-mistfang-tanto-v2.webp",
    "shop-moonshadow-needleblade-v1.webp": "shop-moonshadow-needleblade-v2.webp",
    "shop-padded-leggings-v1.webp": "shop-padded-leggings-v2.webp",
    "shop-rare-chest-plate-v1.webp": "shop-rare-chest-plate-v2.webp",
    "shop-rare-greaves-v1.webp": "shop-rare-greaves-v2.webp",
    "shop-rare-tabi-v1.webp": "shop-rare-tabi-v2.webp",
    "shop-reinforced-vest-v1.webp": "shop-reinforced-vest-v2.webp",
    "shop-riverbone-spear-v1.webp": "shop-riverbone-spear-v2.webp",
    "shop-rookie-chain-sickle-v1.webp": "shop-rookie-chain-sickle-v2.webp",
    "shop-shinobi-boots-v1.webp": "shop-shinobi-boots-v2.webp",
    "shop-spirit-leech-wakizashi-v1.webp": "shop-spirit-leech-wakizashi-v2.webp",
    "shop-stormcoil-kusarigama-v1.webp": "shop-stormcoil-kusarigama-v2.webp",
    "shop-training-katana-v1.webp": "shop-training-katana-v2.webp",
    "starter-rustfang-kunai-v2.webp": "starter-rustfang-kunai-v3.webp",

};
