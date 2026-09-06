import {
    echoesWitnessEra,
    isEchoesWitnessChoice,
    normalizeEchoesWitnessChoices,
    type EchoesWitnessChoiceId,
    type EchoesWitnessChoices,
    type EchoesWitnessEraId,
} from "../../shared/echoes-witness.js";
import { echoesProgressOf } from "./_echoes-catalog.js";

export type EchoesWitnessRecordResult =
    | {
        ok: true;
        character: Record<string, unknown>;
        choices: EchoesWitnessChoices;
        eraId: EchoesWitnessEraId;
        choiceId: EchoesWitnessChoiceId;
        alreadySealed: boolean;
        write: boolean;
    }
    | { ok: false; status: 400 | 409; error: string };

/** Pure authoritative mutation used by the endpoint and tests. A sealed first
 * answer wins even if a stale client retries with a different button. */
export function recordEchoesWitnessChoice(
    character: Record<string, unknown>,
    eraIdRaw: unknown,
    choiceIdRaw: unknown,
): EchoesWitnessRecordResult {
    const era = echoesWitnessEra(eraIdRaw);
    if (!era) return { ok: false, status: 400, error: "Unknown Echoes age." };
    if (!isEchoesWitnessChoice(era.id, choiceIdRaw)) {
        return { ok: false, status: 400, error: "Unknown witness choice for this age." };
    }
    const choices = normalizeEchoesWitnessChoices(character.echoesWitnessChoices);
    const normalizedChanged = JSON.stringify(character.echoesWitnessChoices ?? {}) !== JSON.stringify(choices);
    const existing = choices[era.id];
    if (existing) {
        return {
            ok: true,
            character: normalizedChanged ? { ...character, echoesWitnessChoices: choices } : character,
            choices,
            eraId: era.id,
            choiceId: existing,
            alreadySealed: true,
            write: normalizedChanged,
        };
    }
    const progress = echoesProgressOf(character);
    if ((progress[era.closeEncounterId]?.wins ?? 0) < 1) {
        return { ok: false, status: 409, error: "Finish this age before sealing its witness record." };
    }
    const eraId = era.id as EchoesWitnessEraId;
    const choiceId = choiceIdRaw as EchoesWitnessChoiceId;
    const nextChoices: EchoesWitnessChoices = { ...choices, [eraId]: choiceId };
    return {
        ok: true,
        character: { ...character, echoesWitnessChoices: nextChoices },
        choices: nextChoices,
        eraId,
        choiceId,
        alreadySealed: false,
        write: true,
    };
}
