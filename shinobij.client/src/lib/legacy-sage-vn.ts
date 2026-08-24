/*
 * Runtime VN script for the Wandering Sage's Legacy offer. Built from the
 * server's offer payload (api/legacy/sage.ts) and rendered by the existing
 * <TriggeredVisualNovel>. The VN is PRESENTATION ONLY — the actual choice
 * happens afterwards in <SageOfferModal> (accept goes through the server's
 * permanent-lock transaction, never a VN trait).
 *
 * Speaker "Wandering Sage" auto-resolves to /portraits/wandering-sage.webp;
 * the event id resolves the scene to /scenes/legacy-sage-offer.png
 * (both generated — docs/legacy-assets.md).
 */
import type { CreatorEvent } from "../types/vn";
import { type SageOfferView } from "./legacy";

export const SAGE_VN_EVENT_ID = "legacy-sage-offer";
const SPEAKER = "Wandering Sage";
const SCENE = "/scenes/legacy-sage-offer.png";

export function buildSageVnEvent(offer: SageOfferView, playerName: string): CreatorEvent {
    // The Sage names each path in-character, weaving in its favored village and
    // the signature it yields, so the VN isn't a flat echo of the offer cards.
    // Uses only fields already on the offer (no rank/rarity).
    const offerLines = offer.offers.map((o) => {
        const villagePart = o.villageAffinity ? ` ${o.villageAffinity} has field reports from shinobi who repeated it.` : "";
        const sigPart = o.signature ? ` Accept the name and pass its trial, and I will teach you ${o.signature.name}.` : "";
        return `${SPEAKER}: ${o.name}. ${o.flavor}${villagePart}${sigPart}`;
    });
    const pages: NonNullable<CreatorEvent["vnPages"]> = [
        {
            title: "A Stranger on the Road",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: I asked three witnesses about you, ${playerName}. One called you cautious. One called you reckless. The third refused to answer me.`,
                `${SPEAKER}: Good. A Legacy is not a reputation everyone agrees on. It is a choice you keep making when the cost changes. Your field record shows several such patterns.`,
            ],
        },
        {
            title: "The Paths Before You",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: These are the names that fit what you have actually done. Listen before you decide:`,
                ...offerLines,
            ],
        },
        {
            title: "The Weight of the Choice",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: Before you touch a seal, understand the terms. You may accept one Legacy in your lifetime. It names a pattern in your deeds; it does not place an ancestor, soul, or Bloodline inside you.`,
                `${SPEAKER}: If its trial defeats you, train and return. The trial may be repeated. The accepted name may not be exchanged for another.`,
                `${SPEAKER}: You may also refuse every name here. I will leave, and if your deeds change the reading, I may bring different names next time.`,
            ],
        },
    ];
    return {
        id: SAGE_VN_EVENT_ID,
        name: "The Wandering Sage",
        biome: "central",
        icon: "🜍",
        eventKind: "visualNovel",
        vnPages: pages,
        levelReq: 0,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: [],
    };
}
