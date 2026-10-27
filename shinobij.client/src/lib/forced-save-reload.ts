import { accountKey, loadPlayerAccounts, savePlayerAccounts } from './player-accounts';
import { readPlayerSaveSnapshot } from './save-api';

/** Owns the heartbeat reset-signal handshake; App owns installing/protecting state. */
export async function reloadSignaledSave<TPayload extends Record<string, unknown>>(options: {
    accountName: string;
    admin: boolean;
    isCurrent: () => boolean;
    protectDraft: () => void;
    applySnapshot: (snapshot: TPayload) => void;
    unwindToLogin: () => void;
    request?: typeof fetch;
    forgetAccount?: (name: string) => void;
}): Promise<void> {
    const { accountName, isCurrent } = options;
    const request = options.request ?? fetch;
    const path = `/api/save/${encodeURIComponent(accountName)}`;
    const acknowledge = () => request(`${path}?ack=1`, { method: 'POST', signal: AbortSignal.timeout(12000) });
    if (!isCurrent()) return;
    // Admin accounts retain the existing acknowledgement-only behavior.
    if (options.admin) { await acknowledge(); return; }
    const response = await request(path, { signal: AbortSignal.timeout(12000) });
    if (!isCurrent()) return;
    if (response.ok) {
        const snapshot = await readPlayerSaveSnapshot<TPayload>(await response.json(), accountName);
        if (!isCurrent()) return;
        options.protectDraft();
        options.applySnapshot(snapshot);
        if (isCurrent()) await acknowledge();
        return;
    }
    // Only an explicit missing-save verdict means the account was reset.
    // A 401, 429, or storage outage must leave both the session and signal intact.
    if (response.status !== 404 || !isCurrent()) return;
    const ack = acknowledge();
    const forget = options.forgetAccount ?? ((name: string) => {
        const key = accountKey(name);
        if (key) {
            const accounts = loadPlayerAccounts();
            delete accounts[key];
            savePlayerAccounts(accounts);
        }
    });
    forget(accountName);
    options.unwindToLogin();
    await ack;
}
