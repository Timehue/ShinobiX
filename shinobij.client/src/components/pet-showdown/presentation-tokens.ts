import type { ShowdownIconName } from '../icons/ShowdownIcon';

const ELEMENT_TINT: Record<string, string> = {
    Fire: "#ff7a35", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#fde047", Earth: "#d6a76a", None: "#a5b4fc",
};

/** One authored crest per element. The painted WebP (ELEMENT_ICON) is used only
 *  at >=48px — 5-9 KB of paint turns to mud below ~32px, and only the vector
 *  tints with `color`. */
const ELEMENT_CREST: Record<string, ShowdownIconName> = {
    Fire: "elem-fire", Water: "elem-water", Wind: "elem-wind",
    Lightning: "elem-lightning", Earth: "elem-earth", None: "elem-none",
};

function elementCrest(element: string): ShowdownIconName {
    return ELEMENT_CREST[element] ?? "elem-none";
}

/** Offense / control / support — the icon's own colour, never a background. */
const KIND_FAMILY: Record<string, "off" | "ctl" | "sup"> = {
    damage: "off", crush: "off", lifesteal: "off", wound: "off", burn: "off", dot: "off",
    stun: "ctl", freeze: "ctl", confuse: "ctl", slow: "ctl", movelock: "ctl",
    push: "ctl", pull: "ctl", mark: "ctl", taunt: "ctl", debuff: "ctl",
    pivot: "off", protect: "sup", weather: "sup",
    heal: "sup", shield: "sup", guard: "sup", barrier: "sup", absorb: "sup",
    buff: "sup", haste: "sup", move: "sup", rest: "sup",
};

export { ELEMENT_TINT, elementCrest, KIND_FAMILY };
