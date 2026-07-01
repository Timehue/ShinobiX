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
 * DEFAULT OFF — flipping it is the activation switch. While OFF both grant sites
 * behave exactly as before (byte-identical inline grant). Per-device persisted;
 * force ON with localStorage.setItem("warCrateServerAuth.v1", "1").
 */
const WAR_CRATE_SERVER_AUTH_KEY = "warCrateServerAuth.v1";

export function warCrateServerAuthEnabled(): boolean {
    try {
        return localStorage.getItem(WAR_CRATE_SERVER_AUTH_KEY) === "1";
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
