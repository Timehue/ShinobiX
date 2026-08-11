// DEV-ONLY contact sheet for the Showdown glyph set. Renders every icon at the
// three sizes that matter (14 / 22 / 48) over the HUD's lacquer so silhouette
// failures are visible before the glyphs are wired into the battle. Reachable
// only at /iconsheet.html in `vite dev`; not a production build input.
import { createRoot } from "react-dom/client";
import { ShowdownIcon } from "./components/icons/ShowdownIcon";
import type { ShowdownIconName } from "./components/icons/showdown-icon-names";

const NAMES: ShowdownIconName[] = [
    "elem-fire", "elem-water", "elem-wind", "elem-lightning", "elem-earth", "elem-none",
    "strike", "crush", "rend", "siphon", "pyre",
    "bind", "frost", "daze", "drag", "mark", "provoke",
    "mend", "aegis", "veil",
    "breath", "rotate", "brace", "signature", "scroll", "caret-back",
    "wax", "wane", "steadfast", "haste",
    "cursor", "fast", "sound-on", "sound-off", "flag",
    "ko-stamp", "bench", "action-lost", "veiled", "mvp", "hp", "stamina",
];

function Sheet() {
    return (
        <div style={{
            background: "linear-gradient(155deg,#2a1e10,#0b0805)", color: "#f3ead7",
            minHeight: "100vh", padding: 16, fontFamily: "Inter, system-ui, sans-serif",
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10,
        }}>
            {NAMES.map((n) => (
                <div key={n} style={{
                    border: "1px solid rgba(217,180,120,.4)", borderRadius: 8, padding: "8px 6px",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    background: "rgba(0,0,0,.35)",
                }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, color: "#f3ead7" }}>
                        <ShowdownIcon name={n} size={14} />
                        <ShowdownIcon name={n} size={22} />
                        <ShowdownIcon name={n} size={48} />
                    </div>
                    <code style={{ fontSize: 10, color: "#b9a583" }}>{n}</code>
                </div>
            ))}
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<Sheet />);
