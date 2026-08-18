/**
 * The signed-in account's own standing, as the server sees it.
 *
 * Deliberately separate from `PublicCapabilities`: that describes the world
 * ("is Clan Boss live?") and is served unauthenticated to everyone, while this
 * describes one account ("is this character still an unclaimed guest?") and
 * therefore needs credentials. Mixing them would either leak per-account state
 * onto a public endpoint or put auth on the world-state poll.
 */
export type AccountStatus = {
    /** Canonical lowercased slug of the authenticated account. */
    name: string;
    /** Still an unclaimed guest: no owner, and released after 14 idle days. */
    guest: boolean;
    /** A Google identity is linked to this account. */
    google: boolean;
    /** A password has been set on this account. */
    hasPassword: boolean;
    /**
     * The village tavern and the player-to-player message channels are shut for
     * this account.
     *
     * Computed server-side rather than derived on the client from `guest`, so
     * the UI lock and the server gate can never disagree — including when the
     * DISABLE_GUEST_SOCIAL_LOCK kill switch is thrown, which must unlock the
     * screens as well as the endpoints. Note it is NOT simply `guest`: setting a
     * password keeps the `guest` flag but lifts the lock.
     */
    socialLocked: boolean;
};

export type AccountStatusResponse = { ok: true; account: AccountStatus };
