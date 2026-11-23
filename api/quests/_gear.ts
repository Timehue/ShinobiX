/*
 * The gear chance on a quest line's reward.
 *
 * Some quests give, on top of what they always pay, a chance at one gear piece
 * (owner, 2026-11-20: "some of them can have like a 20% chance to drop gear").
 * The piece is an ordinary gear step drop (api/_gear-drops.ts): a step item of
 * the tier the player has unlocked, preferring one they do not own. Nothing
 * here is new gear, and nothing here changes what a drop is.
 *
 * The roll is fixed by the player and the quest, and salted with the server's
 * secret (gearRoll). So a claim that is retried, or run again after a version
 * conflict, gets the same answer, and no one outside the server can tell
 * beforehand whether a quest will drop for them. A quest pays once, so the roll
 * is made once: the answer is the same if an admin has the quest paid again.
 */
import { GEAR_DROP_CHANCE_BP, gearRoll, pickGearDrop } from '../_gear-drops.js';

/** The chance a quest that drops gear uses: the same 20 percent a clan cache has. */
export const QUEST_GEAR_CHANCE_BP = GEAR_DROP_CHANCE_BP.questLine;

type Holder = { gearTierUnlocks?: unknown; inventory?: unknown; equipment?: unknown };

export function questLineGearDrop(playerName: string, character: Holder, chanceBp: number, questId: string): string | null {
    const key = `quest-line:${playerName}:${questId}`;
    if (!(chanceBp > 0) || gearRoll(key) >= chanceBp / 10_000) return null;
    let draw = 0;
    return pickGearDrop(character, max => Math.floor(gearRoll(`${key}:pick:${draw++}`) * Math.max(1, max)));
}
