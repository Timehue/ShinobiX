/** Recognition of existing exam receipts; no new progression or reward state. */
export const CAREER_MILESTONES = [
    {
        id: "exam-genin", examKey: "genin", name: "Field Proven", prestige: false,
        desc: "Pass the Genin Advancement Exam.",
        title: "Genin advancement earned",
        body: "Your training has held up in the field. With your Genin advancement complete, the road toward Chunin is open.",
    },
    {
        id: "exam-chunin", examKey: "chunin", name: "Trusted in the Field", prestige: false,
        desc: "Pass the Chunin Advancement Exam.",
        title: "Chunin advancement earned",
        body: "You have faced the Exam Proctor and proven your readiness beyond solo training. Your Chunin advancement is complete, and the road toward Jonin is open.",
    },
    {
        id: "exam-jonin", examKey: "jonin", name: "Veteran's Resolve", prestige: true,
        desc: "Complete the optional Jonin Exam distinction.",
        title: "Jonin distinction earned",
        body: "From rival shinobi to village raids and the Rogue Ninja, you have proven your experience in battle. Your veteran service is now recognized.",
    },
    {
        id: "exam-special-jonin", examKey: "specialJonin", name: "Service and Steel", prestige: true,
        desc: "Complete the optional Special Jonin Distinction.",
        title: "Special Jonin distinction earned",
        body: "Your record joins battlefield experience with village leadership. Your service as a Kage or Elder stands alongside your achievements in combat.",
    },
] as const;

export function hasCareerExam(examsPassed: unknown, examKey: string): boolean {
    return Array.isArray(examsPassed) && examsPassed.includes(examKey);
}

export function isCareerAchievement(id: string): boolean {
    return CAREER_MILESTONES.some((milestone) => milestone.id === id);
}

/** New recognition must not accelerate the existing currency-paying meta milestones. */
export function achievementMetaCount(unlocked: unknown): number {
    return Array.isArray(unlocked) ? unlocked.filter((id) => !isCareerAchievement(id)).length : 0;
}
