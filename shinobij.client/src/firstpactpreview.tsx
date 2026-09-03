// DEV-ONLY visual QA harness for Celestial Tower: The First Pact. It mounts
// the production screen and its real pathfinding/NPC/dialogue code with a
// deterministic in-memory API facade; it is not a production build input.
import { createRoot } from "react-dom/client";
import "./firstpactpreview.css";
import { FirstPact } from "./screens/FirstPact";
import { STARTER_PETS } from "./data/starter-pets";
import type { Character } from "./types/character";
import previewPet10 from "../public/pet-portraits/breeding-mythics/mythic-10.webp?url";
import previewPet11 from "../public/pet-portraits/breeding-mythics/mythic-11.webp?url";
import previewPet12 from "../public/pet-portraits/breeding-mythics/mythic-12.webp?url";
import previewPet13 from "../public/pet-portraits/breeding-mythics/mythic-13.webp?url";
import previewAvatar from "../public/starter-avatar-one.webp?url";
import {
    acceptStableQuest,
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    firstPactDistrictAt,
    type FirstPactProgress,
} from "../../shared/first-pact-contract";

const previewParams = new URLSearchParams(window.location.search);
const variant = previewParams.get("state") ?? "world";
const criticCapture = previewParams.get("capture") === "critic";
// Critic-only focuses frame real world coordinates independently while each
// preview player remains on a valid production route outside the subject.
const qaCameraFocus = variant === "full-campus"
    ? { x: 42, y: 9 } as const
    : variant === "gardens-north"
        ? { x: 17, y: 10 } as const
    : variant === "aqueduct-central"
        ? { x: 29, y: 29 } as const
    : variant === "aqueduct-central-west"
        ? { x: 24, y: 29 } as const
    : variant === "gardens"
        ? { x: 18, y: 12 } as const
    : variant === "bell"
        ? { x: 68, y: 13 } as const
        : undefined;
const portraitPaths = [
    previewPet10,
    previewPet11,
    previewPet12,
    previewPet13,
];
const pets = STARTER_PETS.slice(0, 4).map(({ pet }, index) => ({
    ...pet,
    level: 100,
    maxLevel: 100,
    image: portraitPaths[index],
    unlockedForPve: true,
}));

const character = {
    name: "Aster",
    level: variant === "locked" ? 99 : 100,
    avatarImage: previewAvatar,
    activePetId: pets[0].id,
    activePetId2v2: pets[1].id,
    pets,
} as unknown as Character;

let progress: FirstPactProgress = createFirstPactProgress(1_777_000_000_000);
if (variant !== "crossing" && variant !== "locked") {
    const stableVariant = variant === "stable" || variant === "tournament";
    const pactVariant = variant === "pact" || variant === "pact-mobile";
    const finalVariant = variant === "final";
    const epilogueVariant = variant.startsWith("epilogue");
    const pactVow = variant === "epilogue-open-road"
        ? "open-road"
        : variant === "epilogue-kept-future" ? "kept-future" : "shared-reason";
    progress = {
        ...progress,
        chapter: epilogueVariant || finalVariant ? 4 : pactVariant ? 3 : 0,
        mainStep: epilogueVariant
            ? "return-to-threshold"
            : finalVariant ? "challenge-court-echo" : pactVariant ? "make-first-pact" : "meet-scribe-vey",
        courtStanding: epilogueVariant ? 2_150 : finalVariant ? 1_050 : pactVariant ? 900 : 0,
        flags: epilogueVariant
            ? ["crossed-celestial-threshold", `pact-vow-${pactVow}`, "defeated-court-echo", "stable-saved"]
            : ["crossed-celestial-threshold"],
        lastPosition: epilogueVariant
            ? { x: 42, y: 50, district: "arrival-court" }
            : pactVariant
                ? { x: 17, y: 39, district: "kennel-ward" }
                : finalVariant
                    ? { x: 42, y: 34, district: "grand-colosseum" }
            : variant === "stable"
            ? { x: 17, y: 39, district: "kennel-ward" }
            : variant === "tournament"
                ? { x: 42, y: 34, district: "grand-colosseum" }
            : variant === "market"
                ? { x: 68, y: 30, district: "market-scriptorium" }
            : variant === "gateworks"
                ? { x: 68, y: 46, district: "gateworks" }
            : variant === "gardens"
                ? { x: 17, y: 16, district: "guardian-gardens" }
            : variant === "gardens-north"
                ? { x: 17, y: 10, district: "guardian-gardens" }
            : variant === "bell"
                ? { x: 68, y: 14, district: "bell-quarter" }
            : variant === "aqueduct-central"
                ? { x: 23, y: 29, district: "kennel-ward" }
            : variant === "aqueduct-central-west"
                ? { x: 18, y: 29, district: "kennel-ward" }
            : variant === "aqueduct"
                ? { x: 32, y: 42, district: "aqueduct" }
            : { x: 42, y: 14, district: "high-court" },
        mainQuest: epilogueVariant
            ? { omens: ["bell", "aqueduct", "gardens"], battleProofs: ["court-menagerie:preview", "lattice-guardian:preview", "court-echo:preview"], pactVow }
            : finalVariant
                ? { omens: ["bell", "aqueduct", "gardens"], battleProofs: ["court-menagerie:preview", "lattice-guardian:preview"], pactVow: "shared-reason" }
            : progress.mainQuest,
        stableQuest: epilogueVariant
            ? { status: "complete", acceptedAt: 1_777_000_000_100, tournamentWins: 3, battleProofs: ["side-1", "side-2", "side-3"], completedAt: 1_777_000_000_200 }
            : stableVariant ? acceptStableQuest({
                ...progress,
                mainStep: "meet-scribe-vey",
                flags: ["crossed-celestial-threshold"],
            }).stableQuest : progress.stableQuest,
    };
}

const realFetch = window.fetch.bind(window);
let remainingPreviewStateFailures = variant === "retry" ? 1 : 0;
window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/first-pact/state")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (body.action === "state" && remainingPreviewStateFailures > 0) {
            remainingPreviewStateFailures -= 1;
            return new Response(JSON.stringify({ error: "The temporal seal lost its place." }), { status: 503, headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "enter") {
            progress = { ...progress, mainStep: "meet-scribe-vey", flags: ["crossed-celestial-threshold"] };
        } else if (body.action === "accept-stable-quest") {
            progress = acceptStableQuest(progress);
        } else if (body.action === "advance-main") {
            progress = advanceFirstPactMainBeat(progress, body.beat as never).progress;
        } else if (body.action === "checkpoint" && body.position && typeof body.position === "object") {
            const position = body.position as { x: number; y: number };
            progress = { ...progress, lastPosition: { ...position, district: firstPactDistrictAt(position) } };
        }
        return new Response(JSON.stringify({ ok: true, progress }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/pet/showdown")) {
        return new Response(JSON.stringify({ error: "The visual harness stops at the arena gate; battle presentation has its own full Showdown QA." }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
    <FirstPact
        character={character}
        sharedImages={{}}
        onExit={() => undefined}
        qaCameraFocus={qaCameraFocus}
        qaArchitectureScope={variant === "market"
            ? "market"
            : variant === "gardens-north"
                ? "gardens-north"
            : variant === "gardens"
                ? "gardens-full"
            : variant === "bell"
                ? "bell"
                : criticCapture && (variant === "world" || variant === "full-campus")
                    ? "high-court"
                    : undefined}
    />,
);
