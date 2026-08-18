/*
 * P0.2c — server-authoritative Legendary War Crate grant.
 *
 * When ON, the village-war WINNER crate is granted by the server
 * (POST /api/village/claim-war-crate), which validates it against the
 * authoritative world:war record, instead of being appended client-side. The two
 * client grant sites both DEFER when this is on: Arena.winBattle's buildWin omits
 * the inline crate, and the client never grants a village-winner crate itself; the
 * crate is then claimed through the endpoint by the post-poll sweep. Release
 * builds do not expose a client-side opt-out: a failed request remains pending
 * and retries instead of minting an unverified crate locally.
 */
export function warCrateServerAuthEnabled(): boolean {
    return true;
}

export function setWarCrateServerAuthEnabled(_on: boolean): void {
    // Backward-compatible no-op for old settings screens/tests. Authority is
    // mandatory and cannot be downgraded by local storage or injected scripts.
}
