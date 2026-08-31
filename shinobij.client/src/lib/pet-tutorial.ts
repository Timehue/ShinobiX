import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import {
    normalizePetTutorialProgress,
    type PetTutorialLessonId,
    type PetTutorialProgress,
} from "../../../shared/pet-tutorial";

export {
    PET_TUTORIAL_VERSION,
    normalizePetTutorialProgress,
    type PetTutorialLessonId,
    type PetTutorialProgress,
} from "../../../shared/pet-tutorial";

export { PET_MENTOR_WANDERER_ID, PET_MENTOR_NAME } from "./pet-tutorial-mentor";

export type PetTutorialPage = {
    kicker: string;
    title: string;
    body: string;
    points: string[];
    callout?: string;
};

export type PetTutorialDestination =
    | { kind: "screen"; screen: Screen }
    | { kind: "arena"; view: "battle" | "tactical" | "gauntlet" };

export type PetTutorialLesson = {
    id: PetTutorialLessonId;
    order: number;
    minLevel: number;
    minPets: number;
    eyebrow: string;
    title: string;
    shortTitle: string;
    summary: string;
    practiceLabel: string;
    destination: PetTutorialDestination;
    pages: PetTutorialPage[];
};

/**
 * Tomoe's curriculum follows the rank bands already used by the rest of the
 * game. The first lessons arrive after the Academy companion introduction;
 * party play arrives with Genin breadth; four-pet command arrives at Chunin.
 * Roster requirements are as important as level so Tomoe never teaches a mode
 * the player cannot field yet.
 */
