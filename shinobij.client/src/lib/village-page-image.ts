import castleImg from "../assets/castle.webp";
import houseImg from "../assets/house1.webp";
import moonshadowImage from "../assets/moonshadow.webp";
import stormveilVillageImg from "../assets/sectors/stormveil-village.webp";

export function villagePageImage(villageName: string): string {
    if (villageName === "Stormveil Village") return stormveilVillageImg;
    if (villageName === "Ashen Leaf Village") return houseImg;
    if (villageName === "Frostfang Village") return castleImg;
    if (villageName === "Moonshadow Village") return moonshadowImage;
    return stormveilVillageImg;
}
