import { saveConflictAccountKey } from "./save-conflict";
import { acceptVersionedSnapshot } from "./versioned-snapshot";

type Ref<T> = { current: T };

/** Coordinate the existing save refs as one account/session authority.
 * No second version or epoch is stored here: persistence and PvP admission
 * continue observing the same refs owned by the application.
 */
export function createSaveAuthorityScope({
    accountKey,
    latestVersion,
    payloadRevision,
    payloadIdentity,
    failureCount,
    sessionEpoch,
    createAbort,
    activeAccountKey,
    setBlocked,
    invalidateAuthority,
}: {
    accountKey: Ref<string>;
    latestVersion: Ref<number>;
    payloadRevision: Ref<number>;
    payloadIdentity: Ref<readonly unknown[] | null>;
    failureCount: Ref<number>;
    sessionEpoch: Ref<number>;
    createAbort: Ref<AbortController>;
    activeAccountKey: () => string;
    setBlocked: (blocked: boolean) => void;
    invalidateAuthority: () => void;
}) {
    function resetTo(nextAccountKey: string): void {
        createAbort.current.abort();
        createAbort.current = new AbortController();
        accountKey.current = nextAccountKey;
        latestVersion.current = 0;
        payloadRevision.current = 0;
        payloadIdentity.current = null;
        failureCount.current = 0;
        setBlocked(false);
        sessionEpoch.current += 1;
    }

    function scopeToAccount(accountName: string): number {
        const nextAccountKey = saveConflictAccountKey(accountName);
        if (accountKey.current !== nextAccountKey) resetTo(nextAccountKey);
        return sessionEpoch.current;
    }

    function reset(): void { resetTo(""); }

    function isCurrent(candidateAccountKey: string, candidateEpoch: number): boolean {
        return accountKey.current === candidateAccountKey
            && sessionEpoch.current === candidateEpoch
            && activeAccountKey() === candidateAccountKey;
    }

    function acceptExternalVersion(incomingVersion: unknown, originatingAccount: string): "accepted" | "stale" | "foreign" {
        const candidateAccountKey = saveConflictAccountKey(originatingAccount);
        if (!candidateAccountKey || candidateAccountKey !== accountKey.current || activeAccountKey() !== candidateAccountKey) return "foreign";
        const previousVersion = latestVersion.current;
        const decision = acceptVersionedSnapshot(previousVersion, incomingVersion);
        if (!decision.accepted) return "stale";
        if (decision.latestVersion > previousVersion) invalidateAuthority();
        latestVersion.current = decision.latestVersion;
        return "accepted";
    }

    function captureCreateScope(accountName: string): { signal: AbortSignal; isCurrent: () => boolean } {
        const capturedAccountKey = saveConflictAccountKey(accountName);
        const capturedEpoch = sessionEpoch.current;
        const controller = createAbort.current;
        return {
            signal: controller.signal,
            isCurrent: () => controller === createAbort.current
                && !controller.signal.aborted
                && isCurrent(capturedAccountKey, capturedEpoch),
        };
    }

    return { scopeToAccount, reset, isCurrent, acceptExternalVersion, captureCreateScope };
}