export const PET_TUTORIAL_LESSONS: readonly PetTutorialLesson[] = [
    {
        id: "bond",
        order: 1,
        minLevel: 2,
        minPets: 1,
        eyebrow: "Companion foundations",
        title: "Know the beast beside you",
        shortTitle: "Your companion",
        summary: "Read roles, elements, availability, and the difference between caring for a pet and fielding one.",
        practiceLabel: "Open the Pet Yard",
        destination: { kind: "screen", screen: "pets" },
        pages: [
            {
                kicker: "Lesson 1 · The bond",
                title: "A pet is a fighter, not equipment",
                body: "{pet} keeps a level, element, role, techniques, gear, and assignments of its own. Start by reading the whole card. Raw power matters, but a pet that answers the matchup and knows its job will beat a larger number surprisingly often.",
                points: [
                    "Level and stats describe how hard the pet can trade.",
                    "Element decides favorable and unfavorable matchups.",
                    "Role describes battlefield behavior: defender, assassin, tracker, or sage.",
                ],
                callout: "Tomoe: ‘If you only read the power number, Kuro has already read more of the fight than you.’",
            },
            {
                kicker: "Lesson 1 · Bondwake",
                title: "Why Kuro carries two tails",
                body: "Kuro was born with one tail. An ember-ocelot can grow a second only after a mature shinobi bond settles into a stable shared chakra rhythm—a rare change handlers call the Bondwake. The new tail follows the first by a heartbeat, answering learned intent after instinct has already moved.",
                points: [
                    "Bondwake comes from long trust, clear commands, and shared field experience; age or raw power cannot force it.",
                    "The second tail is a visible sign of responsiveness between handler and companion, not ownership or obedience without choice.",
                    "Bondwake grants no hidden stat bonus and is not a separate evolution tier; other species show mature bonds in different ways.",
                ],
                callout: "Tomoe: ‘Kuro had one tail when we met. The second appeared the morning he chose my signal before I gave it.’",
            },
            {
                kicker: "Lesson 1 · Readiness",
                title: "Available means available",
                body: "Training, breeding, and expeditions take a companion out of battle. The Sanctuary can also hold overflow pets outside the carried roster. Check readiness before building a team so your planned reserve is not somewhere else when the gate opens.",
                points: [
                    "Your active pet is the companion used by pet-aware PvE and preselected by some battle entries.",
                    "The 2v2 partner is only a default reserve; you can change it before a duel.",
                    "Battle consumables and PvP gear can matter, so inspect the loadout before a serious bout.",
                ],
            },
            {
                kicker: "Lesson 1 · Matchups",
                title: "Learn the five-part wheel",
                body: "The elemental chain is Fire → Wind → Lightning → Earth → Water → Fire. In Showdown, attacking the element you beat deals more damage; attacking the element that beats you deals less. Neutral moves are the safe answer when the wheel turns against you.",
                points: [
                    "Do not confuse your pet's element with every move's element.",
                    "A balanced roster gives you an answer when one lead matchup is bad.",
                    "Roles and elements solve different problems; build for both.",
                ],
            },
        ],
    },
    {
        id: "showdown",
        order: 2,
        minLevel: 5,
        minPets: 1,
        eyebrow: "Safe command practice",
        title: "Call a complete Showdown",
        shortTitle: "Showdown",
        summary: "Learn the turn loop, targeting, stamina, holds, signatures, switching, and judge decisions without risking rewards.",
        practiceLabel: "Enter Training Grounds",
        destination: { kind: "screen", screen: "petShowdown" },
        pages: [
            {
                kicker: "Lesson 2 · The command loop",
                title: "Choose, target, resolve, read",
                body: "Training Grounds uses the same command combat as paid Colosseum bouts, but pays nothing and has no daily limit. Every round you choose a technique or stance, choose a legal target when asked, commit the turn, then read what both sides actually did before planning again.",
                points: [
                    "Start in Sparring for an opponent leveled to your own team.",
                    "Click a fighter or its status plate when a move needs a target.",
                    "The event feed is evidence: use it to learn speed order, conditions, and damage swings.",
                ],
                callout: "Tomoe: ‘Practice is where you spend mistakes instead of ryo.’",
            },
            {
                kicker: "Lesson 2 · Technique economy",
                title: "Stamina is timing",
                body: "A kit is a ladder: a cheap jab, middle techniques, and a heavy finisher. Stamina returns slowly. You may overdraft and cast without enough stamina, but the missing cost comes out of health and the pet loses its next action.",
                points: [
                    "Cheap moves keep pressure without emptying the tank.",
                    "Heavy techniques pay for immediate impact, not efficiency.",
                    "Hold counters delay the strongest techniques; plan the round they come online.",
                ],
            },
            {
                kicker: "Lesson 2 · Survival",
                title: "Guard, conditions, and tempo",
                body: "Guard resolves early. Conditions can change a winning race, but a pet holds only two at a time; a third pushes off the oldest. Fire thaws freeze, frost smothers burn, and shields sit outside the condition limit.",
                points: [
                    "Turn order is speed multiplied by move priority—not speed alone.",
                    "The signature meter fills as a pet deals and takes damage, then empties in one cast.",
                    "A defensive turn is good when it ruins the opponent's expensive turn.",
                ],
            },
            {
                kicker: "Lesson 2 · Endgame",
                title: "Know how the judges decide",
                body: "Attrition begins late so endless healing cannot stall forever. After 25 rounds, the judges compare pets remaining, total health, total stamina, then the speed arrow. If you are ahead, protect the ladder; if behind, create a decisive swing before time runs out.",
                points: [
                    "A surviving reserve is worth more than pretty damage numbers.",
                    "Do not overdraft blindly near the judge limit.",
                    "Training is unlimited—repeat the matchup until you can explain why you won or lost.",
                ],
            },
        ],
    },
    {
        id: "colosseum",
        order: 3,
        minLevel: 10,
        minPets: 1,
        eyebrow: "The paid circuit",
        title: "Enter the Colosseum on purpose",
        shortTitle: "Colosseum",
        summary: "Understand matchmaking, paid-win limits, server-settled results, and when to return to practice.",
        practiceLabel: "Enter the Colosseum",
        destination: { kind: "screen", screen: "petColiseum" },
        pages: [
            {
                kicker: "Lesson 3 · Contract",
                title: "Same combat, real stakes",
                body: "The Colosseum uses the full Showdown rules you practiced, but the arena chooses the opposition and successful paid bouts count toward the daily purse. The opponent, seed, script, and result are sealed so refreshing cannot shop for a softer fight.",
                points: [
                    "Training Grounds is unlimited and unrewarded; Colosseum is matched and rewarded.",
                    "The paid-win counter is a reward cap, not a ban on learning the mode.",
                    "A loss is matchup information—use Training Grounds before spending another serious attempt.",
                ],
            },
            {
                kicker: "Lesson 3 · Preparation",
                title: "Bring a plan, not only a favorite",
                body: "Check the selected format, field only available pets, and review the elemental spread. In larger formats the bench is part of the plan: it can cover a bad lead, preserve a healthier judge ladder, or carry a synergy your opening line needs.",
                points: [
                    "Pick a legal full team before asking the arena to match you.",
                    "Use neutral pressure when a lead is trapped by the element wheel.",
                    "Save a signature for a target that matters; spectacle is not the same as value.",
                ],
                callout: "Tomoe: ‘Home sand does not make Kuro invincible. Preparation just makes him look that way.’",
            },
            {
                kicker: "Lesson 3 · Review",
                title: "Every settled bout is a lesson",
                body: "After the result, separate decisions from luck. Ask whether your target, stamina curve, switch timing, and defensive turns were sound. One unlucky condition is noise; repeatedly entering the same bad element is a habit.",
                points: [
                    "Review the feed before rematching.",
                    "Change one part of the plan at a time so you know what helped.",
                    "The strongest habit is recognizing when practice is cheaper than pride.",
                ],
            },
        ],
    },
    {
        id: "party",
        order: 4,
        minLevel: 15,
        minPets: 2,
        eyebrow: "Genin team tactics",
        title: "Fight as a pair",
        shortTitle: "2v2 teams",
        summary: "Build a lead and reserve that cover each other instead of treating 2v2 as two unrelated 1v1 fights.",
        practiceLabel: "Practice a 2v2",
        destination: { kind: "screen", screen: "petShowdown" },
        pages: [
            {
                kicker: "Lesson 4 · Pair construction",
                title: "Your reserve is an answer",
                body: "A 2v2 team needs two eligible pets on both sides. The reserve should repair a weakness in the lead—element coverage, role coverage, or a technique synergy—not merely be the second-highest power number.",
                points: [
                    "Set a default 2v2 partner in the Pet Yard, then override it when the matchup demands.",
                    "Do not pair two pets that lose to the same common answer unless their roles compensate.",
                    "A reserve that enters healthy can decide both the knockout race and the judges' ladder.",
                ],
            },
            {
                kicker: "Lesson 4 · Switching",
                title: "A switch spends tempo to change the question",
                body: "Switching gives up immediate pressure, so make the new matchup worth the cost. Switch before the lead is too damaged to contribute later, or when the reserve can absorb the technique the opponent is clearly building toward.",
                points: [
                    "Preserve useful pets; do not preserve one that has no favorable work left.",
                    "Track hold counters and signature meters across both sides.",
                    "A forced switch can be stronger than raw damage because it breaks the opponent's plan.",
                ],
            },
            {
                kicker: "Lesson 4 · Team identity",
                title: "Make both pets tell one story",
                body: "A good pair has a sentence: ‘the defender buys time for the assassin,’ ‘the tracker softens whatever the closer finishes,’ or ‘either element punishes the other's counter.’ If you cannot say the sentence, the team is probably just two pets standing together.",
                points: [
                    "Practice the same pair against several elemental spreads.",
                    "Change order as well as membership.",
                    "Keep one dependable neutral action somewhere in the pair.",
                ],
            },
        ],
    },
    {
        id: "ladder",
        order: 5,
        minLevel: 20,
        minPets: 1,
        eyebrow: "Ranked responsibility",
        title: "Defend a rank while you are away",
        shortTitle: "Pet Ladder",
        summary: "Set a legal defense, understand live queue versus ladder challenges, and climb without confusing rating modes.",
        practiceLabel: "Open the Pet Ladder",
        destination: { kind: "screen", screen: "petLadder" },
        pages: [
            {
                kicker: "Lesson 5 · Defense",
                title: "Your first move is made before the fight",
                body: "The ladder begins with a defense. In Colosseum ladder play one pet holds your place; Tactical ladder play uses four. The defense fights even while you are away, and its stats and PvP items count.",
                points: [
                    "You cannot challenge for rank until a legal defense is saved.",
                    "Choose consistency for unattended defense; fragile tricks need a pilot.",
                    "Notifications tell you who took your rank or failed to move you.",
                ],
            },
            {
                kicker: "Lesson 5 · Two ranked doors",
                title: "Live queue and ladder are not the same action",
                body: "The live ranked queue pairs two present players for one server-resolved duel. Ladder challenges target the rival above you and use that mode's sealed defense. Both are authoritative, but their entry, pacing, and climb rules differ.",
                points: [
                    "Live queue is immediate matchmaking when another player is searching.",
                    "Ladder challenge is positional: beat the offered rival to take the rung.",
                    "Tactical ladder unlocks only when you can field the required four-pet team.",
                ],
            },
            {
                kicker: "Lesson 5 · Climb",
                title: "Treat attempts as information",
                body: "A ladder is a long record, not one duel. Read who attacks you, update the defense when the field changes, and do not spend every daily challenge proving the same bad matchup twice.",
                points: [
                    "Set defense first, then inspect the offered opponent.",
                    "Keep busy pets out of a defense you expect to rely on.",
                    "Return after roster or gear improvements; rank is allowed to wait.",
                ],
            },
        ],
    },
    {
        id: "warfront",
        order: 6,
        minLevel: 30,
        minPets: 4,
        eyebrow: "Chunin command",
        title: "Command the Hollow Warfront",
        shortTitle: "Warfront",
        summary: "Field four pets at once, choose who holds the front line, and take two clashes out of three.",
        practiceLabel: "Open Warfront command",
        destination: { kind: "arena", view: "tactical" },
        pages: [
            {
                kicker: "Lesson 6 · Objective",
                title: "Everything you watch is the scoreboard",
                body: "Warfront fields all four of your pets at once against all four of theirs. A clash ends when one side is wiped, and whoever has more pets standing takes it. First to two clashes wins the Rite — there is no objective to capture and no structure to break, so every takedown on screen moves the result.",
                points: [
                    "Pets auto-fight by role: defenders hold, sages sustain, trackers pressure, assassins hunt.",
                    "Your work happens before the clash, not during it.",
                    "A clash runs about thirty seconds; a whole Rite is two or three of them.",
                ],
                callout: "Tomoe: ‘Four beasts make noise. A commander decides which two meet the enemy first.’",
            },
            {
                kicker: "Lesson 6 · Formation",
                title: "The front line is the decision",
                body: "Two of your pets hold the FRONT line and meet the enemy first; the other two start behind them. That single choice changes who absorbs the opening and who gets to act freely. You can see the enemy front line before you lock yours — their back line stays sealed, so the opening is a read rather than a guess.",
                points: [
                    "A defender in front holds. A sage in front dies — unless it is the sage they never reach.",
                    "Leading with your durable pets is the obvious line, and it is not always the best one.",
                    "Answer their front, or go around it.",
                ],
            },
            {
                kicker: "Lesson 6 · The band",
                title: "Four pets, not four individuals",
                body: "Every pet strengthens the whole band by its role — defenders and sages give health, trackers and assassins give attack — and gives half again when it shares a bandmate’s element. Role spread decides what you get; element spread decides how much.",
                points: [
                    "A band needs three different elements, or a single counter beats all four of you.",
                    "Elements are the strongest single force in a clash, so never field a one-element band.",
                    "Build for what your band gives each other, not just for four strong pets.",
                ],
            },
            {
                kicker: "Lesson 6 · The re-form",
                title: "One adjustment, after you have seen them fight",
                body: "After the opening clash the Rite pauses and shows you what every pet has left. You may move one forward or back — once per Rite — or hold the line you committed. Your band regroups between clashes, and the side that lost regroups harder, so losing the first clash is a setback rather than a defeat.",
                points: [
                    "Pull a badly wounded pet off the front before it is finished.",
                    "A pet that fell returns wounded, not dead — the second clash is still yours to take.",
                    "Holding the line is a real answer when your read was already right.",
                ],
            },
        ],
    },
    {
        id: "gauntlet",
        order: 7,
        minLevel: 40,
        minPets: 1,
        eyebrow: "Veteran endurance",
        title: "Build a run that survives itself",
        shortTitle: "Gauntlet",
        summary: "Draft, merge, position, activate synergies, spend carefully, and carry one roster through escalating rounds.",
        practiceLabel: "Enter the Pet Gauntlet",
        destination: { kind: "arena", view: "gauntlet" },
        pages: [
            {
                kicker: "Lesson 7 · Run economy",
                title: "The battle starts in the bazaar",
                body: "Gauntlet is an endurance run, not a single roster check. Recruit from the Beastmaster's Bazaar, improve the squad over time, and avoid spending so aggressively on one round that the next counter has no answer.",
                points: [
                    "Draft for a working field first; chase perfect rarity later.",
                    "Repeated pets can be merged into stronger versions.",
                    "Run-wide relics and boosts compound, so read every pickup before buying around it.",
                ],
            },
            {
                kicker: "Lesson 7 · Position",
                title: "Front and back are rules, not decoration",
                body: "Melee cannot reach the back until the front falls. Front-row pets deal more damage; the back row receives cover against melee. Put defenders where their taunt protects someone and keep sages away from the assassins looking for them.",
                points: [
                    "Defenders tank the front; assassins dive the back.",
                    "Trackers fire at vulnerable targets from range.",
                    "Sages heal and shield the most wounded ally, so survival time multiplies their value.",
                ],
            },
            {
                kicker: "Lesson 7 · Synergy",
                title: "Shared traits turn a roster into a composition",
                body: "Pets that share an element or role activate synergies. A synergy is worthwhile when it strengthens what the board is already built to do; forcing one by benching the only answer to the next enemy can make the badge prettier and the team worse.",
                points: [
                    "Read the enemy preview and elemental edge before every round.",
                    "Reposition between fights; yesterday's front line is not a vow.",
                    "A flexible five-pet formation usually outlives a one-combo draft.",
                ],
            },
            {
                kicker: "Lesson 7 · Endurance",
                title: "Carry decisions forward",
                body: "Enemy scaling rises each round while your roster, relics, merges, and mistakes persist. Review the latest combat result, patch the exposed weakness, and preserve enough flexibility for the rounds you have not seen.",
                points: [
                    "A narrow win is a warning before the scaling rises again.",
                    "Upgrade the piece that changes the next loss, not the piece you like looking at.",
                    "Weekly score rewards consistency across the whole run, not one spectacular round.",
                ],
                callout: "Tomoe: ‘A champion wins a fight. A handler gets the whole pack home.’",
            },
        ],
    },
] as const;

