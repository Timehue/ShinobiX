/*
 * Admin jutsu editor mutations — create / save-edit / delete — extracted
 * verbatim from AdminPanel.tsx (line-budget drain; behavior unchanged).
 *
 * Every mutation publishes the updated jutsu list through the guarded,
 * version-checked /api/admin/content-publish endpoint (publishAuthoredContent,
 * the same path as the master Save button) BEFORE the plain scheduled save.
 * The scheduled save alone writes straight to this admin's save slot with no
 * lock and no version check — that unguarded path is how a real "Blitz" jutsu
 * was silently overwritten by an unrelated "Overload" that reused its id: a
 * stale tab won by updatedAt recency, with no conflict warning to either
 * admin. The publish endpoint version-checks, so the stale tab is told to
 * reload instead.
 */
import type { Jutsu, SavedBloodline } from "../types/combat";
import { builtInJutsuIds, rebalanceNonBloodlineJutsu } from "../data/jutsu";
import { publishSharedImage } from "../lib/shared-images";
import { jutsuPoints } from "../lib/jutsu-points";
import { gameConfirm } from "../components/GameAlert";
import { deletedJutsuEntry } from "../../../shared/admin-content-tombstone";
import type { PublishableContentField } from "../lib/content-publish";

export type AdminJutsuActionDeps = {
    jutsuImagePendingRef: { current: Promise<string> | null };
    jutsuFromForm: (id?: string) => Jutsu & { description?: string; image?: string };
    creatorJutsus: Jutsu[];
    setCreatorJutsus: (next: Jutsu[]) => void;
    savedBloodlines: SavedBloodline[];
    setSavedBloodlines: (next: SavedBloodline[]) => void;
    editingJutsuId: string;
    setEditingJutsuId: (id: string) => void;
    allGameJutsus: Jutsu[];
    publishAuthoredContent: (fields: Partial<Record<PublishableContentField, unknown>>) => Promise<void>;
    /** The other authored-content fields, republished as-is alongside the jutsu list. */
    authoredContent: Partial<Record<PublishableContentField, unknown>>;
    /** Auto-persist after React re-renders with the new state (the 150ms deferred save). */
    scheduleAutoSave: () => void;
};

