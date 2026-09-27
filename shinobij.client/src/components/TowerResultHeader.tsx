import towerCitadel from "../assets/towers/stormglass-citadel.webp";

export function TowerResultHeader({ titleId, title, chapter, encounter, art = towerCitadel }: {
    titleId: string; title: string; chapter: string; encounter?: string; art?: string;
}) {
    return <header className="tower-completion-header">
        <img className="tower-completion-art" src={art} alt="" aria-hidden="true" />
        <div className="tower-completion-heading">
            <p className="tower-completion-kicker">{chapter}</p>
            <h1 id={titleId}>{title}</h1>
            {encounter && <p className="tower-completion-encounter">{encounter}</p>}
        </div>
    </header>;
}
