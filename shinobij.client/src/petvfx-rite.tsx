import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PetWarfrontRite } from "./components/PetWarfrontRite";
import { rawPetPool } from "./data/pet-pool";
import { balanceBuiltInPetTemplate } from "./lib/pet-balance";
import type { ArenaRole, ArenaSlot } from "./lib/pet-arena-sim";
import { WARFRONT_DEPLOYMENT_NODES, aiRitePlan, runWarfrontRite, type RitePlan, type RiteResult } from "./lib/pet-warfront-rite";
import type { Pet } from "./types/pet";

const PARAMS = new URLSearchParams(window.location.search);
const START_SEED = Number(PARAMS.get("seed")) || 20260601;
const QA = PARAMS.get("riteqa") === "1";

/** The verdict line the result screen prints, so QA can compare text exactly. */
const resultLine = (result: RiteResult) =>
    `Clashes ${result.blueRounds}–${result.redRounds} · ${result.clashes.length} fought · ${Math.round(result.totalSeconds)}s`;

type HarnessSettlement = {
    reports: number;
    resultLine: string;
    reforms: number;
    authorityResultLine: string;
};

function RiteHarness() {
    const [mounted, setMounted] = useState(true);
    const [matchKey, setMatchKey] = useState(0);
    const [settlement, setSettlement] = useState<HarnessSettlement | null>(null);
    const [blue, red] = useMemo(() => {
        const riteBand = (side: "blue" | "red"): ArenaSlot[] => {
            const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
            const wanted = ["Fire", "Water", "Wind", "Earth"];
            return wanted.map((element, index) => {
                const template = (PARAMS.get("riteqa") === "1" && element === "Wind" && PARAMS.get("avian") === "1"
                    ? rawPetPool.find((entry) => entry.name === "Tempest Hawk") : null)
                    ?? rawPetPool.find((entry) => entry.element === element) ?? rawPetPool[index];
                const balanced = balanceBuiltInPetTemplate(template as Pet);
                return {
                    pet: {
                        ...balanced,
                        id: `${side}-${balanced.id}`,
                        templateId: PARAMS.get("riteqa") === "1" && PARAMS.get("ritemissingmodelqa") === "1" ? "missing-warfront-model" : balanced.id,
                        name: PARAMS.get("avian") === "1" && element === "Wind" ? template.name : `${side === "blue" ? "Azure" : "Crimson"} ${element}`,
                    } as Pet,
                    role: roles[index],
                };
            });
        };
        return [riteBand("blue"), riteBand("red")];
    }, []);
    const requestedRate = Number(PARAMS.get("ritespeed")) || 0.78;
    const playbackRate = PARAMS.get("riteqa") === "1"
        ? Math.max(0.1, Math.min(30, requestedRate))
        : Math.max(0.55, Math.min(0.9, requestedRate));
    const spectator = PARAMS.get("autostart") === "1";
    // QA stand-in for a ranked ladder replay: both plans arrive sealed, and the
    // blue one carries a recorded re-form after the opening clash.
    const sealedReplay = useMemo(() => {
        if (!QA || !spectator || PARAMS.get("sealedreplay") !== "1") return undefined;
        const bluePlan = aiRitePlan(blue.map((slot) => slot.pet), START_SEED);
        const open = WARFRONT_DEPLOYMENT_NODES.findIndex((_, node) => !bluePlan.deployment?.includes(node));
        const moved = [...(bluePlan.deployment ?? [])];
        moved[0] = open;
        return {
            bluePlan: { ...bluePlan, reforms: [{ afterClash: 0, formation: [...bluePlan.formation], deployment: moved }] } satisfies RitePlan,
            redPlan: aiRitePlan(red.map((slot) => slot.pet), START_SEED),
        };
    }, [blue, red, spectator]);
    // What a viewer who plays the whole match reaches: a shared spectator seat
    // is the engine's automatic seat, and a sealed replay is its sealed plans.
    const expectedResultLine = useMemo(() => QA && spectator
        ? resultLine(runWarfrontRite(blue.map((slot) => slot.pet), red.map((slot) => slot.pet), START_SEED, sealedReplay?.bluePlan, sealedReplay?.redPlan))
        : "", [blue, red, sealedReplay, spectator]);
    // A stand-in for the Warfront authority: each report is replayed from the
    // sealed bands and seed under the REPORTED plan, the way battle-result pays.
    const handleResult = useCallback((result: RiteResult, plan: RitePlan) => {
        const authority = runWarfrontRite(blue.map((slot) => slot.pet), red.map((slot) => slot.pet), START_SEED, plan);
        setSettlement((previous) => ({
            reports: (previous?.reports ?? 0) + 1,
            resultLine: resultLine(result),
            reforms: plan.reforms?.length ?? 0,
            authorityResultLine: resultLine(authority),
        }));
    }, [blue, red]);
    if (!mounted) return <button type="button" onClick={() => { setSettlement(null); setMatchKey((key) => key + 1); setMounted(true); }}>Reopen Warfront</button>;
    return (
        <>
            {QA ? (
                <output
                    hidden
                    data-testid="rite-harness-settlement"
                    data-reports={settlement?.reports ?? 0}
                    data-result-line={settlement?.resultLine ?? ""}
                    data-reforms={settlement?.reforms ?? 0}
                    data-authority-result-line={settlement?.authorityResultLine ?? ""}
                    data-expected-result-line={expectedResultLine}
                />
            ) : null}
            <PetWarfrontRite
                key={matchKey}
                blue={blue}
                red={red}
                seed={START_SEED}
                playbackRate={playbackRate}
                spectator={spectator}
                sealedReplay={sealedReplay}
                onResult={QA ? handleResult : undefined}
                onExit={() => { if (PARAMS.get("riteqa") === "1") setMounted(false); }}
            />
        </>
    );
}

const rootNode = document.getElementById("root")!;
const devWindow = window as typeof window & { __petVfxRoot?: ReturnType<typeof createRoot> };
const petVfxRoot = devWindow.__petVfxRoot ?? createRoot(rootNode);
devWindow.__petVfxRoot = petVfxRoot;
petVfxRoot.render(<RiteHarness />);