export function makeAdminJutsuActions(deps: AdminJutsuActionDeps) {
    const {
        jutsuImagePendingRef, jutsuFromForm, creatorJutsus, setCreatorJutsus,
        savedBloodlines, setSavedBloodlines, editingJutsuId, setEditingJutsuId,
        allGameJutsus, publishAuthoredContent, authoredContent, scheduleAutoSave,
    } = deps;

    /** Guarded publish of the updated jutsu list; alerts and returns false on failure. */
    async function publishJutsuCatalog(nextCreatorJutsus: Jutsu[]): Promise<boolean> {
        try {
            await publishAuthoredContent({ ...authoredContent, creatorJutsus: nextCreatorJutsus });
            return true;
        } catch (err) {
            alert(err instanceof Error ? err.message : "Publish failed — reload the admin panel and retry.");
            return false;
        }
    }

    async function createAdminJutsu() {
        // If an image upload is still compressing, wait for it so we don't create
        // + publish with a half-ready (empty) image. No-op (stays synchronous) once
        // the preview has appeared, since the upload clears the pending marker.
        const readyImage = jutsuImagePendingRef.current ? await jutsuImagePendingRef.current.catch(() => "") : null;
        const newJutsu = rebalanceNonBloodlineJutsu(jutsuFromForm());
        // jutsuFromForm read the form state (stale across the await); prefer the
        // freshly-finished upload when one was in flight.
        if (readyImage) newJutsu.image = readyImage;
        if (newJutsu.image) void publishSharedImage('jutsu:' + newJutsu.id, newJutsu.image);

        const nextCreatorJutsus = [...creatorJutsus, newJutsu];
        setCreatorJutsus(nextCreatorJutsus);
        if (!(await publishJutsuCatalog(nextCreatorJutsus))) return;

        alert(`${newJutsu.name} created and imported to the game. Train it before equipping it.`);
        scheduleAutoSave();
    }

    async function saveAdminJutsuEdit() {
        if (!editingJutsuId) return alert("Load an existing admin jutsu first.");
        // Wait for an in-flight image upload (no-op once the preview has appeared)
        // so a save made mid-upload still persists the picture.
        const readyImage = jutsuImagePendingRef.current ? await jutsuImagePendingRef.current.catch(() => "") : null;
        const updatedJutsu = jutsuFromForm(editingJutsuId);
        if (readyImage) updatedJutsu.image = readyImage;
        // Skip the publish when there's no image — an empty string is rejected (400).
        if (updatedJutsu.image) void publishSharedImage('jutsu:' + updatedJutsu.id, updatedJutsu.image);
        const sourceBloodline = savedBloodlines.find((bloodline) => bloodline.jutsus.some((jutsu) => jutsu.id === editingJutsuId));
        // A BUILT-IN jutsu is defined in code (data/jutsu.ts -> the generated
        // api/pvp/_jutsu-catalog.ts) and every combat seal path reads the catalog
        // copy, never an authored one. An override here could therefore only ever
        // change the CARD, never the cast — which is exactly what it did: on
        // 2026-09-01, 61 of 101 starters advertised tags combat never used.
        // Artwork is genuinely admin-owned and was already published above, so it
        // still lands; only the combat values are refused.
        if (!sourceBloodline && builtInJutsuIds.has(editingJutsuId)) {
            alert(`${updatedJutsu.name} is a built-in jutsu, so its stats are owned by the game code and the server always fights with that version — saving them here would only change the card, not the cast.`
                + `

The image was published and will appear for players.`
                + `

To change its stats: edit shinobij.client/src/data/jutsu.ts, then regenerate api/pvp/_jutsu-catalog.ts.`);
            return;
        }
        let nextCreatorJutsus = creatorJutsus;
        if (sourceBloodline) {
            // Bloodline jutsu are per-character, not shared content — no publish.
            setSavedBloodlines(savedBloodlines.map((bloodline) => bloodline.id === sourceBloodline.id ? {
                ...bloodline,
                jutsus: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu),
                totalPoints: bloodline.jutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu).reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0),
            } : bloodline));
        } else if (creatorJutsus.some((jutsu) => jutsu.id === editingJutsuId)) {
            // Save exactly what the admin set — no rebalance override
            nextCreatorJutsus = creatorJutsus.map((jutsu) => jutsu.id === editingJutsuId ? updatedJutsu : jutsu);
            setCreatorJutsus(nextCreatorJutsus);
        } else {
            // A brand-new authored id. Built-ins were refused above, so this can
            // never manufacture an override of a code-owned jutsu.
            nextCreatorJutsus = [...creatorJutsus, updatedJutsu];
            setCreatorJutsus(nextCreatorJutsus);
        }
        if (!sourceBloodline && !(await publishJutsuCatalog(nextCreatorJutsus))) return;
        alert(`${updatedJutsu.name} saved.`);
        scheduleAutoSave();
    }

    async function deleteAdminJutsu(jutsuId: string = editingJutsuId) {
        if (!jutsuId) return alert("Load an existing admin jutsu first.");
        const label = allGameJutsus.find((jutsu) => jutsu.id === jutsuId)?.name ?? jutsuId;
        // Same reason as the edit guard: a tombstone would hide a built-in from
        // the client while every combat path kept casting it.
        if (builtInJutsuIds.has(jutsuId)) {
            return alert(`${label} is a built-in jutsu and cannot be deleted here — the server would still fight with it. Remove it from shinobij.client/src/data/jutsu.ts and regenerate api/pvp/_jutsu-catalog.ts.`);
        }
        if (!(await gameConfirm(`Permanently delete "${label}"? This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
        const sourceBloodline = savedBloodlines.find((bloodline) => bloodline.jutsus.some((jutsu) => jutsu.id === jutsuId));
        if (sourceBloodline) {
            const remaining = sourceBloodline.jutsus.filter((jutsu) => jutsu.id !== jutsuId);
            setSavedBloodlines(savedBloodlines.map((bloodline) => bloodline.id === sourceBloodline.id ? {
                ...bloodline,
                jutsus: remaining,
                totalPoints: remaining.reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0),
            } : bloodline));
        } else if (creatorJutsus.some((jutsu) => jutsu.id === jutsuId)) {
            // Replace with a tombstone rather than dropping the entry: the two
            // admin slots are UNIONED by every reader, so a plain removal is
            // resurrected by the other slot's copy and the jutsu comes back.
            const nextCreatorJutsus = [
                ...creatorJutsus.filter((jutsu) => jutsu.id !== jutsuId),
                deletedJutsuEntry(jutsuId, Date.now()) as unknown as Jutsu,
            ];
            setCreatorJutsus(nextCreatorJutsus);
            if (!(await publishJutsuCatalog(nextCreatorJutsus))) return;
        } else {
            return alert("That's a built-in starter jutsu — it can't be deleted, only overridden via Save Loaded Jutsu.");
        }
        if (jutsuId === editingJutsuId) setEditingJutsuId("");
        alert(`${label} deleted.`);
        scheduleAutoSave();
    }

    return { createAdminJutsu, saveAdminJutsuEdit, deleteAdminJutsu };
}
