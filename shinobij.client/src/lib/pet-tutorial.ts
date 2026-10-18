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
                body: "Kuro was born with one tail. An ember-ocelot can grow a second when it has worked with a shinobi long enough for their chakra rhythms to settle together. Handlers call this rare change the Bondwake. Watch his tails when Tomoe signals: the first moves on instinct, and the second follows as he recognizes her command.",
                points: [
                    "Bondwake comes from long trust, clear commands, and shared field experience; age or raw power cannot force it.",
                    "The second tail is a visible sign of responsiveness between handler and companion, not ownership or obedience without choice.",
                    "Bondwake grants no hidden stat bonus and is not a separate evolution tier; other species show mature bonds in different ways.",
                ],
                callout: "Tomoe: ‘Kuro had one tail when we met. The morning I noticed the second, he turned before I finished my signal. We had practiced that turn for years.’",
            },
            {
                kicker: "Lesson 1 · Readiness",
                title: "Available means available",
                body: "Training can continue during pet battles. Breeding and active expeditions keep a companion away, while Sanctuary pets need a carried slot before they can join. Check readiness and collect completed expeditions before building your team.",
                points: [
                    "Your Active companion helps in shinobi fights once its PvE use is unlocked and is preselected by some battle entries.",
                    "The Yard's 2v2 Partner is a default pick for some entries. Check the starting pair and bench before fighting.",
                    "Use the loadout for the mode you are entering. Ranked techniques are saved separately from ordinary pet equipment.",
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
                    "Read the feed to see who acted first, which conditions landed, and how much damage got through.",
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
                    "Turn order uses speed multiplied by move priority. Speed alone does not decide who acts first.",
                    "The first signature also charges each round on the field. After using it, build the meter again by dealing and taking damage.",
                    "A defensive turn is good when it ruins the opponent's expensive turn.",
                ],
            },
            {
                kicker: "Lesson 2 · Endgame",
                title: "Know how the judges decide",
                body: "Attrition begins late so endless healing cannot stall forever. After 25 rounds, the judges compare pets remaining, total health, total stamina, then the speed arrow. If you are ahead, keep your companions alive. If you are behind, look for a knockout before the last round.",
                points: [
                    "A surviving reserve is worth more than pretty damage numbers.",
                    "Do not overdraft blindly near the judge limit.",
                    "Training Grounds is unlimited. Repeat the matchup until you can explain why you won or lost.",
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
        summary: "Learn how opponents are chosen, how many wins pay each day, and when to return to practice.",
        practiceLabel: "Enter the Colosseum",
        destination: { kind: "screen", screen: "petColiseum" },
        pages: [
            {
                kicker: "Lesson 3 · Contract",
                title: "Same combat, real stakes",
                body: "The Colosseum uses the Showdown rules you practiced. The arena chooses your opponent, and paid wins count toward the daily purse. Refreshing keeps the same bout; it will not give you an easier opponent or undo the result.",
                points: [
                    "Training Grounds is unlimited and unrewarded; Colosseum is matched and rewarded.",
                    "After the daily purse is used up, you can still fight, but further wins do not pay.",
                    "Use what you learned from a loss in Training Grounds before spending another serious attempt.",
                ],
            },
            {
                kicker: "Lesson 3 · Preparation",
                title: "Bring a plan, not only a favorite",
                body: "Check the selected format, field only available pets, and review the elemental spread. In larger formats the bench is part of the plan: it can cover a bad lead, keep a healthy companion for a close judges' decision, or carry a synergy your opening line needs.",
                points: [
                    "Pick a legal full team before asking the arena to match you.",
                    "Use neutral pressure when a lead is trapped by the element wheel.",
                    "Save a signature for a target that matters; spectacle is not the same as value.",
                ],
                callout: "Tomoe: ‘Home sand does not make Kuro invincible. Preparation just makes him look that way.’",
            },
            {
                kicker: "Lesson 3 · Review",
                title: "Learn from the last bout",
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
        summary: "Build an opening pair that works together, then choose reserves for the matchups you expect.",
        practiceLabel: "Practice a 2v2",
        destination: { kind: "screen", screen: "petShowdown" },
        pages: [
            {
                kicker: "Lesson 4 · Pair construction",
                title: "Choose the opening pair",
                body: "A 2v2 Showdown fields two companions together. Bring at least two available carried pets and add up to two reserves when you have them. Pair moves and elements that give each active pet something useful to do.",
                points: [
                    "Check which two companions start on the field and which wait on the bench.",
                    "Do not pair two pets that lose to the same common answer unless their roles compensate.",
                    "A healthy reserve gives you another chance to win and improves your position if the match reaches the judges.",
                ],
            },
            {
                kicker: "Lesson 4 · Switching",
                title: "Switch when the better matchup is worth a turn",
                body: "A switch replaces one active companion and uses its action for the round. Switch before that pet is too damaged to contribute later, or when a reserve can take the incoming hit in a better elemental matchup. The other active pet can keep up the pressure.",
                points: [
                    "Preserve useful pets; do not preserve one that has no favorable work left.",
                    "Track hold counters and signature meters across both sides.",
                    "A forced switch can be stronger than raw damage because it breaks the opponent's plan.",
                ],
            },
            {
                kicker: "Lesson 4 · Team identity",
                title: "Give each pet a job",
                body: "A defender can buy time for an assassin's heavy attack. A tracker can weaken a target for its partner to finish. You can also pair elements so each pet covers the other's weakness. Choose what you want the pair to do, then practice that plan.",
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
        title: "Choose the ranked contest you want",
        shortTitle: "Pet Ladder",
        summary: "Prepare a live Colosseum squad or save a Warfront defense, and learn how each contest changes your standing.",
        practiceLabel: "Open the Pet Ladder",
        destination: { kind: "screen", screen: "petLadder" },
        pages: [
            {
                kicker: "Lesson 5 · Live Colosseum",
                title: "Your first move is made before the fight",
                body: "Ranked Pet Colosseum pairs two players who choose their own orders each round. Bring four available carried companions for two active positions and two reserves. Competitive stats are balanced at level 50, while your companions keep their training outside the match.",
                points: [
                    "Equip four techniques alongside each pet's permanent signature. Choose a preset if you are still learning its moves.",
                    "Use Edit loadout in the companion viewer to save abilities for all battles, including PvE summons at pet level 50. You can also edit them in Battle & techniques or the ranked squad builder.",
                    "Choose your opening pair after reviewing the opponent's squad. Both players must lock orders before the planning clock ends.",
                ],
            },
            {
                kicker: "Lesson 5 · Warfront defense",
                title: "Your formation can defend while you are away",
                body: "The Beastbound Warfront ladder uses saved four-pet defenses. Pick your companions and starting cells, then save the formation. Its trained stats and roles count, while gear and consumables do not. The defense can be challenged even while you are offline.",
                points: [
                    "Save a legal defense before making a Warfront ladder challenge.",
                    "Beat the offered rival to take their rung. This changes your Warfront position, not your Colosseum Pet Elo.",
                    "Bring all four defense pets back from breeding or expeditions before challenging. A saved defense can still be attacked while they are away.",
                ],
            },
            {
                kicker: "Lesson 5 · Climb",
                title: "Treat attempts as information",
                body: "For the Colosseum, review your orders, stamina use, and switches before changing the squad. For Warfront, look at which pet fell first and whether a different starting cell could protect it. Change one part of the plan, then see whether the next fight improves.",
                points: [
                    "Colosseum wins and losses change Pet Elo after the battle is recorded.",
                    "Warfront has a daily challenge allowance. Check it before repeating the same matchup.",
                    "Update your saved Warfront defense after training or changing its companions and formation.",
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
        title: "Command Beastbound Warfront",
        shortTitle: "Warfront",
        summary: "Field four pets at once, choose who holds the front line, and take two clashes out of three.",
        practiceLabel: "Open Warfront command",
        destination: { kind: "arena", view: "tactical" },
        pages: [
            {
                kicker: "Lesson 6 · Objective",
                title: "Everything you watch is the scoreboard",
                body: "Warfront fields all four of your pets against all four of theirs. Wipe out the opposing team to win a clash. If both sides survive, companions standing decide the result, followed by remaining health. Win two clashes to take the Rite.",
                points: [
                    "Pets auto-fight by role: defenders hold, sages sustain, trackers pressure, assassins hunt.",
                    "Your work happens before the clash, not during it.",
                    "Watch who makes first contact and which pet falls first. Those are useful clues for the next formation.",
                ],
                callout: "Tomoe: ‘Watch where Kuro takes his first hit. A different starting cell might spare him the second.’",
            },
            {
                kicker: "Lesson 6 · Formation",
                title: "The front line is the decision",
                body: "Place each pet in one of ten starting cells: two ranks by five files. Front cells engage sooner; back cells give ranged pets and support more time. Two enemy positions are scouted before a casual match, while the rest stay sealed. Your spacing changes who can reach, protect, or strike several pets at once.",
                points: [
                    "Put durable defenders between opponents and fragile support.",
                    "Spread out against splash attacks; keep allies close enough to support each other.",
                    "Trained health, attack, defense, and speed remain part of the fight.",
                ],
            },
            {
                kicker: "Lesson 6 · The band",
                title: "Four pets, not four individuals",
                body: "Every pet strengthens the whole band. Defenders and sages add health; trackers and assassins add attack. A pet contributes 50% more when it shares a bandmate's element. Choose roles for the bonuses you need, then check how the elements affect them.",
                points: [
                    "Any mix of elements is allowed. A wider spread helps cover bad matchups.",
                    "Shared elements strengthen bonds, but a narrow band is more exposed to its counter. Decide whether that trade suits your team.",
                    "Build for what your band gives each other, not just for four strong pets.",
                ],
            },
            {
                kicker: "Lesson 6 · The re-form",
                title: "Adjust after you have seen them fight",
                body: "In casual Warfront, each unfinished clash pauses to show what every pet has left. Reposition your team or hold the line before the next clash. Your band regroups between clashes, and the side that lost regroups harder. Ranked Warfront instead uses the formation you saved for every clash, so your defense can fight while you are offline.",
                points: [
                    "Pull a badly wounded pet off the front before it is finished.",
                    "A pet that fell returns wounded for the next clash. You can still turn the match around.",
                    "Holding the line is a real answer when your read was already right.",
                    "Enter Ranked Beastbound Warfront from Arena District, save four pets and their cells, then challenge a nearby rank. Update your saved defense after training or changing the team.",
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
        title: "Build a squad for the whole run",
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
                body: "Defenders and Sages target the front line. Assassins dive into the back row, while Trackers can target enemies in any row. Front-row pets deal more damage; the back row receives cover against melee. Put defenders where their taunt protects someone and keep sages away from the assassins looking for them.",
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
