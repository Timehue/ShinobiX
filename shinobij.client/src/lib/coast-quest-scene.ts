/*
 * Builds the scene for a coast quest's key moments: the offer, a choice or
 * question, the words before its boss, and the closing.
 *
 * Presentation only. The lines are the ones the server already sent for this
 * player (`talk`), so nothing is shown ahead of its step, and what a scene
 * leads to (taking the quest, the fight, the claim, the choice) is still asked
 * of the server by the journal that opened it.
 */
import type { CreatorEvent } from "../types/vn";
import type { QuestLine } from "./quest-lines-api";
import type { WandererArchetypeId } from "./wanderers";
import { coastStoryArt } from "./coast-journal-art";
import { WANDERER_BOSS_PORTRAIT, wandererAvatar } from "./wanderer-art";

type Pages = NonNullable<CreatorEvent["vnPages"]>;

/** The event id every coast scene starts with. The reader (TriggeredVisualNovel) ends these on their last line. */
export const COAST_SCENE_ID = "coast-quest:";
/** The answer at the end of an offer's scene that takes the quest. */
export const OFFER_TAKE = "take";

/**
 * The picture a member of the coast's cast is shown with. The server sends
 * either the path of their own cut-out (shared/coast-cast.ts) or the name of
 * the wanderer face their model wears (castFaceOf in api/quests/_views.ts).
 */
export function castPortrait(face: string): string {
    if (face[0] === "/") return face;
    return face === "boss" ? WANDERER_BOSS_PORTRAIT : wandererAvatar(face as WandererArchetypeId) || wandererAvatar("bandit");
}

/**
 * The scene for what a quest is saying right now. A new page starts whenever a
 * different named person speaks, so the portrait always matches the voice.
 */
export function coastSceneEvent(line: QuestLine, playerName: string, caption: string): CreatorEvent {
    const image = coastStoryArt(line.backdrop);
    const pages: Pages = [];
    const choice = line.stage?.choice;
    const talk = [...line.talk ?? []];
    if (choice) talk.push({ speaker: "", text: choice.prompt });
    for (const say of talk) {
        const named = say.face ? say.speaker : "";
        let page = pages.at(-1);
        if (!page || (named && page.rightName && page.rightName !== named)) {
            page = { title: line.title, scene: caption, speaker: "Narrator", dialogue: [], lines: [], leftName: "Player", image };
            pages.push(page);
        }
        if (named && !page.rightName) Object.assign(page, { speaker: named, rightName: named, rightImage: castPortrait(say.face!) });
        const speaker = say.speaker === "You" ? playerName : say.speaker || "Narrator";
        page.lines!.push({ speaker, text: say.text });
        page.dialogue.push(`${speaker}: ${say.text}`);
    }
    const last = pages.at(-1);
    if (last && choice) last.choices = choice.options.map(option => ({ id: option.key, text: `${option.label}. ${option.blurb}`, nextPage: pages.length - 1 }));
    // An offer ends on the decision itself, so the quest is taken in the scene and never by skipping it.
    else if (last && line.state === "open") last.choices = [{ id: OFFER_TAKE, text: "Take the quest", nextPage: pages.length - 1 }, { id: "later", text: "Not now", nextPage: pages.length - 1 }];
    return {
        // The id ends with the theme the server named, which is how the reader's score finds it (resolveVnScoreKey).
        id: COAST_SCENE_ID + line.id + "@" + line.score, name: line.title, biome: "central", icon: "", eventKind: "visualNovel", image,
        // Open ground and weather under the voices, not the village bed a scene gets by default.
        cinematic: { ambience: "road" },
        vnPages: pages, levelReq: 0, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: [],
    };
}

const seenKey = (key: string) => "coastScene.v1." + key;
/** Whether this player has already been shown a scene on this device. A fight lost and tried again does not replay its opening. */
export function coastSceneSeen(key: string): boolean {
    try { return localStorage.getItem(seenKey(key)) === "1"; } catch { return false; }
}
export function markCoastSceneSeen(key: string): void {
    try { localStorage.setItem(seenKey(key), "1"); } catch { /* the scene simply plays again */ }
}
