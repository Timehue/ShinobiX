import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { PetWarfrontRite } from "./components/PetWarfrontRite";
import { rawPetPool } from "./data/pet-pool";
import { balanceBuiltInPetTemplate } from "./lib/pet-balance";
import type { ArenaRole, ArenaSlot } from "./lib/pet-arena-sim";
import type { Pet } from "./types/pet";

const PARAMS = new URLSearchParams(window.location.search);
const START_SEED = Number(PARAMS.get("seed")) || 20260601;

function RiteHarness() {
    const [blue, red] = useMemo(() => {
        const riteBand = (side: "blue" | "red"): ArenaSlot[] => {
            const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
            const wanted = ["Fire", "Water", "Wind", "Earth"];
            return wanted.map((element, index) => {
                const template = rawPetPool.find((entry) => entry.element === element) ?? rawPetPool[index];
                const balanced = balanceBuiltInPetTemplate(template as Pet);
                return {
                    pet: {
                        ...balanced,
                        id: `${side}-${balanced.id}`,
                        templateId: balanced.id,
                        name: `${side === "blue" ? "Azure" : "Crimson"} ${element}`,
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
    return (
        <PetWarfrontRite
            blue={blue}
            red={red}
            seed={START_SEED}
            playbackRate={playbackRate}
            spectator={PARAMS.get("autostart") === "1"}
            onExit={() => {}}
        />
    );
}

const rootNode = document.getElementById("root")!;
const devWindow = window as typeof window & { __petVfxRoot?: ReturnType<typeof createRoot> };
const petVfxRoot = devWindow.__petVfxRoot ?? createRoot(rootNode);
devWindow.__petVfxRoot = petVfxRoot;
petVfxRoot.render(<RiteHarness />);
