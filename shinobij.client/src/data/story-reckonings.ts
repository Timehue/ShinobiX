export type StoryReckoningTaskKind = "hunt" | "collect";
export type StoryReckoningMetric = "totalAiKills" | "totalTilesExplored";

export type StoryReckoningChoice = {
    text: string;
    conclusion?: string;
    trait?: string;
    requireTrait?: string;
    accept?: boolean;
};

export type StoryReckoningPage = {
    title: string;
    scene: string;
    speaker: string;
    dialogue: string[];
    choices?: StoryReckoningChoice[];
};

export type StoryReckoningBoss = {
    bossId: string;
    name: string;
    icon: string;
    portrait: string;
    loadoutId: "balanced" | "bruiser" | "defender" | "boss";
    statBonus: number;
    levelOffset: number;
};

export type StoryReckoning = {
    id: string;
    slug: string;
    village: string;
    npcName: string;
    levelReq: number;
    ownProgress: number;
    completionTrait: string;
    title: string;
    task: {
        kind: StoryReckoningTaskKind;
        metric: StoryReckoningMetric;
        target: number;
        dropItemId: string;
        targetName: string;
        boss?: StoryReckoningBoss;
    };
    reward: { weight: number; fateShards?: number; title: string };
    intro: StoryReckoningPage[];
    payoff: StoryReckoningPage[];
};

export const storyReckonings: StoryReckoning[] = [
    {
        id: "story-reckoning-vanta-ninth",
        slug: "vanta-ninth",
        village: "Stormveil Village",
        npcName: "Elder Vanta",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "svr-vanta-ninth-closed",
        title: "The Ninth Share",
        task: {
            kind: "hunt",
            metric: "totalAiKills",
            target: 1,
            dropItemId: "event-kesa-storm-seal",
            targetName: "Warden Sesk",
            boss: { bossId: "svr-warden-sesk", name: "Warden Sesk", icon: "WS", portrait: "/portraits/warden-sesk.webp", loadoutId: "boss", statBonus: 4, levelOffset: 2 },
        },
        reward: { weight: 6, fateShards: 1, title: "Storm-Witness" },
        intro: [
            {
                title: "The Old Man at the Boundary",
                scene: "The Stormveil outskirts, where the arena road gives way to open sky",
                speaker: "Elder Vanta",
                dialogue: [
                    "Vanta waits beside the last boundary stone with a book under one arm and no proverb ready.",
                    "Kesa Volt's account is closed, but the old machinery did not stop reaching for people who still remember her.",
                    "A collector named Sesk carries one of the seals that kept her reason profitable. I signed enough ledgers to know the stamp.",
                ],
            },
            {
                title: "Close the Share",
                scene: "The boundary road, rain gathering over the arena cables",
                speaker: "Elder Vanta",
                dialogue: [
                    "I cannot send village guard after him. Half the paper that protects him has my handwriting on it.",
                    "You are not on that paper. Find Sesk, take back Kesa's storm-seal, and bring it here where I have to look at it.",
                    "Then the ninth share dies in daylight instead of earning interest in a drawer.",
                ],
                choices: [
                    { text: "Take the writ. Hunt down Warden Sesk.", accept: true },
                    { text: "Not yet. This should not be rushed.", trait: "svr-vanta-weighed-it", conclusion: "Vanta nods once. A reckoning that waited six years can wait for you to mean it." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Seal Comes Home",
                scene: "The boundary stone, the storm-seal cold in your hand",
                speaker: "Elder Vanta",
                dialogue: [
                    "Vanta takes the seal and turns it once. The old man's hands do not shake, but the book under his arm does.",
                    "Sesk had names ready for the next column. Those names are ash now.",
                    "Keep the seal. I have kept enough of Kesa Volt. Let someone honest carry the weight.",
                ],
                choices: [
                    { text: "Post the ledger where the village can read it.", trait: "svr-vanta-open-ledger", conclusion: "He opens the book on the boundary stone and writes until the rain starts hitting ink." },
                    { text: "Some debts close only when someone stops collecting.", trait: "svr-vanta-clean-close", conclusion: "For once, Vanta looks less like an elder than an old man who has put down a hot coal." },
                ],
            },
        ],
    },
    {
        id: "story-reckoning-mira-marker",
        slug: "mira-marker",
        village: "Stormveil Village",
        npcName: "Mira Volt",
        levelReq: 25,
        ownProgress: 3,
        completionTrait: "svr-mira-marker-set",
        title: "Kesa's Marker",
        task: {
            kind: "collect",
            metric: "totalTilesExplored",
            target: 12,
            dropItemId: "event-kesa-marker",
            targetName: "the scattered marker pieces",
        },
        reward: { weight: 4, title: "Ridge-Walker" },
        intro: [
            {
                title: "The Watcher on the Ridge Road",
                scene: "The Stormveil outskirts, where the ridge path starts climbing",
                speaker: "Mira Volt",
                dialogue: [
                    "Mira sits on the last boundary stone with her black book closed. That is how you know she is here as herself.",
                    "My mother's ridge marker was broken up for pressed flowers. Kesa Volt, reduced to resale value one more time.",
                    "The pieces are scattered along the outskirts road. I can walk it alone. I keep not walking it alone.",
                ],
                choices: [
                    { text: "Walk the outskirts and gather every piece.", accept: true },
                    { text: "Later. I want to do this carefully.", trait: "svr-mira-weighed-it", conclusion: "Mira opens the book just enough to mark your answer. Carefully is allowed, she says." },
                ],
            },
        ],
        payoff: [
            {
                title: "The Marker, Set Again",
                scene: "The ridge gate, the marker pieces fitted back together",
                speaker: "Mira Volt",
                dialogue: [
                    "Mira fits the pieces together on the stone, slow enough that the order becomes part of the work.",
                    "Kesa Volt. Cable rigger. Storm answer. My mother before any board learned how to spend her.",
                    "One piece was extra. She always pressed too many flowers. Keep it. Someone should carry her without charging admission.",
                ],
                choices: [
                    { text: "Her line holds because people still carry it.", trait: "svr-mira-line-carried", conclusion: "Mira writes your name under Kesa's in the book, not as a debt. As a witness." },
                    { text: "Set the marker where everyone leaving sees it.", trait: "svr-mira-public-marker", conclusion: "Mira plants it at the gate, where every road out has to pass the name first." },
                ],
            },
        ],
    },
];

export function storyReckoningById(id: string): StoryReckoning | null {
    return storyReckonings.find((quest) => quest.id === id) ?? null;
}
