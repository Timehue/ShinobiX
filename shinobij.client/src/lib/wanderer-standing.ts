/*
 * Wanderer standing reactions — the world remembering your Quest Book branch
 * choices (character.questStandings, set server-side at epic claim). Pure + tested:
 * given a wanderer's archetype, the player's standings, and a roll, return an
 * optional reaction line — and, for bandits, whether they'll let you pass in peace.
 *
 * This is the payoff for branches that the engine sealed but nothing yet read:
 * sparing Goro earns you safe passage from his old gang now and then; executing him
 * (or other cold choices) earns colder words on the road. Flavor + a small mercy
 * dividend — it never touches reward rates or combat math.
 */
import type { WandererArchetypeId } from "./wanderers";

export interface StandingReaction {
    line: string;
    /** bandits only: they offer to let you pass without a fight */
    peace: boolean;
}

const has = (standings: string[] | null | undefined, flag: string): boolean =>
    Array.isArray(standings) && standings.includes(flag);

/**
 * `roll` is a 0..1 value (Math.random in the caller) so the peace chance is
 * testable. Returns null when the player's standings mean nothing to this wanderer.
 */
export function standingReaction(
    archetype: WandererArchetypeId,
    standings: string[] | null | undefined,
    roll: number,
): StandingReaction | null {
    if (archetype === "bandit") {
        if (has(standings, "goro-spared")) {
            return { line: "“You're the one who let Goro live. He rides with us now — and he says you walk free. ...This once.”", peace: roll < 0.6 };
        }
        if (has(standings, "goro-executed")) {
            return { line: "“You gutted Goro where he knelt, leaf. We don't forget that.”", peace: false };
        }
        return null;
    }
    if (archetype === "pilgrim" || archetype === "sage") {
        if (has(standings, "goro-executed")) {
            return { line: "“I heard what you did to that broken man. He couldn't help what he was made into.”", peace: false };
        }
        if (has(standings, "goro-spared")) {
            return { line: "“Word travels — you spared a soul that couldn't save itself. The road is a little kinder for it.”", peace: false };
        }
        if (has(standings, "bell-raw")) {
            return { line: "“They say you bore a screaming bell across the wilds and never let it finish. ...Brave, or mad.”", peace: false };
        }
    }
    return null;
}
