// Fixed top banner shown when the client's save POST is persistently rejected
// (a 413 payload-too-large or a sustained 5xx/network streak). persistSave in
// App.tsx otherwise retries silently forever, so without this the player has no
// idea their progress isn't being stored until they refresh and lose it. Audit
// 2026-06-26 finding #23. Purely informational — no actions, no state of its own.
//
// The copy must NOT suggest refreshing: while this banner is up the unsaved
// state lives only in this tab, so a refresh is precisely what destroys it.
// Saving retries on its own, so the right advice is "keep the tab open".
export function SaveErrorBanner({ visible }: { visible: boolean }) {
    if (!visible) return null;
    return (
        <div
            style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 100001,
                background: "#7f1d1d", color: "#fff", padding: "8px 14px",
                textAlign: "center", fontSize: 13, fontWeight: 600,
            }}
        >
            ⚠️ Couldn't save your progress — recent changes are only in this tab. Check your connection and keep playing; saving retries automatically. Do <strong>not</strong> refresh or close the tab until this clears, or those changes are lost.
        </div>
    );
}
