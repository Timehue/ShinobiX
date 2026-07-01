/*
 * P0.2b — server-authoritative daily SOFT-CAP for AI-fight XP/ryo.
 *
 * When ON, Arena.winBattle reports the AI win's base XP/ryo to
 * POST /api/missions/report-ai-fight and grants the SERVER-RETURNED (soft-capped)
 * amounts instead of the locally-computed base. The endpoint keeps an
 * authoritative per-UTC-day win counter (atomic incr) so a grinder can't blow
 * past the intended ~90-day progression curve: the first AI_FIGHT_SOFT_CAP_PER_DAY
 * wins pay full XP/ryo, beyond that both are multiplied down. Everything else the
 * win grants — honor seals, aura dust, territory damage, war crates, kill/raid
 * counters — is untouched (the endpoint only caps XP/ryo, the progression-speed
 * faucet, never the PvP power ceiling — see feedback_balanced_pvp_design_pillar).
 *
 * DEFAULT ON (2026-07-01) — the client reports every AI win to the endpoint and
 * grants the server-capped amounts. On any network / non-2xx / endpoint failure the
 * path falls back to the locally-computed base, so a server hiccup never costs the
 * player their reward (the per-save / per-minute save-sanitizer caps remain the
 * floor against a tampered client). Storage-less / SSR contexts read OFF (old inline
 * grant). Per-device persisted; force OFF with
 * localStorage.setItem("aiFightServerAuth.v1", "0").
 */
const AI_FIGHT_SERVER_AUTH_KEY = "aiFightServerAuth.v1";

export function aiFightServerAuthEnabled(): boolean {
    try {
        return localStorage.getItem(AI_FIGHT_SERVER_AUTH_KEY) !== "0";
    } catch {
        return false;
    }
}

export function setAiFightServerAuthEnabled(on: boolean): void {
    try {
        localStorage.setItem(AI_FIGHT_SERVER_AUTH_KEY, on ? "1" : "0");
    } catch {
        /* storage disabled — ignore */
    }
}
