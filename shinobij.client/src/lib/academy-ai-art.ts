import type { CreatorAi } from "../types/creator-ai";
import academySparringPartnerImg from "../assets/academy/academy-sparring-partner.webp";
import academyTrainingDummyImg from "../assets/academy/academy-training-dummy.webp";
import { bundledAiPortrait } from "./builtin-ai-portraits";

export { academyTrainingDummyImg };

export function withAcademySparringPortrait(ai: CreatorAi): CreatorAi {
    // Keep the repaired mission portrait even when an old published image is hydrated.
    const replacement = bundledAiPortrait(ai.id);
    if (replacement) return { ...ai, image: replacement };
    return ai.id === "builtin-ai-academy-sparring" && !ai.image ? { ...ai, image: academySparringPartnerImg } : ai;
}