export function completePetTutorialLesson(value: unknown, lessonId: PetTutorialLessonId): PetTutorialProgress {
    const progress = normalizePetTutorialProgress(value);
    return progress.completedLessonIds.includes(lessonId)
        ? progress
        : { ...progress, completedLessonIds: [...progress.completedLessonIds, lessonId] };
}

export function petTutorialLessonAvailable(
    lesson: PetTutorialLesson,
    character: Pick<Character, "level" | "pets">,
): boolean {
    return (character.level ?? 0) >= lesson.minLevel && (character.pets?.length ?? 0) >= lesson.minPets;
}

export function nextPetTutorialLesson(
    character: Pick<Character, "level" | "pets" | "petTutorialProgress">,
): PetTutorialLesson | null {
    const completed = new Set(normalizePetTutorialProgress(character.petTutorialProgress).completedLessonIds);
    return PET_TUTORIAL_LESSONS.find((lesson) => petTutorialLessonAvailable(lesson, character) && !completed.has(lesson.id)) ?? null;
}

export function petTutorialCompletion(value: unknown): { completed: number; total: number; percent: number } {
    const completed = normalizePetTutorialProgress(value).completedLessonIds.length;
    const total = PET_TUTORIAL_LESSONS.length;
    return { completed, total, percent: Math.round((completed / total) * 100) };
}

export function personalizePetTutorialText(text: string, character: Pick<Character, "pets" | "activePetId">): string {
    const pet = character.pets?.find((entry) => entry.id === character.activePetId) ?? character.pets?.[0];
    return text
        .replaceAll("{pet}", pet?.name?.trim() || "Your companion")
        .replaceAll("{element}", pet?.element?.trim() || "its");
}
