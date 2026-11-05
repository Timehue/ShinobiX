import { SAVE_REFRESH_REQUIRED, SAVE_REFRESH_REQUIRED_MESSAGE, type SaveBlockedState } from "../lib/save-persistence";

// Fixed top banner shown when the client's save POST is persistently rejected
// (a 413 payload-too-large or a sustained 5xx/network streak). persistSave in
// App.tsx otherwise retries silently forever, so without this the player has no
// idea their progress isn't being stored until they refresh and lose it. Audit
// 2026-06-26 finding #23. Purely informational — no actions, no state of its own.
//
// For those failures the copy must NOT suggest refreshing: while this banner is
// up the unsaved state lives only in this tab, so a refresh is precisely what
// destroys it. Saving retries on its own, so the right advice is "keep the tab
// open".
//
// The one exception is SAVE_REFRESH_REQUIRED (a 426): the server will never
// accept a save from this build again, so autosave has stopped and only a
// refresh lets the player keep saving. That mode says so.
//
// The glyph is GameArtIcon's "warning" art, referenced by its public small copy
// rather than by importing GameArtIcon: this banner is on the boot graph, and
// that module would bring its whole art table with it.
export function SaveErrorBanner({ visible }: { visible: SaveBlockedState }) {
    if (!visible) return null;
    return (
        <div
            role="alert"
            style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 100001,
                background: "var(--sj-seal, #a83e45)", color: "#fff", padding: "8px 14px",
                textAlign: "center", fontSize: 13, fontWeight: 600,
            }}
        >
            <img src="/ui/icon-96/warning.webp" alt="" aria-hidden="true" width={16} height={16} decoding="async" style={{ width: 16, height: 16, objectFit: "contain", verticalAlign: "middle", marginRight: 6 }} />{visible === SAVE_REFRESH_REQUIRED
                ? `Couldn't save your progress. ${SAVE_REFRESH_REQUIRED_MESSAGE}`
                : <>Couldn't save your progress — recent changes are only in this tab. Check your connection and keep playing; saving retries automatically. Do <strong>not</strong> refresh or close the tab until this clears, or those changes are lost.</>}
        </div>
    );
}
