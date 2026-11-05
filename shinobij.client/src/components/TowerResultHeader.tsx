import towerCitadel from "../assets/towers/stormglass-citadel.webp";
import { artBackdropStyle } from "../lib/card-art-backdrop";
import "../styles/art-backdrop.css";

export function TowerResultHeader({ titleId, title, chapter, encounter, art = towerCitadel }: {
    titleId: string; title: string; chapter: string; encounter?: string; art?: string;
}) {
    return <header className="tower-completion-header">
        <div className="tower-completion-media art-backdrop" style={artBackdropStyle(art)}>
            <img className="tower-completion-art art-backdrop-feather" src={art} alt="" aria-hidden="true" />
        </div>
        <div className="tower-completion-heading">
            <p className="tower-completion-kicker">{chapter}</p>
            <h1 id={titleId}>{title}</h1>
            {encounter && <p className="tower-completion-encounter">{encounter}</p>}
        </div>
    </header>;
}
