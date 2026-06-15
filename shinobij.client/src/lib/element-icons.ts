/*
 * Painted element emblem icons — transparent cutouts (gpt-image-1) keyed by the
 * pet's JutsuElement. Used for the Pet Arena matchup hints, the Battle Plan
 * element spread, and the pick-card meta line so elements read with the same
 * painted style as the role badges ([[role-icons]]) instead of OS emoji.
 */
import elementFire from "../assets/elements/element-fire.webp";
import elementWater from "../assets/elements/element-water.webp";
import elementWind from "../assets/elements/element-wind.webp";
import elementLightning from "../assets/elements/element-lightning.webp";
import elementEarth from "../assets/elements/element-earth.webp";

export const ELEMENT_ICON: Record<string, string> = {
    Fire: elementFire,
    Water: elementWater,
    Wind: elementWind,
    Lightning: elementLightning,
    Earth: elementEarth,
};
