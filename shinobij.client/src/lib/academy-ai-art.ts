import type { CreatorAi } from "../types/creator-ai";
import academySparringPartnerImg from "../assets/academy/academy-sparring-partner.webp";
import academyTrainingDummyImg from "../assets/academy/academy-training-dummy.webp";

export { academyTrainingDummyImg };

export function withAcademySparringPortrait(ai: CreatorAi): CreatorAi {
    return ai.id === "builtin-ai-academy-sparring" && !ai.image ? { ...ai, image: academySparringPartnerImg } : ai;
}
