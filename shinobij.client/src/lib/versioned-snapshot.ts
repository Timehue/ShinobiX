export type VersionedSnapshotDecision = {
    accepted: boolean;
    latestVersion: number;
};

/**
 * Decide whether a server snapshot is new enough to replace local state.
 * Legacy unversioned responses remain usable only until a real version has
 * been observed; once versioned authority exists, an older response is stale.
 */
export function acceptVersionedSnapshot(currentVersion: number, incomingVersion: unknown): VersionedSnapshotDecision {
    if (typeof incomingVersion !== "number" || !Number.isFinite(incomingVersion) || incomingVersion <= 0) {
        return { accepted: currentVersion <= 0, latestVersion: currentVersion };
    }
    if (incomingVersion < currentVersion) {
        return { accepted: false, latestVersion: currentVersion };
    }
    return { accepted: true, latestVersion: Math.max(currentVersion, incomingVersion) };
}
