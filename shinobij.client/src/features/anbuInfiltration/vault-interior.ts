/*
 * Vault-interior builder — the navigable war-vault layout (pure, React-free).
 *
 * Split out of AnbuVaultRaid.tsx so the generation contract is unit-testable
 * (the raid is unwinnable if the generator ever fails to place a REACHABLE
 * vault tile at these small dims — a test pins that).
 *
 * Reuses ONLY the pure Hollow Gate primitives; strips ALL Hollow Gate content
 * (no chests/traps/battles — the Anbu is the only threat), keeps the boss tile
 * as The Vault, and stamps every room with the 'warvault' theme so the renderer
 * pulls the generated shrine:icon-theme-warvault-* tiles. The theme is NOT in
 * HOLLOW_GATE_THEMES, so a real Hollow Gate run can never roll it.
 */
import { generateHollowGateFloor } from "../../lib/hollow-gate-generate";
import type { HollowGateShrineRun } from "../../types/character";

export const VAULT_DIMS = { width: 13, height: 11 } as const;

export function buildVaultInterior(): HollowGateShrineRun {
    const run = generateHollowGateFloor(1, true, VAULT_DIMS);
    const themes: Record<number, string> = {};
    run.tiles = run.tiles.map(t => {
        if (t.roomId != null) themes[t.roomId] = "warvault";
        if (t.kind === "wall" || t.kind === "boss") return t;
        return { ...t, kind: "empty" as const };
    });
    (run as HollowGateShrineRun & { roomThemes?: Record<number, string> }).roomThemes = themes;
    return run;
}
