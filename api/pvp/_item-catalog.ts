/*
 * GENERATED FILE — do not edit by hand.
 *
 * Server-side catalog of built-in items (the canonical starterItems: armor,
 * weapons, throwables, consumables, gear), used by api/pvp/session.ts +
 * api/pvp/_multipliers.ts to derive the combat multiplier layer and resolve a
 * player's equipped weapons WITHOUT trusting the session creator's client.
 * Regenerate with:
 *
 *   node --import tsx scripts/item-catalog-gen.mjs
 *
 * Kept in lock-step with shinobij.client/src/data/starter-items.ts +
 * shinobij.client/src/data/jutsu.ts by scripts/item-catalog.test.mjs
 * (runs in `npm test`).
 */

export type CatalogItem = {
    id: string;
    name: string;
    slot: string;
    rarity: string;
    cost?: number;
    levelReq?: number;
    stackable?: boolean;
    armorQuality?: string;
    weaponElement?: string;
    weaponRange?: number;
    weaponCooldown?: number;
    weaponEp?: number;
    weaponEffect?: string;
    weaponEffectValue?: number;
    weaponEffectTarget?: string;
    apCost?: number;
    restoreChakra?: number;
    restoreStamina?: number;
    weaponTags?: Array<{ name: string; percent?: number }>;
    bonuses?: Record<string, number>;
};

