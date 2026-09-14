import {
    ECHOES_WITNESS_ERAS,
    echoesWitnessEraForCloseEncounter,
    normalizeEchoesBattleBeat,
    type EchoesBattleBeat,
    type EchoesWitnessChoices,
} from "../../../shared/echoes-witness";
import type { EchoesScenePage, EchoesWitnessContent } from "../data/echoes-of-war";

export function echoesReactiveEraIntro(
    eraId: string,
    basePages: EchoesScenePage[] | undefined,
    choices: EchoesWitnessChoices,
    content: EchoesWitnessContent,
): EchoesScenePage[] | undefined {
    if (!basePages) return undefined;
    const eraIndex = ECHOES_WITNESS_ERAS.findIndex((era) => era.id === eraId);
    const previous = eraIndex > 0 ? ECHOES_WITNESS_ERAS[eraIndex - 1] : null;
    const choice = previous ? choices[previous.id] : undefined;
    const acknowledgement = previous && choice ? content[previous.id]?.nextEraAcknowledgements[choice] : undefined;
    return acknowledgement ? [basePages[0], acknowledgement, ...basePages.slice(1)] : basePages;
}

export function echoesReactiveVictory(
    opponentId: string,
    basePages: EchoesScenePage[],
    beat: EchoesBattleBeat | undefined,
    choices: EchoesWitnessChoices,
    content: EchoesWitnessContent,
): EchoesScenePage[] {
    const pages = [...basePages];
    const witnessEra = echoesWitnessEraForCloseEncounter(opponentId);
    const callback = witnessEra ? content[witnessEra.id]?.battleCallbacks[normalizeEchoesBattleBeat(beat)] : undefined;
    if (callback) pages.splice(Math.min(1, pages.length), 0, callback);

    if (opponentId === "echoes-10-halden") {
        const lines = ECHOES_WITNESS_ERAS.slice(0, 3).flatMap((era) => {
            const choice = choices[era.id];
            const line = choice ? content[era.id]?.haldenAcknowledgements[choice] : undefined;
            return line ? [line] : [];
        });
        if (lines.length > 0) {
            pages.splice(Math.max(1, pages.length - 2), 0, {
                title: "The Record You Brought",
                scene: "The council chamber, three earlier entries open between Halden and the witness",
                speaker: "Halden",
                dialogue: lines,
            });
        }
    }
    return pages;
}
