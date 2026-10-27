import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateServerAiRules } from "../../../api/combat-core/ai-authoring.js";
import type { AiRule } from "../types/creator-ai";
import { normalizeAiProfile } from "./combat-ai";

describe("normalizeAiProfile keeps the rule fields the editor authors", () => {
    it("round-trips status / resource / pattern / state / target so the server still validates the program", () => {
        const rules: AiRule[] = [
            { id: "r1", condition: "self_status_absent", value: 0, action: "use_specific_jutsu", jutsuId: "starter-universal-flicker", status: "Absorb" },
            { id: "r2", condition: "self_resource_lower_than", value: 30, action: "heal", resource: "chakra" },
            { id: "r3", condition: "player_recent_action", value: 0, action: "defend", pattern: "basic_attack" },
            { id: "r4", condition: "objective_state", value: 0, action: "hold_objective", state: "open" },
            { id: "r5", condition: "always", value: 0, action: "use_basic_attack", target: "nearest" },
        ];
        const normalized = normalizeAiProfile({ id: "ai-x", jutsuIds: ["starter-universal-flicker"], rules });
        assert.deepEqual(
            normalized.rules.map(({ status, resource, pattern, state, target }) => ({ status, resource, pattern, state, target })),
            rules.map(({ status, resource, pattern, state, target }) => ({ status, resource, pattern, state, target })),
        );
        const verdict = validateServerAiRules(normalized.rules, normalized.jutsuIds);
        assert.equal(verdict.ok, true, JSON.stringify(verdict.issues));
    });
});
