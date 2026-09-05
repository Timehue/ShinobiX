/*
 * Full-server-reset admin flow — drained out of AdminPanel.tsx.
 *
 * The server deletes everything that is not on its preserve list
 * (api/admin/server-reset.ts), so the confirmation cannot be a hand-written
 * description of what a reset "does" — that copy is exactly what fell out of
 * date and let a reset leave ~795 live records behind. It is built from a dry
 * run against the real store instead: run the preview, show the counts and the
 * biggest groups on both sides, and only then destroy anything.
 */
import { PLAYER_ACCOUNTS_STORAGE, STORAGE } from "../constants/game";

/** Shape of `POST /api/admin/server-reset`, dry run or real. */
export type ResetPreview = {
    ok?: boolean;
    error?: string;
    totalKeys?: number;
    deletedCount?: number;
    preservedCount?: number;
    sessionsRevoked?: number;
    wouldDeleteByNamespace?: Record<string, number>;
    wouldPreserveByNamespace?: Record<string, number>;
};

export type ServerResetDeps = {
    adminPw: string;
    setMessage: (message: string) => void;
    onPlayersCleared: () => void;
    confirm: (message: string, options: { danger: boolean; confirmLabel: string }) => Promise<boolean>;
};

// Namespace counts → the handful of lines that fit in a confirm dialog.
const PREVIEW_ROWS = 8;

export function formatResetNamespaces(counts: Record<string, number> | undefined): string {
    const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return "  (none)";
    const shown = entries.slice(0, PREVIEW_ROWS).map(([ns, n]) => `  • ${ns} — ${n}`);
    const rest = entries.length - shown.length;
    if (rest > 0) shown.push(`  • …and ${rest} more group${rest === 1 ? "" : "s"}`);
    return shown.join("\n");
}

export function resetConfirmMessage(preview: ResetPreview): string {
    return "⚠️ FULL SERVER RESET ⚠️\n\n"
        + `${preview.deletedCount} of ${preview.totalKeys} stored records will be DELETED.\n`
        + `${preview.preservedCount} will be KEPT.\n\n`
        + `Largest groups being deleted:\n${formatResetNamespaces(preview.wouldDeleteByNamespace)}\n\n`
        + `Largest groups being kept:\n${formatResetNamespaces(preview.wouldPreserveByNamespace)}\n\n`
        + "Every player starts fresh at Level 1 and picks their village again. Kage seats, "
        + "village wars, clans, ladders, tower clears, legacy progress and passwords all reset.\n\n"
        + "KEPT: your uploaded images, admin-created content, save snapshots, moderation "
        + "records, and the protected accounts.\n\n"
        + "This CANNOT be undone. Are you absolutely sure?";
}

export function resetDoneMessage(data: ResetPreview): string {
    return `✅ Server reset complete — ${data.deletedCount ?? 0} records wiped, ${data.preservedCount ?? 0} kept`
        + `${data.sessionsRevoked ? `, ${data.sessionsRevoked} sessions revoked` : ""}.`
        + " Images, admin content and save snapshots preserved. Players start fresh on next login."
        // The ranked season goes with the old world, and the cron rollover
        // no-ops ('inactive') until one exists — so the new world has no ranked
        // ladder until someone presses Start. Easy to forget; say it here.
        + " ⚠️ Next step: start a new Ranked Season above — the reset cleared the old one.";
}

/**
 * Local caches that describe the OLD world. Cleared on a successful reset so
 * the admin's own tab doesn't keep painting a village state the server no
 * longer has. `STORAGE` (the admin session) is deliberately spared.
 */
export function clearLocalWorldCaches() {
    // Never throws. This runs AFTER the server has already been wiped, so a
    // storage failure here must not be reportable as a reset failure — an admin
    // told "network error" after a successful reset would run it again.
    try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || key === STORAGE) continue;
            if (
                key.startsWith("village-state-")
                || key.startsWith("shinobij-village-war-")
                || key.startsWith("shinobij-sector-territory-")
                || key === PLAYER_ACCOUNTS_STORAGE
            ) {
                toRemove.push(key);
            }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
    // Drop sessionStorage image-category caches so portraits re-fetch fresh
    // from the server's re-seeded shared:imgfields:misc bucket.
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key?.startsWith("imgcat:")) sessionStorage.removeItem(key);
        }
    } catch { /* storage unavailable */ }
}

async function postReset(adminPw: string, dryRun: boolean): Promise<{ res: Response; data: ResetPreview }> {
    const res = await fetch('/api/admin/server-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
        body: JSON.stringify(dryRun ? { dryRun: true } : {}),
    });
    return { res, data: await res.json().catch(() => ({})) as ResetPreview };
}

export async function runServerReset(deps: ServerResetDeps): Promise<void> {
    // Dry run FIRST — a preview failure aborts rather than confirming blind.
    deps.setMessage("⏳ Checking what a reset would delete…");
    let preview: ResetPreview;
    try {
        const { res, data } = await postReset(deps.adminPw, true);
        if (!res.ok || !data?.ok) {
            deps.setMessage(`❌ Preview failed: ${data?.error ?? `HTTP ${res.status}`} — nothing was deleted.`);
            return;
        }
        preview = data;
    } catch {
        deps.setMessage("❌ Network error during preview — nothing was deleted.");
        return;
    }

    if (!(await deps.confirm(resetConfirmMessage(preview), { danger: true, confirmLabel: "Reset server" }))) {
        deps.setMessage("");
        return;
    }

    deps.setMessage("⏳ Wiping server…");
    let result: ResetPreview;
    try {
        result = (await postReset(deps.adminPw, false)).data;
    } catch {
        deps.setMessage("❌ Network error during reset.");
        return;
    }
    // Past this point the server is already wiped. Nothing below may report a
    // failure that would invite the admin to run it a second time.
    if (!result.ok) {
        deps.setMessage(`❌ Reset failed: ${result.error ?? 'Unknown error'}`);
        return;
    }
    clearLocalWorldCaches();
    deps.onPlayersCleared();
    deps.setMessage(resetDoneMessage(result));
}
