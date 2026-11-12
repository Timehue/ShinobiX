import castleImg from "../assets/castle.webp";
import houseImg from "../assets/house1.webp";
import moonshadowImage from "../assets/moonshadow.webp";
import stormveilVillageImg from "../assets/sectors/stormveil-village.webp";
// The world map's own Cinderhold crest (already shipped for the map pin).
import cinderholdImg from "../assets/map-landmarks/cinderhold.webp";

export function villagePageImage(villageName: string): string {
    if (villageName === "Stormveil Village") return stormveilVillageImg;
    if (villageName === "Ashen Leaf Village") return houseImg;
    if (villageName === "Frostfang Village") return castleImg;
    if (villageName === "Moonshadow Village") return moonshadowImage;
    if (villageName === "Cinderhold Village") return cinderholdImg;
    return stormveilVillageImg;
}
