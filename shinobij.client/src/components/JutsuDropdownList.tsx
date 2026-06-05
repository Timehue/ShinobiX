/**
 * JutsuDropdownList — filterable/sortable technique browser used by the
 * jutsu training hall, bloodline maker, and admin creator tools. Pure
 * presentational component (render-prop based); extracted verbatim from
 * App.tsx with no behavior change. getJutsuSelectOptions / specialties /
 * jutsuElements are imported back from ../App (same pattern as TagPicker).
 */
/* eslint-disable react-hooks/set-state-in-effect */ // matches App.tsx's file-wide suppression; logic moved verbatim
import { useState, useEffect, type ReactNode } from "react";
import { allTags } from "../lib/tags";
import { getJutsuSelectOptions } from "../App";
import { specialties, jutsuElements } from "../data/jutsu";
import type { Jutsu } from "../types/combat";
import type { JutsuType, JutsuElement, JutsuSort } from "../types/core";

export function JutsuDropdownList({
    jutsus,
    label,
    emptyText = "No jutsus available.",
    renderDetails,
    renderActions,
    onSelectJutsu,
}: {
    jutsus: Jutsu[];
    label: string;
    emptyText?: string;
    renderDetails: (jutsu: Jutsu) => ReactNode;
    renderActions?: (jutsu: Jutsu) => ReactNode;
    onSelectJutsu?: (jutsu: Jutsu) => void;
}) {
    const [nameFilter, setNameFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState<"All" | JutsuType>("All");
    const [elementFilter, setElementFilter] = useState<"All" | JutsuElement>("All");
    const [effectFilter, setEffectFilter] = useState("All");
    const [sortBy, setSortBy] = useState<JutsuSort>("name");
    const sortedJutsus = getJutsuSelectOptions(jutsus, typeFilter, elementFilter, sortBy)
        .filter((jutsu) => jutsu.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))
        .filter((jutsu) => effectFilter === "All" || jutsu.tags.some((tag) => tag.name === effectFilter));
    const [selectedId, setSelectedId] = useState(sortedJutsus[0]?.id ?? "");
    const selectedJutsu = sortedJutsus.find((jutsu) => jutsu.id === selectedId) ?? sortedJutsus[0];

    useEffect(() => {
        if (!selectedJutsu) {
            setSelectedId("");
            return;
        }
        if (!sortedJutsus.some((jutsu) => jutsu.id === selectedId)) setSelectedId(selectedJutsu.id);
    }, [selectedId, selectedJutsu, sortedJutsus]);

    if (jutsus.length === 0) return <div className="summary-box">{emptyText}</div>;

    return (
        <div className="jutsu-dropdown-list technique-browser">
            <div className="technique-header">
                <label>{label}</label>
                <span>{sortedJutsus.length}/{jutsus.length}</span>
            </div>
            <div className="technique-shell">
                <div className="technique-grid" role="listbox" aria-label={label}>
                    {sortedJutsus.length === 0 ? (
                        <div className="summary-box">{emptyText}</div>
                    ) : sortedJutsus.map((jutsu) => {
                        const selected = selectedJutsu?.id === jutsu.id;
                        const image = jutsu.image;
                        return (
                            <button
                                key={jutsu.id}
                                className={`technique-card ${selected ? "selected" : ""}`}
                                onClick={() => {
                                    setSelectedId(jutsu.id);
                                    onSelectJutsu?.(jutsu);
                                }}
                                type="button"
                            >
                                <span className="technique-thumb">
                                    {image ? <img src={image} alt={jutsu.name} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <strong>{jutsu.type.slice(0, 3).toUpperCase()}</strong>}
                                </span>
                                <span className="technique-name">{jutsu.name}</span>
                                <span className="technique-cost">{jutsu.ap}</span>
                            </button>
                        );
                    })}
                </div>

                <aside className="technique-filter-panel">
                    <label>Name</label>
                    <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Name" />
                    <label>Offense</label>
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "All" | JutsuType)}>
                        <option value="All">All Offenses</option>
                        {specialties.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <label>Element</label>
                    <select value={elementFilter} onChange={(e) => setElementFilter(e.target.value as "All" | JutsuElement)}>
                        <option value="All">All Elements</option>
                        {jutsuElements.map((element) => <option key={element} value={element}>{element}</option>)}
                    </select>
                    <label>Effects</label>
                    <select value={effectFilter} onChange={(e) => setEffectFilter(e.target.value)}>
                        <option value="All">All Effects</option>
                        {allTags.map((tagName) => <option key={tagName} value={tagName}>{tagName}</option>)}
                    </select>
                    <label>Sort</label>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as JutsuSort)}>
                        <option value="name">Name</option>
                        <option value="type">Offense</option>
                        <option value="element">Element</option>
                        <option value="effect">Effects</option>
                        <option value="ap">AP</option>
                        <option value="range">Range</option>
                        <option value="effectPower">Effect Power</option>
                    </select>
                    {selectedJutsu && (
                        <div className="technique-selected-panel">
                            {renderActions && <div className="menu">{renderActions(selectedJutsu)}</div>}
                            <h4>{selectedJutsu.name}</h4>
                            {renderDetails(selectedJutsu)}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
