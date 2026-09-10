import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PET_CATALOG } from "../../api/pet/_catalog.ts";
import { createShowdownSession, resolveShowdownRound, showdownStateView } from "../../api/_pet-showdown/engine.ts";
import { chooseShowdownAiCommands } from "../../api/_pet-showdown/ai.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Build the development-only production Showdown harness into the already-created
 * production dist directory. This avoids Vite's large dev dependency scan and
 * verifies the exact optimized renderer while retaining the production model
 * subset copied by the main build.
 */
export default defineConfig({
    root: projectRoot,
    // Serve the real portraits and rigs in dev too. Production still uses the
    // curated assets already in dist (copyPublicDir stays false below).
    publicDir: "public",
    plugins: [react(), {
        name: "actual-showdown-loadouts",
        generateBundle() {
            const kits = Object.fromEntries(Object.values(PET_CATALOG).map(pet => {
                const session = createShowdownSession({ sessionId: "vfx-preview", playerName: "Review", format: "1v1", tier: "warrior", seed: 7,
                    playerPets: [{ ...pet, templateId: pet.id, level: 30 }], enemyPets: [{ ...pet, id: "enemy", templateId: pet.id, level: 30 }], enemyTeamName: "Review" });
                return [pet.id, showdownStateView(session).player[0].moves];
            }));
            this.emitFile({ type: "asset", fileName: "showdown-moves-qa.json", source: JSON.stringify(kits) });
            const templates = { fire: "standard-0", earth: "standard-2", wind: "standard-3", blizzard: "standard-1", thunder: "mythic-8" };
            const scenarios = ["guard", "protect", "dodge-melee", "dodge-ranged", "blizzard", "blizzard-dodge", "thunder", "fire", "earth", "wind", "fire-regular", "earth-regular", "wind-regular", "fire-dodge", "earth-dodge", "wind-dodge"];
            const rounds = Object.fromEntries(scenarios.map(scenario => {
                const dodge = scenario.includes("dodge");
                const element = scenario.split("-")[0];
                const signature = scenario !== "dodge-melee" && (dodge || !!templates[element] && !scenario.endsWith("regular"));
                const template = PET_CATALOG[templates[element] ?? (scenario === "dodge-melee" ? "standard-2" : scenario === "dodge-ranged" ? "mythic-8" : "standard-0")];
                const team = side => Array.from({ length: signature ? 3 : 1 }, (_, i) => ({ ...template, templateId: template.id, id: `${side}-${i}`, level: 30 }));
                const session = createShowdownSession({ sessionId: `review-${scenario}`, playerName: "Review", format: signature ? "3v3" : "1v1", tier: "warrior", seed: 12345,
                    playerPets: team("player"), enemyPets: team("enemy"), enemyTeamName: "Review", rewardEligible: false });
                for (const fighter of [...session.player, ...session.enemy]) { fighter.readiness = 10; fighter.meter = 100; }
                const actor = session.player[0], target = session.enemy[0];
                if (dodge) target.consumable = { id: "smoke", name: "Smoke", dodge: 1, mitigate: 0, thorns: 0, endure: 0, lifeline: 0, cleanse: 0 };
                const initialState = showdownStateView(session);
                const commands = session.player.map((p, i) => i ? { kind: "rest", petId: p.id }
                    : signature ? { kind: "super", petId: actor.id, targetId: target.id } : { kind: "move", petId: actor.id, moveIndex: scenario === "dodge-melee" ? 0 : 1, targetId: target.id });
                const answers = session.enemy.map((p, i) => !i && scenario === "protect"
                    ? { kind: "move", petId: p.id, moveIndex: p.moves.findIndex(m => m.kind === "protect"), targetId: p.id }
                    : { kind: !i && scenario === "guard" ? "guard" : "rest", petId: p.id });
                const events = resolveShowdownRound(session, commands, answers);
                return [scenario, { initialState, turn: { ok: true, practice: true, events, state: showdownStateView(session) } }];
            }));
            const template = PET_CATALOG["standard-0"];
            const chargeSession = createShowdownSession({ sessionId: "review-ultimate-charge", playerName: "Review", format: "1v1", tier: "warrior", seed: 12345,
                playerPets: [{ ...template, templateId: template.id, id: "player-0", level: 30 }],
                enemyPets: [{ ...template, templateId: template.id, id: "enemy-0", level: 30 }], enemyTeamName: "Review", rewardEligible: false });
            const initialState = showdownStateView(chargeSession), turns = [];
            while (!chargeSession.finished) {
                const commands = chargeSession.round < 2 ? [{ kind: "guard", petId: "player-0" }]
                    : chargeSession.round === 2 ? [{ kind: "super", petId: "player-0", targetId: "enemy-0" }] : chooseShowdownAiCommands(chargeSession, "player");
                const answers = chargeSession.round < 3 ? [{ kind: "guard", petId: "enemy-0" }] : chooseShowdownAiCommands(chargeSession, "enemy");
                const events = resolveShowdownRound(chargeSession, commands, answers);
                turns.push({ ok: true, practice: true, events, state: showdownStateView(chargeSession) });
            }
            rounds["ultimate-charge"] = { initialState, turn: turns[0], turns };
            this.emitFile({ type: "asset", fileName: "showdown-events-qa.json", source: JSON.stringify(rounds) });
        },
    }],
    build: {
        outDir: resolve(projectRoot, "dist"),
        emptyOutDir: false,
        copyPublicDir: false,
        rollupOptions: {
            input: resolve(projectRoot, "showdownpreview.html"),
        },
    },
});
