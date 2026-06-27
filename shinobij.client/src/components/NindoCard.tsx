/*
 * NindoCard — read-only render of a player's Nindo (profile creed). Shown on
 * UserView (other players' profiles). Renders nothing when the player hasn't
 * written one. An optional `nindoBg` preset paints a themed banner behind the
 * creed (applied to an INNER element — the panel's own background is set with
 * !important in profile-skin.css, so an inline panel background wouldn't win).
 *
 * All text rendering goes through lib/nindo-bbcode (the safe BBCode → React
 * boundary); this component never touches raw HTML.
 */
import { renderNindo } from "../lib/nindo-bbcode";
import { nindoBgStyle } from "../lib/nindo-backgrounds";

export function NindoCard({ nindo, nindoBg, ownerName }: { nindo?: string; nindoBg?: string; ownerName?: string }) {
    const trimmed = (nindo ?? "").trim();
    const bg = nindoBgStyle(nindoBg);
    const hasBg = Object.keys(bg).length > 0;
    return (
        <section className="profile-build-panel nindo-card">
            <h2>Nindo</h2>
            {trimmed ? (
                <div
                    className="nindo-body"
                    style={hasBg ? { ...bg, padding: "14px 16px", borderRadius: 8, border: "1px solid rgba(250,204,21,.22)" } : undefined}
                >
                    {renderNindo(trimmed)}
                </div>
            ) : (
                <p className="hint">{ownerName ? `${ownerName} hasn't written a Nindo yet.` : "This player has no Nindo yet."}</p>
            )}
        </section>
    );
}
