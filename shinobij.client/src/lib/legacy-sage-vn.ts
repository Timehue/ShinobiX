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
        const villagePart = o.villageAffinity ? ` I found the clearest reports of it in ${o.villageAffinity}.` : "";
        const sigPart = o.signature ? ` If you take the name and pass its trial, I will teach you ${o.signature.name}.` : "";
        return `${SPEAKER}: ${o.name}. ${o.flavor}${villagePart}${sigPart}`;
    });
    const pages: NonNullable<CreatorEvent["vnPages"]> = [
        {
            title: "A Stranger on the Road",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: I walked a long way checking the reports tied to your name, ${playerName}. The witnesses disagree about what your choices mean. Good.`,
                `Player: Then what are you measuring?`,
                `${SPEAKER}: What you choose again when the cost changes. Your record shows several such patterns, so I brought the names that fit.`,
            ],
        },
        {
            title: "The Paths Before You",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: These are the names your deeds can honestly carry. Hear them before you decide:`,
                ...offerLines,
            ],
        },
        {
            title: "The Weight of the Choice",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: Before you touch a seal, hear the terms plainly. You may accept one Legacy in your lifetime. It names a pattern in your deeds; no ancestor, soul, or Bloodline enters you.`,
                `${SPEAKER}: If the trial defeats you, train and return. You may repeat the trial. You may not exchange the name once you accept it.`,
                `${SPEAKER}: You may refuse every name here. I will leave. If later deeds change the reading, I may return with different names.`,
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
