import type { Character } from "../types/character";
import {
    echoesWitnessEra,
    isEchoesWitnessChoice,
    normalizeEchoesWitnessChoices,
    type EchoesWitnessChoiceId,
    type EchoesWitnessChoices,
    type EchoesWitnessEraId,
} from "../../../shared/echoes-witness";

export type EchoesWitnessResponse = {
    character: Character;
    saveVersion: number;
    eraId: EchoesWitnessEraId;
    choiceId: EchoesWitnessChoiceId;
    choices: EchoesWitnessChoices;
    alreadySealed: boolean;
};

/** Server clear + missing cosmetic post flag means the authoritative reward
 * landed but the conclusion may have been lost to a disconnect. */
export function echoesConclusionPending(wins: unknown, postSeen: unknown): boolean {
    return Math.max(0, Math.floor(Number(wins) || 0)) > 0 && postSeen !== true;
}

export async function recordEchoesWitness(
    playerName: string,
    eraId: EchoesWitnessEraId,
    choiceId: EchoesWitnessChoiceId,
    fetcher: typeof fetch = fetch,
): Promise<EchoesWitnessResponse> {
    const response = await fetcher("/api/card-clash/echoes-witness", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ playerName, eraId, choiceId }),
    });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || data?.ok !== true) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not seal the witness record.");
    }
    const era = echoesWitnessEra(data.eraId);
    const returnedChoice = data.choiceId;
    const saveVersion = Number(data._saveVersion);
    const character = data.character as Character | undefined;
    const choices = normalizeEchoesWitnessChoices(data.choices);
    if (!era || era.id !== eraId || !isEchoesWitnessChoice(era.id, returnedChoice)
        || !character || character.name !== playerName || !Number.isSafeInteger(saveVersion)
        || choices[era.id] !== returnedChoice) {
        throw new Error("The witness response could not be verified.");
    }
    return {
        character,
        saveVersion,
        eraId: era.id,
        choiceId: returnedChoice,
        choices,
        alreadySealed: data.alreadySealed === true,
    };
}
