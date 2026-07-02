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
import { RARITY_LABELS, type SageOfferView } from "./legacy";

export const SAGE_VN_EVENT_ID = "legacy-sage-offer";
const SPEAKER = "Wandering Sage";
const SCENE = "/scenes/legacy-sage-offer.png";

export function buildSageVnEvent(offer: SageOfferView, playerName: string): CreatorEvent {
    const offerLines = offer.offers.map(
        (o) => `${SPEAKER}: ${o.name} — ${RARITY_LABELS[o.rarity]}. ${o.flavor}`,
    );
    const pages: NonNullable<CreatorEvent["vnPages"]> = [
        {
            title: "A Stranger on the Road",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: I have watched your path, ${playerName}. Every battle, every mission, every choice has carved something into your spirit.`,
                `${SPEAKER}: Your victories were not random. A shape has formed behind your footsteps — and it has a name.`,
            ],
        },
        {
            title: "The Paths Before You",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: These are the legacies your life has opened to you:`,
                ...offerLines,
            ],
        },
        {
            title: "The Weight of the Choice",
            scene: SCENE,
            speaker: SPEAKER,
            dialogue: [
                `${SPEAKER}: Hear me well. A legacy is permanent. You may only ever accept one — and once your path is chosen, it is sealed forever.`,
                `${SPEAKER}: Fail its trial and you may try again, as many times as your spirit allows. But you may never choose another.`,
                `${SPEAKER}: There is no shame in walking away. When your spirit is ready, I may find you again.`,
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
