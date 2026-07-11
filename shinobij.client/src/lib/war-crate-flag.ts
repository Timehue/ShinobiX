/*
 * Server-authoritative Legendary War Crate grants.
 *
 * This boundary is locked on for release. The server validates the war record
 * and writes the crate under the player-save lock. Network/server failures are
 * retried by the normal polling sweep and never fall back to a browser grant.
 */
export function warCrateServerAuthEnabled(): boolean {
    return true;
}

export function setWarCrateServerAuthEnabled(on: boolean): void {
    // Retained for compatibility with older diagnostics. The browser may no
    // longer downgrade this security boundary.
    void on;
}
