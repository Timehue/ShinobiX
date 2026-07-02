/*
 * P0.2c — server-authoritative Legendary War Crate grant.
 *
 * When ON, the village-war WINNER crate is granted by the server
 * (POST /api/village/claim-war-crate), which validates it against the
 * authoritative world:war record, instead of being appended client-side. The two
 * client grant sites both DEFER when this is on: Arena.winBattle's buildWin omits
 * the inline crate, and claimPendingWarCrates skips its village-winner branch; the
 * crate is then claimed through the endpoint by the post-poll sweep
 * (claimServerVillageWarCrates), which runs AFTER the war-end state has propagated
 * server-side — so there is no war-end race, and the server's decision is
 * authoritative (a network/5xx failure falls back to a local grant so a
 * legitimately-won crate is never lost).
 *
 * DEFAULT ON (2026-07-01) — both inline grant sites defer and the crate is claimed
 * server-side via the post-poll sweep. A network / 5xx failure falls back to a local
 * grant so a legitimately-won crate is never lost; a definitive decline is respected.
 * Storage-less / SSR contexts read OFF (old inline grant). Per-device persisted;
 * force OFF with localStorage.setItem("warCrateServerAuth.v1", "0").
 */
const WAR_CRATE_SERVER_AUTH_KEY = "warCrateServerAuth.v1";

export function warCrateServerAuthEnabled(): boolean {
    try {
        return localStorage.getItem(WAR_CRATE_SERVER_AUTH_KEY) !== "0";
    } catch {
        return false;
    }
}

export function setWarCrateServerAuthEnabled(on: boolean): void {
    try {
        localStorage.setItem(WAR_CRATE_SERVER_AUTH_KEY, on ? "1" : "0");
    } catch {
        /* storage disabled — ignore */
    }
}
