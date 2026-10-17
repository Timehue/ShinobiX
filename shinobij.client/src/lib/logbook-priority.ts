import type { Character } from "../types/character";
import type { LogbookObjective } from "./logbook-objectives";

/** Presentation only: a real level hold takes precedence over optional work. */
export function logbookPriority(
    character: Pick<Character, "level" | "examsPassed">,
    objectives: LogbookObjective[],
    current: LogbookObjective | null,
): LogbookObjective | null {
    const passed = new Set(character.examsPassed ?? []);
    const required = objectives.filter((objective) => objective.kind === "exam"
        && objective.progressionImpact === "blocking" && !passed.has(objective.examKey ?? ""));
    return required.find((objective) => character.level >= objective.unlockLevel)
        ?? current
        ?? required[0]
        // Exam order is enforced by the server, including optional distinctions.
        // Later combat/leadership requirements can be complete before Jonin is passed.
        ?? objectives.find((objective) => objective.progressionImpact === "prestige"
            && !passed.has(objective.examKey ?? ""))
        ?? null;
}