export const ITEM_CATALOG: Record<string, CatalogItem> = {
    "ancient-pet-treat": {"id":"ancient-pet-treat","name":"Ancient Treats","slot":"item","rarity":"epic","cost":520,"stackable":true,"bonuses":{}},
    "ash-wrapped-tanto": {"id":"ash-wrapped-tanto","name":"Ash-Wrapped Tanto","slot":"hand","rarity":"common","cost":220,"levelReq":1,"weaponRange":4,"weaponCooldown":5,"weaponEp":18,"weaponEffect":"Decrease Damage Given","weaponEffectValue":10,"bonuses":{"genjutsuOffense":54}},
    "ashen-dragon-katana": {"id":"ashen-dragon-katana","name":"Ashen Dragon Katana","slot":"hand","rarity":"mythic","cost":100,"levelReq":55,"weaponRange":4,"weaponCooldown":5,"weaponEp":30,"weaponEffect":"Absorb","weaponEffectValue":35,"bonuses":{"ninjutsuOffense":166}},
    "ashen-leaf-saber": {"id":"ashen-leaf-saber","name":"Ashen Leaf Saber","slot":"hand","rarity":"rare","cost":480,"levelReq":10,"weaponRange":4,"weaponCooldown":5,"weaponEp":21,"weaponEffect":"Decrease Damage Taken","weaponEffectValue":15,"bonuses":{"bukijutsuOffense":90}},
    "ashglass-katana": {"id":"ashglass-katana","name":"Ashglass Katana","slot":"hand","rarity":"epic","cost":1050,"levelReq":25,"weaponRange":4,"weaponCooldown":5,"weaponEp":24,"weaponEffect":"Increase Damage Given","weaponEffectValue":20,"bonuses":{"bukijutsuOffense":118}},
    "aura-sphere": {"id":"aura-sphere","name":"Aura Sphere","slot":"aura","rarity":"legendary","cost":0,"bonuses":{}},
    "black-lotus-dagger": {"id":"black-lotus-dagger","name":"Black Lotus Dagger","slot":"hand","rarity":"legendary","cost":100,"levelReq":40,"weaponRange":4,"weaponCooldown":5,"weaponEp":27,"weaponEffect":"Lifesteal","weaponEffectValue":30,"bonuses":{"genjutsuOffense":131}},
    "blue-thread-dagger": {"id":"blue-thread-dagger","name":"Blue Thread Dagger","slot":"hand","rarity":"rare","cost":420,"levelReq":10,"weaponRange":4,"weaponCooldown":5,"weaponEp":21,"weaponEffect":"Wound","weaponEffectValue":15,"bonuses":{"ninjutsuOffense":84}},
    "bulwark-chest": {"id":"bulwark-chest","name":"Eternal Bulwark's Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "bulwark-crown": {"id":"bulwark-crown","name":"Eternal Bulwark's Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "bulwark-feet": {"id":"bulwark-feet","name":"Eternal Bulwark's Sabatons","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "bulwark-gloves": {"id":"bulwark-gloves","name":"Eternal Bulwark's Gauntlets","slot":"hand","rarity":"legendary","cost":150,"levelReq":40,"weaponCooldown":5,"bonuses":{"ninjutsuOffense":75,"taijutsuOffense":75,"bukijutsuOffense":75,"genjutsuOffense":75,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "bulwark-legs": {"id":"bulwark-legs","name":"Eternal Bulwark's Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "bulwark-waist": {"id":"bulwark-waist","name":"Eternal Bulwark's Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"absorbPercent":1}},
    "chain-obi": {"id":"chain-obi","name":"Chain Obi","slot":"waist","rarity":"rare","cost":320,"levelReq":20,"armorQuality":"Rare","bonuses":{"ninjutsuOffense":20,"taijutsuOffense":20,"bukijutsuOffense":20,"genjutsuOffense":20,"ninjutsuDefense":20,"taijutsuDefense":20,"bukijutsuDefense":20,"genjutsuDefense":20}},
    "chakra-ring": {"id":"chakra-ring","name":"Chakra Ring","slot":"aura","rarity":"rare","cost":600,"bonuses":{"maxChakra":150,"ninjutsuOffense":30}},
    "cloth-hood": {"id":"cloth-hood","name":"Cloth Hood","slot":"head","rarity":"common","cost":120,"levelReq":1,"armorQuality":"Standard","bonuses":{"ninjutsuOffense":10,"taijutsuOffense":10,"bukijutsuOffense":10,"genjutsuOffense":10,"ninjutsuDefense":10,"taijutsuDefense":10,"bukijutsuDefense":10,"genjutsuDefense":10}},
    "cloth-pants": {"id":"cloth-pants","name":"Cloth Pants","slot":"legs","rarity":"common","cost":105,"levelReq":1,"armorQuality":"Standard","bonuses":{"ninjutsuOffense":10,"taijutsuOffense":10,"bukijutsuOffense":10,"genjutsuOffense":10,"ninjutsuDefense":10,"taijutsuDefense":10,"bukijutsuDefense":10,"genjutsuDefense":10}},
    "cloth-robe": {"id":"cloth-robe","name":"Cloth Robe","slot":"body","rarity":"common","cost":150,"levelReq":1,"armorQuality":"Standard","bonuses":{"ninjutsuOffense":10,"taijutsuOffense":10,"bukijutsuOffense":10,"genjutsuOffense":10,"ninjutsuDefense":10,"taijutsuDefense":10,"bukijutsuDefense":10,"genjutsuDefense":10}},
    "cloth-sandals": {"id":"cloth-sandals","name":"Cloth Sandals","slot":"feet","rarity":"common","cost":75,"levelReq":1,"armorQuality":"Standard","bonuses":{"ninjutsuOffense":10,"taijutsuOffense":10,"bukijutsuOffense":10,"genjutsuOffense":10,"ninjutsuDefense":10,"taijutsuDefense":10,"bukijutsuDefense":10,"genjutsuDefense":10}},
    "cloth-sash": {"id":"cloth-sash","name":"Cloth Sash","slot":"waist","rarity":"common","cost":90,"levelReq":1,"armorQuality":"Standard","bonuses":{"ninjutsuOffense":10,"taijutsuOffense":10,"bukijutsuOffense":10,"genjutsuOffense":10,"ninjutsuDefense":10,"taijutsuDefense":10,"bukijutsuDefense":10,"genjutsuDefense":10}},
    "collar-amber": {"id":"collar-amber","name":"Sunflare Collar","slot":"item","rarity":"legendary","cost":50,"bonuses":{}},
    "collar-amethyst": {"id":"collar-amethyst","name":"Twilight Collar","slot":"item","rarity":"mythic","cost":200,"bonuses":{}},
    "collar-azure": {"id":"collar-azure","name":"Skywarden Collar","slot":"item","rarity":"legendary","cost":50,"bonuses":{}},
    "collar-crimson": {"id":"collar-crimson","name":"Emberheart Collar","slot":"item","rarity":"legendary","cost":50,"bonuses":{}},
    "collar-emerald": {"id":"collar-emerald","name":"Thornwood Collar","slot":"item","rarity":"legendary","cost":50,"bonuses":{}},
    "collar-inferno": {"id":"collar-inferno","name":"Wildfire Collar","slot":"item","rarity":"legendary","cost":80,"bonuses":{}},
    "collar-prismatic": {"id":"collar-prismatic","name":"Prismatic Collar","slot":"item","rarity":"mythic","cost":0,"bonuses":{}},
    "collar-rose": {"id":"collar-rose","name":"Blossom Collar","slot":"item","rarity":"mythic","cost":120,"bonuses":{}},
    "collar-tidal": {"id":"collar-tidal","name":"Riptide Collar","slot":"item","rarity":"mythic","cost":120,"bonuses":{}},
    "collar-verdant": {"id":"collar-verdant","name":"Meadowlight Collar","slot":"item","rarity":"legendary","cost":80,"bonuses":{}},
    "collar-void": {"id":"collar-void","name":"Voidpulse Collar","slot":"item","rarity":"mythic","cost":300,"bonuses":{}},
    "consum-cleansing-incense": {"id":"consum-cleansing-incense","name":"Cleansing Incense","slot":"item","rarity":"uncommon","cost":1120,"stackable":true,"bonuses":{}},
    "consum-lifeline-elixir": {"id":"consum-lifeline-elixir","name":"Lifeline Elixir","slot":"item","rarity":"rare","cost":1440,"stackable":true,"bonuses":{}},
    "consum-phantom-charm": {"id":"consum-phantom-charm","name":"Phantom Charm","slot":"item","rarity":"uncommon","cost":960,"stackable":true,"bonuses":{}},
    "consum-second-wind": {"id":"consum-second-wind","name":"Second Wind","slot":"item","rarity":"rare","cost":1600,"stackable":true,"bonuses":{}},
    "consum-smoke-pellet": {"id":"consum-smoke-pellet","name":"Smoke Pellet","slot":"item","rarity":"uncommon","cost":960,"stackable":true,"bonuses":{}},
    "consum-thornmail-oil": {"id":"consum-thornmail-oil","name":"Thornmail Oil","slot":"item","rarity":"rare","cost":1280,"stackable":true,"bonuses":{}},
    "cracked-bone-dagger": {"id":"cracked-bone-dagger","name":"Cracked Bone Dagger","slot":"hand","rarity":"common","cost":235,"levelReq":1,"weaponRange":4,"weaponCooldown":5,"weaponEp":18,"weaponEffect":"Wound","weaponEffectValue":10,"bonuses":{"bukijutsuOffense":53}},
    "crimson-chest": {"id":"crimson-chest","name":"Crimson Tide Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "crimson-crown": {"id":"crimson-crown","name":"Crimson Tide Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "crimson-feet": {"id":"crimson-feet","name":"Crimson Tide Sabatons","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "crimson-gloves": {"id":"crimson-gloves","name":"Crimson Tide Gauntlets","slot":"hand","rarity":"legendary","cost":150,"levelReq":40,"weaponCooldown":5,"bonuses":{"ninjutsuOffense":75,"taijutsuOffense":75,"bukijutsuOffense":75,"genjutsuOffense":75,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "crimson-legs": {"id":"crimson-legs","name":"Crimson Tide Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "crimson-waist": {"id":"crimson-waist","name":"Crimson Tide Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"lifeStealPercent":1}},
    "dungeon-key": {"id":"dungeon-key","name":"Dungeon Key","slot":"item","rarity":"rare","cost":0,"stackable":true,"bonuses":{}},
    "dungeon-legendary-fragment": {"id":"dungeon-legendary-fragment","name":"Dungeon Legendary Fragment","slot":"item","rarity":"epic","cost":0,"stackable":true,"bonuses":{}},
    "dungeon-legendary-relic": {"id":"dungeon-legendary-relic","name":"Dungeon Legendary Relic","slot":"item","rarity":"legendary","cost":0,"stackable":true,"bonuses":{}},
    "eclipse-fang-dagger": {"id":"eclipse-fang-dagger","name":"Eclipse Fang Dagger","slot":"hand","rarity":"mythic","cost":100,"levelReq":55,"weaponRange":4,"weaponCooldown":5,"weaponEp":30,"weaponEffect":"Lifesteal","weaponEffectValue":35,"bonuses":{"genjutsuOffense":157}},
    "elderbranch-katana": {"id":"elderbranch-katana","name":"Elderbranch Katana","slot":"hand","rarity":"legendary","cost":100,"levelReq":40,"weaponRange":4,"weaponCooldown":5,"weaponEp":27,"weaponEffect":"Absorb","weaponEffectValue":30,"bonuses":{"ninjutsuOffense":134}},
    "elemental-pet-treat": {"id":"elemental-pet-treat","name":"Elemental Treats","slot":"item","rarity":"rare","cost":260,"stackable":true,"bonuses":{}},
    "embercoil-scythe": {"id":"embercoil-scythe","name":"Embercoil Scythe","slot":"hand","rarity":"legendary","cost":100,"levelReq":40,"weaponRange":4,"weaponCooldown":5,"weaponEp":27,"weaponEffect":"Lifesteal","weaponEffectValue":30,"bonuses":{"taijutsuOffense":128}},
    "evo-stone-ascension": {"id":"evo-stone-ascension","name":"Ascension Stone","slot":"item","rarity":"mythic","cost":400,"bonuses":{}},
    "evo-stone-awakening": {"id":"evo-stone-awakening","name":"Awakening Stone","slot":"item","rarity":"legendary","cost":150,"bonuses":{}},
    "frostbite-cleaver": {"id":"frostbite-cleaver","name":"Frostbite Cleaver","slot":"hand","rarity":"epic","cost":980,"levelReq":25,"weaponRange":4,"weaponCooldown":5,"weaponEp":24,"weaponEffect":"Decrease Damage Given","weaponEffectValue":20,"bonuses":{"ninjutsuOffense":115}},
    "frostfang-oathblade": {"id":"frostfang-oathblade","name":"Frostfang Oathblade","slot":"hand","rarity":"legendary","cost":100,"levelReq":40,"weaponRange":4,"weaponCooldown":5,"weaponEp":27,"weaponEffect":"Shield","weaponEffectValue":300,"bonuses":{"taijutsuOffense":136}},
    "glacier-king-cleaver": {"id":"glacier-king-cleaver","name":"Glacier King Cleaver","slot":"hand","rarity":"mythic","cost":100,"levelReq":55,"weaponRange":4,"weaponCooldown":5,"weaponEp":30,"weaponEffect":"Shield","weaponEffectValue":400,"bonuses":{"taijutsuOffense":163}},
    "golden-apple": {"id":"golden-apple","name":"Golden Apple","slot":"item","rarity":"legendary","cost":20,"stackable":true,"bonuses":{}},
    "hollow-gate-key": {"id":"hollow-gate-key","name":"Hollow Gate Key","slot":"item","rarity":"rare","cost":0,"stackable":true,"bonuses":{}},
    "hunt-ancient-beast-core": {"id":"hunt-ancient-beast-core","name":"Ancient Beast Core","slot":"item","rarity":"epic","cost":0,"bonuses":{}},
    "hunt-ash-scale": {"id":"hunt-ash-scale","name":"Ash Scale","slot":"item","rarity":"rare","cost":0,"bonuses":{}},
    "hunt-beast-meat": {"id":"hunt-beast-meat","name":"Beast Meat","slot":"item","rarity":"common","cost":0,"bonuses":{}},
    "hunt-cracked-horn": {"id":"hunt-cracked-horn","name":"Cracked Horn","slot":"item","rarity":"common","cost":0,"bonuses":{}},
    "hunt-ember-scale": {"id":"hunt-ember-scale","name":"Ember Scale","slot":"item","rarity":"epic","cost":0,"bonuses":{}},
    "hunt-frost-pelt": {"id":"hunt-frost-pelt","name":"Frost Pelt","slot":"item","rarity":"rare","cost":0,"bonuses":{}},
    "hunt-legendary-material": {"id":"hunt-legendary-material","name":"Legendary Material","slot":"item","rarity":"legendary","cost":0,"bonuses":{}},
    "hunt-shadow-claw": {"id":"hunt-shadow-claw","name":"Shadow Claw","slot":"item","rarity":"rare","cost":0,"bonuses":{}},
    "hunt-shadow-pelt": {"id":"hunt-shadow-pelt","name":"Shadow Pelt","slot":"item","rarity":"epic","cost":0,"bonuses":{}},
    "hunt-small-fang": {"id":"hunt-small-fang","name":"Small Fang","slot":"item","rarity":"common","cost":0,"bonuses":{}},
    "hunt-titan-bone": {"id":"hunt-titan-bone","name":"Titan Bone","slot":"item","rarity":"epic","cost":0,"bonuses":{}},
    "hunt-torn-hide": {"id":"hunt-torn-hide","name":"Torn Hide","slot":"item","rarity":"common","cost":0,"bonuses":{}},
    "hunt-wild-feather": {"id":"hunt-wild-feather","name":"Wild Feather","slot":"item","rarity":"common","cost":0,"bonuses":{}},
    "hunt-wolf-fang": {"id":"hunt-wolf-fang","name":"Wolf Fang","slot":"item","rarity":"rare","cost":0,"bonuses":{}},
    "iron-fang-knuckles": {"id":"iron-fang-knuckles","name":"Iron Fang Knuckles","slot":"hand","rarity":"rare","cost":510,"levelReq":10,"weaponRange":4,"weaponCooldown":5,"weaponEp":21,"weaponEffect":"Increase Damage Taken","weaponEffectValue":15,"bonuses":{"genjutsuOffense":93}},
    "iron-kabuto": {"id":"iron-kabuto","name":"Iron Kabuto","slot":"head","rarity":"rare","cost":400,"levelReq":20,"armorQuality":"Rare","bonuses":{"ninjutsuOffense":20,"taijutsuOffense":20,"bukijutsuOffense":20,"genjutsuOffense":20,"ninjutsuDefense":20,"taijutsuDefense":20,"bukijutsuDefense":20,"genjutsuDefense":20}},
    "ironwall-chest": {"id":"ironwall-chest","name":"Ironwall Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "ironwall-crown": {"id":"ironwall-crown","name":"Ironwall Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "ironwall-feet": {"id":"ironwall-feet","name":"Ironwall Sabatons","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "ironwall-gloves": {"id":"ironwall-gloves","name":"Ironwall Gauntlets","slot":"hand","rarity":"legendary","cost":150,"levelReq":40,"weaponCooldown":5,"bonuses":{"ninjutsuOffense":75,"taijutsuOffense":75,"bukijutsuOffense":75,"genjutsuOffense":75,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "ironwall-legs": {"id":"ironwall-legs","name":"Ironwall Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "ironwall-waist": {"id":"ironwall-waist","name":"Ironwall Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"shield":100}},
    "item-attack-pill": {"id":"item-attack-pill","name":"Attack Pill","slot":"item","rarity":"rare","cost":320,"stackable":true,"weaponCooldown":5,"weaponEffect":"Increase Damage Given","weaponEffectValue":15,"apCost":20,"bonuses":{}},
    "item-defense-pill": {"id":"item-defense-pill","name":"Defense Pill","slot":"item","rarity":"rare","cost":320,"stackable":true,"weaponCooldown":5,"weaponEffect":"Decrease Damage Taken","weaponEffectValue":15,"apCost":20,"bonuses":{}},
    "item-smoke-bomb": {"id":"item-smoke-bomb","name":"Smoke Bomb","slot":"item","rarity":"rare","cost":360,"stackable":true,"weaponCooldown":9,"weaponEffect":"Decrease Damage Given","weaponEffectValue":100,"weaponEffectTarget":"both","apCost":20,"bonuses":{}},
    "leather-belt": {"id":"leather-belt","name":"Leather Belt","slot":"waist","rarity":"uncommon","cost":210,"levelReq":5,"armorQuality":"Reinforced","bonuses":{"ninjutsuOffense":14,"taijutsuOffense":14,"bukijutsuOffense":14,"genjutsuOffense":14,"ninjutsuDefense":14,"taijutsuDefense":14,"bukijutsuDefense":14,"genjutsuDefense":14}},
    "leather-headband": {"id":"leather-headband","name":"Leather Headband","slot":"head","rarity":"uncommon","cost":270,"levelReq":5,"armorQuality":"Reinforced","bonuses":{"ninjutsuOffense":14,"taijutsuOffense":14,"bukijutsuOffense":14,"genjutsuOffense":14,"ninjutsuDefense":14,"taijutsuDefense":14,"bukijutsuDefense":14,"genjutsuDefense":14}},
    "legendary-chest": {"id":"legendary-chest","name":"Void Sovereign's Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-crown": {"id":"legendary-crown","name":"Void Sovereign's Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-feet": {"id":"legendary-feet","name":"Void Sovereign's Sabatons","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-gloves": {"id":"legendary-gloves","name":"Void Sovereign's Gauntlets","slot":"hand","rarity":"legendary","cost":150,"levelReq":40,"weaponCooldown":5,"bonuses":{"ninjutsuOffense":75,"taijutsuOffense":75,"bukijutsuOffense":75,"genjutsuOffense":75,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-legs": {"id":"legendary-legs","name":"Void Sovereign's Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-waist": {"id":"legendary-waist","name":"Void Sovereign's Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"damagePercent":1}},
    "legendary-war-crate": {"id":"legendary-war-crate","name":"Legendary War Crate","slot":"item","rarity":"legendary","cost":0,"stackable":true,"bonuses":{}},
    "mirror-chest": {"id":"mirror-chest","name":"Mirror Soul Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mirror-crown": {"id":"mirror-crown","name":"Mirror Soul Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mirror-feet": {"id":"mirror-feet","name":"Mirror Soul Sabatons","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mirror-gloves": {"id":"mirror-gloves","name":"Mirror Soul Gauntlets","slot":"hand","rarity":"legendary","cost":150,"levelReq":40,"weaponCooldown":5,"bonuses":{"ninjutsuOffense":75,"taijutsuOffense":75,"bukijutsuOffense":75,"genjutsuOffense":75,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mirror-legs": {"id":"mirror-legs","name":"Mirror Soul Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mirror-waist": {"id":"mirror-waist","name":"Mirror Soul Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "mistfang-tanto": {"id":"mistfang-tanto","name":"Mistfang Tanto","slot":"hand","rarity":"rare","cost":450,"levelReq":10,"weaponRange":4,"weaponCooldown":5,"weaponEp":21,"weaponEffect":"Increase Damage Given","weaponEffectValue":15,"bonuses":{"ninjutsuOffense":88}},
    "moonshadow-needleblade": {"id":"moonshadow-needleblade","name":"Moonshadow Needleblade","slot":"hand","rarity":"epic","cost":900,"levelReq":25,"weaponRange":4,"weaponCooldown":5,"weaponEp":24,"weaponEffect":"Increase Damage Taken","weaponEffectValue":20,"bonuses":{"genjutsuOffense":109}},
    "padded-leggings": {"id":"padded-leggings","name":"Padded Leggings","slot":"legs","rarity":"uncommon","cost":240,"levelReq":5,"armorQuality":"Reinforced","bonuses":{"ninjutsuOffense":14,"taijutsuOffense":14,"bukijutsuOffense":14,"genjutsuOffense":14,"ninjutsuDefense":14,"taijutsuDefense":14,"bukijutsuDefense":14,"genjutsuDefense":14}},
    "pet-treat": {"id":"pet-treat","name":"Treats","slot":"item","rarity":"common","cost":80,"stackable":true,"bonuses":{}},
    "potion-rejuvenation": {"id":"potion-rejuvenation","name":"Rejuvenation Potion","slot":"potion","rarity":"rare","cost":1800,"stackable":true,"apCost":20,"restoreChakra":1000,"restoreStamina":1000,"bonuses":{}},
    "pve-apex-predator-fang": {"id":"pve-apex-predator-fang","name":"Apex Predator Fang","slot":"item","rarity":"epic","cost":9600,"stackable":true,"bonuses":{}},
    "pve-avengers-pendant": {"id":"pve-avengers-pendant","name":"Avenger's Pendant","slot":"item","rarity":"epic","cost":7200,"stackable":true,"bonuses":{}},
    "pve-bloodbond-totem": {"id":"pve-bloodbond-totem","name":"Bloodbond Totem","slot":"item","rarity":"epic","cost":8000,"stackable":true,"bonuses":{}},
    "pve-frenzy-claw": {"id":"pve-frenzy-claw","name":"Frenzy Claw","slot":"item","rarity":"epic","cost":5600,"stackable":true,"bonuses":{}},
    "pve-guardians-blessing": {"id":"pve-guardians-blessing","name":"Guardian's Blessing","slot":"item","rarity":"epic","cost":5600,"stackable":true,"bonuses":{}},
    "pve-hunters-bond-harness": {"id":"pve-hunters-bond-harness","name":"Hunter's Bond Harness","slot":"item","rarity":"epic","cost":4800,"stackable":true,"bonuses":{}},
    "pve-loyal-companion-bell": {"id":"pve-loyal-companion-bell","name":"Loyal Companion Bell","slot":"item","rarity":"epic","cost":4800,"stackable":true,"bonuses":{}},
    "pve-pack-alpha-crest": {"id":"pve-pack-alpha-crest","name":"Pack Alpha Crest","slot":"item","rarity":"epic","cost":8800,"stackable":true,"bonuses":{}},
    "pve-predators-fang": {"id":"pve-predators-fang","name":"Predator's Fang","slot":"item","rarity":"epic","cost":7200,"stackable":true,"bonuses":{}},
    "pve-sanguine-charm": {"id":"pve-sanguine-charm","name":"Sanguine Charm","slot":"item","rarity":"epic","cost":6400,"stackable":true,"bonuses":{}},
    "pvp-aegis-pendant": {"id":"pvp-aegis-pendant","name":"Aegis Pendant","slot":"item","rarity":"legendary","cost":120,"bonuses":{}},
    "pvp-arena-champion-regalia": {"id":"pvp-arena-champion-regalia","name":"Arena Champion's Regalia","slot":"item","rarity":"mythic","cost":150,"bonuses":{}},
    "pvp-berserkers-muzzle": {"id":"pvp-berserkers-muzzle","name":"Berserker's Muzzle","slot":"item","rarity":"legendary","cost":110,"bonuses":{}},
    "pvp-bloodthirster-fang": {"id":"pvp-bloodthirster-fang","name":"Bloodthirster Fang","slot":"item","rarity":"mythic","cost":140,"bonuses":{}},
    "pvp-executioners-talon": {"id":"pvp-executioners-talon","name":"Executioner's Talon","slot":"item","rarity":"mythic","cost":140,"bonuses":{}},
    "pvp-final-bastion-charm": {"id":"pvp-final-bastion-charm","name":"Final Bastion Charm","slot":"item","rarity":"mythic","cost":140,"bonuses":{}},
    "pvp-ironhide-barding": {"id":"pvp-ironhide-barding","name":"Ironhide Barding","slot":"item","rarity":"legendary","cost":100,"bonuses":{}},
    "pvp-spiked-war-harness": {"id":"pvp-spiked-war-harness","name":"Spiked War Harness","slot":"item","rarity":"legendary","cost":100,"bonuses":{}},
    "pvp-tortoise-shell-plating": {"id":"pvp-tortoise-shell-plating","name":"Tortoise Shell Plating","slot":"item","rarity":"legendary","cost":110,"bonuses":{}},
    "pvp-venomfang-bit": {"id":"pvp-venomfang-bit","name":"Venomfang Bit","slot":"item","rarity":"mythic","cost":130,"bonuses":{}},
    "rare-chest-plate": {"id":"rare-chest-plate","name":"Rare Chest Plate","slot":"body","rarity":"rare","cost":500,"levelReq":20,"armorQuality":"Rare","bonuses":{"ninjutsuOffense":20,"taijutsuOffense":20,"bukijutsuOffense":20,"genjutsuOffense":20,"ninjutsuDefense":20,"taijutsuDefense":20,"bukijutsuDefense":20,"genjutsuDefense":20}},
    "rare-greaves": {"id":"rare-greaves","name":"Rare Greaves","slot":"legs","rarity":"rare","cost":360,"levelReq":20,"armorQuality":"Rare","bonuses":{"ninjutsuOffense":20,"taijutsuOffense":20,"bukijutsuOffense":20,"genjutsuOffense":20,"ninjutsuDefense":20,"taijutsuDefense":20,"bukijutsuDefense":20,"genjutsuDefense":20}},
    "rare-tabi": {"id":"rare-tabi","name":"Rare Tabi","slot":"feet","rarity":"rare","cost":300,"levelReq":20,"armorQuality":"Rare","bonuses":{"ninjutsuOffense":20,"taijutsuOffense":20,"bukijutsuOffense":20,"genjutsuOffense":20,"ninjutsuDefense":20,"taijutsuDefense":20,"bukijutsuDefense":20,"genjutsuDefense":20}},
    "reinforced-vest": {"id":"reinforced-vest","name":"Reinforced Vest","slot":"body","rarity":"uncommon","cost":330,"levelReq":5,"armorQuality":"Reinforced","bonuses":{"ninjutsuOffense":14,"taijutsuOffense":14,"bukijutsuOffense":14,"genjutsuOffense":14,"ninjutsuDefense":14,"taijutsuDefense":14,"bukijutsuDefense":14,"genjutsuDefense":14}},
    "riverbone-spear": {"id":"riverbone-spear","name":"Riverbone Spear","slot":"hand","rarity":"rare","cost":430,"levelReq":10,"weaponRange":4,"weaponCooldown":5,"weaponEp":21,"weaponEffect":"Decrease Damage Given","weaponEffectValue":15,"bonuses":{"taijutsuOffense":86}},
    "rookie-chain-sickle": {"id":"rookie-chain-sickle","name":"Rookie Chain Sickle","slot":"hand","rarity":"common","cost":210,"levelReq":1,"weaponRange":4,"weaponCooldown":5,"weaponEp":18,"weaponEffect":"Increase Damage Taken","weaponEffectValue":10,"bonuses":{"ninjutsuOffense":52}},
    "rustfang-kunai": {"id":"rustfang-kunai","name":"Rustfang Kunai","slot":"hand","rarity":"common","cost":225,"levelReq":1,"weaponRange":4,"weaponCooldown":5,"weaponEp":18,"weaponEffect":"Increase Damage Given","weaponEffectValue":10,"bonuses":{"bukijutsuOffense":55}},
    "sennin-chest": {"id":"sennin-chest","name":"Sennin God's Mantle","slot":"body","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "sennin-crown": {"id":"sennin-crown","name":"Sennin God's Crown","slot":"head","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "sennin-feet": {"id":"sennin-feet","name":"Sennin God's Sandals","slot":"feet","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "sennin-legs": {"id":"sennin-legs","name":"Sennin God's Greaves","slot":"legs","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "sennin-waist": {"id":"sennin-waist","name":"Sennin God's Obi","slot":"waist","rarity":"legendary","cost":150,"levelReq":40,"armorQuality":"Legendary","bonuses":{"ninjutsuOffense":30,"taijutsuOffense":30,"bukijutsuOffense":30,"genjutsuOffense":30,"ninjutsuDefense":30,"taijutsuDefense":30,"bukijutsuDefense":30,"genjutsuDefense":30,"reflectPercent":1}},
    "shinobi-boots": {"id":"shinobi-boots","name":"Shinobi Boots","slot":"feet","rarity":"uncommon","cost":195,"levelReq":5,"armorQuality":"Reinforced","bonuses":{"ninjutsuOffense":14,"taijutsuOffense":14,"bukijutsuOffense":14,"genjutsuOffense":14,"ninjutsuDefense":14,"taijutsuDefense":14,"bukijutsuDefense":14,"genjutsuDefense":14}},
    "shinobi-vest": {"id":"shinobi-vest","name":"Shinobi Vest","slot":"body","rarity":"common","cost":180,"bonuses":{"taijutsuDefense":20}},
    "spirit-leech-wakizashi": {"id":"spirit-leech-wakizashi","name":"Spirit Leech Wakizashi","slot":"hand","rarity":"epic","cost":850,"levelReq":25,"weaponRange":4,"weaponCooldown":5,"weaponEp":24,"weaponEffect":"Wound","weaponEffectValue":20,"bonuses":{"taijutsuOffense":104}},
    "stormcoil-kusarigama": {"id":"stormcoil-kusarigama","name":"Stormcoil Kusarigama","slot":"hand","rarity":"epic","cost":950,"levelReq":25,"weaponRange":4,"weaponCooldown":5,"weaponEp":24,"weaponEffect":"Decrease Damage Taken","weaponEffectValue":20,"bonuses":{"taijutsuOffense":113}},
    "tempest-fang-blade": {"id":"tempest-fang-blade","name":"Tempest Fang Blade","slot":"hand","rarity":"legendary","cost":100,"levelReq":40,"weaponRange":4,"weaponCooldown":5,"weaponEp":27,"weaponEffect":"Reflect","weaponEffectValue":30,"bonuses":{"bukijutsuOffense":141}},
    "territory-control-scroll": {"id":"territory-control-scroll","name":"Territory Control Scroll","slot":"item","rarity":"rare","cost":0,"stackable":true,"bonuses":{}},
    "thrown-senbon": {"id":"thrown-senbon","name":"Senbon","slot":"thrown","rarity":"rare","cost":400,"stackable":true,"weaponCooldown":5,"weaponEp":0,"weaponEffect":"Wound","weaponEffectValue":300,"apCost":20,"bonuses":{}},
    "thrown-serpent-dust": {"id":"thrown-serpent-dust","name":"Serpent Dust","slot":"thrown","rarity":"rare","cost":400,"stackable":true,"weaponCooldown":5,"weaponEp":0,"weaponEffect":"Poison","weaponEffectValue":55,"apCost":20,"bonuses":{}},
    "thrown-shuriken": {"id":"thrown-shuriken","name":"Shuriken","slot":"thrown","rarity":"common","cost":400,"stackable":true,"weaponCooldown":5,"weaponEp":22,"apCost":20,"bonuses":{}},
    "training-katana": {"id":"training-katana","name":"Training Katana","slot":"hand","rarity":"common","cost":240,"levelReq":1,"weaponRange":4,"weaponCooldown":5,"weaponEp":18,"weaponEffect":"Decrease Damage Taken","weaponEffectValue":10,"bonuses":{"taijutsuOffense":58}},
    "veil-of-the-hollow": {"id":"veil-of-the-hollow","name":"Veil of the Hollow","slot":"item","rarity":"legendary","cost":0,"stackable":true,"bonuses":{}},
    "void-leech-nodachi": {"id":"void-leech-nodachi","name":"Void Leech Nodachi","slot":"hand","rarity":"mythic","cost":100,"levelReq":55,"weaponRange":4,"weaponCooldown":5,"weaponEp":30,"weaponEffect":"Lifesteal","weaponEffectValue":35,"bonuses":{"bukijutsuOffense":168}},
    "war-resource-cache": {"id":"war-resource-cache","name":"War Resource Cache","slot":"item","rarity":"rare","cost":0,"stackable":true,"bonuses":{}},
    "war-supply-cache": {"id":"war-supply-cache","name":"War Supply Cache","slot":"item","rarity":"rare","cost":0,"stackable":true,"bonuses":{}},
    "warforged-relic": {"id":"warforged-relic","name":"Warforged Relic","slot":"item","rarity":"legendary","cost":0,"stackable":true,"bonuses":{}},
    "weekly-boss-core": {"id":"weekly-boss-core","name":"Weekly Boss Core","slot":"item","rarity":"legendary","cost":0,"bonuses":{}},
    "worldsplitter-katana": {"id":"worldsplitter-katana","name":"Worldsplitter Katana","slot":"hand","rarity":"mythic","cost":100,"levelReq":55,"weaponRange":4,"weaponCooldown":5,"weaponEp":30,"weaponEffect":"Reflect","weaponEffectValue":35,"bonuses":{"bukijutsuOffense":160}},
};

// Ids of the four built-in (starter) bloodlines — drives the flat-1.08 branch of
// the server bloodline-multiplier derivation (api/pvp/_multipliers.ts).
export const BUILTIN_BLOODLINE_IDS: readonly string[] = ["starter-bloodline-ashen-eyes","starter-bloodline-inferno-cataclysm","starter-bloodline-iron-fang","starter-bloodline-shadow-lotus"];
