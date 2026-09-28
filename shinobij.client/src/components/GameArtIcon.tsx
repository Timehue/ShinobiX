import roleDefender from "../assets/roles/role-defender.webp";
import roleTracker from "../assets/roles/role-tracker.webp";
import roleAssassin from "../assets/roles/role-assassin.webp";
import roleSage from "../assets/roles/role-sage.webp";
import elementEarth from "../assets/elements/element-earth.webp";
import elementFire from "../assets/elements/element-fire.webp";
import elementLightning from "../assets/elements/element-lightning.webp";
import elementWater from "../assets/elements/element-water.webp";
import elementWind from "../assets/elements/element-wind.webp";
import biomeForest from "../assets/towers/arena-floor-forest.webp";
import biomeSnow from "../assets/towers/arena-floor-snow.webp";
import biomeVolcano from "../assets/towers/arena-floor-volcano.webp";
import biomeCentral from "../assets/towers/arena-floor-central.webp";
import biomeShadow from "../assets/towers/arena-floor-shadow.webp";
import professionHealer from "../assets/professions/healer.webp";
import professionVanguard from "../assets/professions/vanguard.webp";
import professionPetTamer from "../assets/professions/pettamer.webp";
import facilityTavern from "../assets/village-icons/tavern.webp";
import facilityArena from "../assets/village-icons/battle-arena.webp";
import facilityCardHall from "../assets/village-icons/card-hall.webp";
import facilityMissionHall from "../assets/village-icons/mission-hall.webp";
import facilityShop from "../assets/village-icons/shop.webp";
import facilityClanHall from "../assets/village-icons/clan-hall.webp";
import facilityCafeteria from "../assets/village-icons/cafeteria.webp";

export type GameArtIconKind = "vitality" | "attack" | "guard" | "speed" | "mission" | "ryo" | "fateShard" | "boneCharm"
    | "roleDefender" | "roleTracker" | "roleAssassin" | "roleSage"
    | "elementFire" | "elementWater" | "elementWind" | "elementEarth" | "elementLightning"
    | "biomeForest" | "biomeSnow" | "biomeVolcano" | "biomeCentral" | "biomeShadow"
    | "healer" | "vanguard" | "petTamer" | "tavern" | "arena" | "missionHall" | "cardHall"
    | "dice" | "crown" | "warning" | "shop" | "key" | "scroll" | "clanHall" | "rations";

const ART: Record<GameArtIconKind, string> = {
    vitality: "/ui/game-icons/vitality.webp",
    attack: "/ui/clan-missions/clan-mission-battle.webp",
    guard: "/ui/clan-missions/clan-mission-guard.webp",
    speed: "/ui/game-icons/speed.webp",
    mission: "/ui/clan-missions/clan-mission-mission.webp",
    ryo: "/ui/clan-missions/clan-mission-donation.webp",
    fateShard: "/item-elemental-shard.webp",
    boneCharm: "/ui/game-icons/bone-charm.webp",
    roleDefender, roleTracker, roleAssassin, roleSage,
    elementFire, elementWater, elementWind, elementEarth, elementLightning,
    biomeForest, biomeSnow, biomeVolcano, biomeCentral, biomeShadow,
    healer: professionHealer, vanguard: professionVanguard, petTamer: professionPetTamer,
    tavern: facilityTavern, arena: facilityArena, missionHall: facilityMissionHall, cardHall: facilityCardHall,
    dice: "/items/event-forged-die.webp", crown: "/items/ranked-seal-crown-v1.webp",
    warning: "/combat-vfx/debuff.webp", shop: facilityShop,
    key: "/items/item-hollow-gate-key-v1.webp",
    scroll: "/items/item-territory-control-scroll-v1.webp",
    clanHall: facilityClanHall, rations: facilityCafeteria,
};

export function GameArtIcon({ kind, size = 20, className }: { kind: GameArtIconKind; size?: number; className?: string }) {
    return <img className={className} src={ART[kind]} alt="" aria-hidden="true" width={size} height={size} loading="lazy" decoding="async" style={{ width: size, height: size, objectFit: "contain", verticalAlign: "middle", flex: "0 0 auto" }} />;
}
