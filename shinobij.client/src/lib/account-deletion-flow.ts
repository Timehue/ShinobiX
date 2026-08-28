import { gameConfirm, gamePasswordPrompt } from "../components/GameAlert";
import { refreshAccountStatus } from "./account-status";
import { deleteServerAccount, DELETE_ACCOUNT_ERRORS } from "./mission-combat-claim";
import { accountKey } from "./player-accounts";

type AlertPlayer = (message: string) => void;

/**
 * Owns the destructive account-deletion ceremony. The server chooses the
 * credential path: password accounts confirm with a masked field, while
 * Google-only and guest accounts use the active session token.
 */
export async function requestAccountDeletion(
    characterName: string,
    accountName: string,
    alertPlayer: AlertPlayer = (message) => globalThis.alert(message),
): Promise<boolean> {
    const confirmed = await gameConfirm(
        `Delete "${characterName}"? This permanently removes your character and all save data. This cannot be undone.`,
        { title: "Delete Character", confirmLabel: "Delete", danger: true },
    );
    if (!confirmed) return false;

    // Refresh because a cached answer from another account must never choose
    // the credential path for a destructive action.
    const accountStatus = await refreshAccountStatus();
    if (!accountStatus || accountStatus.name !== accountKey(accountName)) {
        alertPlayer("Couldn't verify this account's sign-in method. Nothing was deleted — check your connection and try again.");
        return false;
    }

    let password = "";
    if (accountStatus.hasPassword) {
        const entered = await gamePasswordPrompt(
            `Enter your password to permanently delete "${accountName}" from the server.`,
            { title: "Confirm Deletion", confirmLabel: "Delete Forever", danger: true },
        );
        if (entered === null) return false;
        password = entered.trim();
        if (!password) {
            alertPlayer("Password required to delete this account.");
            return false;
        }
    }

    // Both records must be gone before App forgets the local session. A partial
    // failure stays retryable because the server operation is idempotent.
    const deletion = await deleteServerAccount(accountName, password);
    if ("reason" in deletion) {
        alertPlayer(DELETE_ACCOUNT_ERRORS[deletion.reason]);
        return false;
    }
    return true;
}
