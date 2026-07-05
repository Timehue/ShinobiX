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
 * Always ON: the client reports every AI win to the endpoint and grants only the
 * server-capped XP/ryo. Local storage cannot opt out of the server cap, and
 * storage-less / SSR contexts still read ON.
 */
const AI_FIGHT_SERVER_AUTH_KEY = "aiFightServerAuth.v1";

export function aiFightServerAuthEnabled(): boolean {
    return true;
}

export function setAiFightServerAuthEnabled(on: boolean): void {
    try {
        void on;
        localStorage.setItem(AI_FIGHT_SERVER_AUTH_KEY, "1");
    } catch {
        /* storage disabled — ignore */
    }
}
