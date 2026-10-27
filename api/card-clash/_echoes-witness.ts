import {
    ECHOES_WITNESS_ERAS,
    echoesWitnessEra,
    isEchoesWitnessChoice,
    normalizeEchoesWitnessChoices,
    type EchoesWitnessChoiceId,
    type EchoesWitnessChoices,
    type EchoesWitnessEraId,
} from "../../shared/echoes-witness.js";
import { ECHOES_TITLES } from "../_titles-registry.js";
import { echoesProgressOf } from "./_echoes-catalog.js";

export type EchoesWitnessRecordResult =
    | {
        ok: true;
        character: Record<string, unknown>;
        choices: EchoesWitnessChoices;
        eraId: EchoesWitnessEraId;
        choiceId: EchoesWitnessChoiceId;
        alreadySealed: boolean;
        /** Titles this call credited (Chapter One closes on the fourth record). */
        grantedTitles: string[];
        write: boolean;
    }
    | { ok: false; status: 400 | 409; error: string };

/** Sealing the last age's witness record closes Chapter One. The title is
 * credited from the sealed records, never from anything the client says, and
 * a seal that already happened repairs a missing title on retry. */
function withChapterOneTitle(
    character: Record<string, unknown>,
    choices: EchoesWitnessChoices,
): { character: Record<string, unknown>; grantedTitles: string[] } {
    const title = ECHOES_TITLES.chapterOne;
    if (!title || !ECHOES_WITNESS_ERAS.every((era) => choices[era.id])) return { character, grantedTitles: [] };
    const vault = Array.isArray(character.serverTitles)
        ? (character.serverTitles as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
    if (vault.includes(title)) return { character, grantedTitles: [] };
    return { character: { ...character, serverTitles: [...vault, title] }, grantedTitles: [title] };
}

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
        const repaired = withChapterOneTitle(
            normalizedChanged ? { ...character, echoesWitnessChoices: choices } : character,
            choices,
        );
        return {
            ok: true,
            character: repaired.character,
            choices,
            eraId: era.id,
            choiceId: existing,
            alreadySealed: true,
            grantedTitles: repaired.grantedTitles,
            write: normalizedChanged || repaired.grantedTitles.length > 0,
        };
    }
    const progress = echoesProgressOf(character);
    if ((progress[era.closeEncounterId]?.wins ?? 0) < 1) {
        return { ok: false, status: 409, error: "Finish this age before sealing its witness record." };
    }
    const eraId = era.id as EchoesWitnessEraId;
    const choiceId = choiceIdRaw as EchoesWitnessChoiceId;
    const nextChoices: EchoesWitnessChoices = { ...choices, [eraId]: choiceId };
    const closed = withChapterOneTitle({ ...character, echoesWitnessChoices: nextChoices }, nextChoices);
    return {
        ok: true,
        character: closed.character,
        choices: nextChoices,
        eraId,
        choiceId,
        alreadySealed: false,
        grantedTitles: closed.grantedTitles,
        write: true,
    };
}
