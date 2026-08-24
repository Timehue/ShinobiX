// ─── Save-preview cache ───────────────────────────────────────────────────
// Lightweight per-account snapshot stored in localStorage so login can paint
// the character UI *instantly* on the next visit instead of waiting on the
// auth + save round-trip (which can be 5-15s when Supabase is cold). The
// shape mirrors a server save payload but with all base64 images stripped
// so the cache stays small (typically <50 KB per account).
//
// Source of truth is still the server: applyServerSnapshot replaces the
// preview-painted state once the real save arrives. The 30s sector guard
// added in the rubber-banding fix prevents the reconcile from rolling
// back a fresh travel.
//
// (Drained verbatim from App.tsx; storage key unchanged — lib/recovery.ts
// wipes the same prefix.)
import { accountKey } from "./player-accounts";
import { warnLocalSaveUnavailable } from "./recovery";

const SAVE_PREVIEW_STORAGE_PREFIX = "ninjav-save-preview-v1:";

function savePreviewKey(name: string) {
    return SAVE_PREVIEW_STORAGE_PREFIX + accountKey(name);
}

function stripImagesForPreview(_key: string, value: unknown) {
    return typeof value === "string" && value.startsWith("data:image") ? "" : value;
}

export function writeSavePreview(name: string, payload: unknown) {
    if (!name) return;
    try {
        localStorage.setItem(savePreviewKey(name), JSON.stringify(payload, stripImagesForPreview));
    } catch (error) {
        warnLocalSaveUnavailable(error);
        // Quota exceeded or SSR — server save is still authoritative.
    }
}

export function readSavePreview(name: string): Record<string, unknown> | null {
    if (!name) return null;
    try {
        const raw = localStorage.getItem(savePreviewKey(name));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Defense: the preview key includes the account name, but the
        // payload's character.name MUST match — otherwise something is
        // very wrong and we'd rather block than paint the wrong avatar.
        const charRecord = (parsed.character && typeof parsed.character === "object")
            ? parsed.character as Record<string, unknown>
            : null;
        if (!charRecord || accountKey(String(charRecord.name ?? "")) !== accountKey(name)) return null;
        return parsed;
    } catch {
        return null;
    }
}
