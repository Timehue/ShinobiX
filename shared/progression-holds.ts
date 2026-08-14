/** The only rank exams that can stop level progression. */
export const PROGRESSION_EXAM_HOLDS = [
    // These are advancement gates taken while already holding the matching
    // level-based rank (Genin starts at 15; Chunin starts at 30).  The labels
    // deliberately say "Advancement" so players do not expect the exam itself
    // to award a rank they already earned.
    { exam: 'genin', level: 20, label: 'Genin Advancement Exam' },
    { exam: 'chunin', level: 39, label: 'Chunin Advancement Exam' },
] as const;
