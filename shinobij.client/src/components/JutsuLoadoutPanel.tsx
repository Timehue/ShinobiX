import { useState, type DragEvent } from "react";
import type { Character } from "../types/character";
import type { Jutsu } from "../types/combat";
import type { JutsuType } from "../types/core";
import { JutsuEffectCards } from "./JutsuEffectCards";
import { captureProductEvent } from "../lib/analytics";
import { describeJutsuEffects, jutsuDisplayAtLevel, jutsuTargetingLabel } from "../lib/jutsu-effects";
import { getJutsuMastery } from "../lib/jutsu-scaling";
import { activeJutsuLoadoutIds, isPatreonSubscriber, LOADOUT_CAP_BASE, LOADOUT_CAP_SUB } from "../lib/entitlements";
import { legacySignatureFor } from "../lib/legacy-jutsu-slot";
import { resolveLoadoutLensDiscipline } from "../lib/jutsu-loadout-lens";

type JutsuCollectionSort = "default" | "name" | "level" | "ap" | "element";

const ELEMENT_GLYPHS: Record<string, string> = {
    Fire: "火",
    Water: "水",
    Wind: "風",
    Lightning: "雷",
    Earth: "土",
    None: "術",
};

const DRAG_TYPE = "application/x-shinobij-jutsu";

function jutsuGlyph(jutsu: Jutsu) {
    return ELEMENT_GLYPHS[jutsu.element] ?? jutsu.name.slice(0, 1).toUpperCase();
}

function JutsuArtwork({ jutsu, className = "" }: { jutsu: Jutsu; className?: string }) {
    const [failedImage, setFailedImage] = useState("");
    const hasArtwork = Boolean(jutsu.image) && failedImage !== jutsu.image;
    return (
        <span className={`jutsu-workbench-art ${hasArtwork ? "has-artwork" : "is-fallback"} ${className}`} data-element={jutsu.element} aria-hidden="true">
            {hasArtwork
                ? <img src={jutsu.image} alt="" onError={() => setFailedImage(jutsu.image ?? "")} />
                : <strong>{jutsuGlyph(jutsu)}</strong>}
        </span>
    );
}

function JutsuCard({
    jutsu,
    character,
    selected,
    equipped,
    view,
    onSelect,
    onEquip,
}: {
    jutsu: Jutsu;
    character: Character;
    selected: boolean;
    equipped: boolean;
    view: "grid" | "list";
    onSelect: () => void;
    onEquip: () => void;
}) {
    const mastery = getJutsuMastery(character, jutsu.id);
    return (
        <div
            className={`jutsu-collection-card ${selected ? "is-selected" : ""} ${equipped ? "is-equipped" : ""} ${view === "list" ? "is-list" : ""}`}
        >
            <button
                type="button"
                className="jutsu-collection-select"
                aria-pressed={selected}
                onClick={onSelect}
                onDoubleClick={() => {
                    if (!equipped) onEquip();
                }}
            >
                <JutsuArtwork jutsu={jutsu} />
                <span className="jutsu-workbench-level">{mastery.level}</span>
                {equipped && <span className="jutsu-equipped-badge">Active</span>}
                <span className="jutsu-collection-copy">
                    <strong>{jutsu.name}</strong>
                    <small>{jutsu.type} · {jutsu.element}</small>
                </span>
            </button>
            <button
                type="button"
                className="jutsu-quick-equip"
                aria-label={equipped ? `${jutsu.name} is active` : `Equip ${jutsu.name}`}
                title={equipped ? "Already active" : "Equip jutsu"}
                disabled={equipped}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!equipped) onEquip();
                }}
            >{equipped ? "✓" : "+"}</button>
        </div>
    );
}

function SelectedJutsuDetails({
    jutsu,
    character,
    lensDiscipline,
    equipped,
    loadoutFull,
    onEquip,
    onUnequip,
}: {
    jutsu: Jutsu | undefined;
    character: Character;
    lensDiscipline: JutsuType;
    equipped: boolean;
    loadoutFull: boolean;
    onEquip: () => void;
    onUnequip: () => void;
}) {
    if (!jutsu) {
        return (
            <div className="jutsu-detail-empty">
                <span className="jutsu-detail-seal">術</span>
                <p>Select a jutsu<br />to view details.</p>
            </div>
        );
    }

    const mastery = getJutsuMastery(character, jutsu.id);
    const display = jutsuDisplayAtLevel(jutsu, mastery.level);
    const targeting = jutsuTargetingLabel(jutsu);

    return (
        <div className="jutsu-detail-content">
            <div className="jutsu-detail-hero">
                <JutsuArtwork jutsu={jutsu} className="jutsu-detail-art" />
                <span className="jutsu-workbench-level">{mastery.level}</span>
            </div>
            <div className="jutsu-detail-title">
                <div>
                    <small>{jutsu.type} · {jutsu.element}</small>
                    <h3>{jutsu.name}</h3>
                </div>
                <span className="jutsu-detail-ap">{jutsu.ap}<small>AP</small></span>
            </div>
            <div className="jutsu-detail-stat-grid">
                <span><small>Mastery</small><strong>{mastery.level}/50</strong></span>
                <span><small>Range</small><strong>{jutsu.range}</strong></span>
                <span><small>Power</small><strong>{display.effectPower}</strong></span>
                <span><small>Cooldown</small><strong>{jutsu.cooldown}</strong></span>
            </div>
            <p className="jutsu-detail-description">{jutsu.description}</p>
            <p className="jutsu-detail-target"><strong>{targeting.short}</strong> — {targeting.detail}</p>
            <div className="jutsu-detail-effects">
                <strong>Effects</strong>
                <p>{describeJutsuEffects(jutsu, mastery.level, lensDiscipline)}</p>
                <JutsuEffectCards jutsu={jutsu} masteryLevel={mastery.level} lensDiscipline={lensDiscipline} />
            </div>
            <button
                type="button"
                className={equipped ? "jutsu-detail-remove" : "jutsu-detail-equip"}
                disabled={!equipped && loadoutFull}
                onClick={equipped ? onUnequip : onEquip}
            >
                {equipped ? "Unequip Jutsu" : loadoutFull ? "Select an Active Slot" : "Equip Jutsu"}
            </button>
        </div>
    );
}

export function JutsuLoadoutPanel({
    character,
    learnedJutsus,
    onPlaceJutsu,
    onUnequip,
    onUnequipAll,
}: {
    character: Character;
    learnedJutsus: Jutsu[];
    onPlaceJutsu: (jutsuId: string, slotIndex?: number) => void;
    onUnequip: (jutsuId: string) => void;
    onUnequipAll: () => void;
}) {
    const [selectedId, setSelectedId] = useState(character.equippedJutsuIds[0] ?? learnedJutsus[0]?.id ?? "");
    const [nameFilter, setNameFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("All");
    const [elementFilter, setElementFilter] = useState("All");
    const [effectFilter, setEffectFilter] = useState("All");
    const [sortBy, setSortBy] = useState<JutsuCollectionSort>("default");
    const [view, setView] = useState<"grid" | "list">("grid");
    const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
    const [lensOverride, setLensOverride] = useState<JutsuType | null>(null);
    const [workspaceTab, setWorkspaceTab] = useState<"loadout" | "collection">("loadout");
    const [replacementSlot, setReplacementSlot] = useState<number | null>(null);
    const subscriber = isPatreonSubscriber(character);
    const unlockedSlots = subscriber ? LOADOUT_CAP_SUB : LOADOUT_CAP_BASE;
    const activeEquippedIds = activeJutsuLoadoutIds(character);
    const preservedCount = Math.max(0, character.equippedJutsuIds.length - unlockedSlots);
    const loadoutFull = activeEquippedIds.length >= unlockedSlots;
    const replacementSlotValid = replacementSlot !== null && replacementSlot < unlockedSlots;

    const equippedJutsus = character.equippedJutsuIds
        .map((id) => learnedJutsus.find((jutsu) => jutsu.id === id))
        .filter((jutsu): jutsu is Jutsu => Boolean(jutsu));
    const automaticLensDiscipline = resolveLoadoutLensDiscipline(
        { ...character, equippedJutsuIds: activeEquippedIds },
        learnedJutsus,
    );
    const lensDiscipline = lensOverride ?? automaticLensDiscipline;
    const selectedJutsu = learnedJutsus.find((jutsu) => jutsu.id === selectedId) ?? equippedJutsus[0] ?? learnedJutsus[0];
    const signature = legacySignatureFor(character);

    const disciplines = Array.from(new Set(learnedJutsus.map((jutsu) => jutsu.type))).sort();
    const elements = Array.from(new Set(learnedJutsus.map((jutsu) => jutsu.element))).sort();
    const effects = Array.from(new Set(learnedJutsus.flatMap((jutsu) => jutsu.tags.map((tag) => tag.name)))).sort();
    const filteredJutsus = (() => {
        const query = nameFilter.trim().toLowerCase();
        const filtered = learnedJutsus.filter((jutsu) =>
            (!query || jutsu.name.toLowerCase().includes(query))
            && (typeFilter === "All" || jutsu.type === typeFilter)
            && (elementFilter === "All" || jutsu.element === elementFilter)
            && (effectFilter === "All" || jutsu.tags.some((tag) => tag.name === effectFilter))
        );
        if (sortBy === "default") return filtered;
        return [...filtered].sort((a, b) => {
            if (sortBy === "name") return a.name.localeCompare(b.name);
            if (sortBy === "level") return getJutsuMastery(character, b.id).level - getJutsuMastery(character, a.id).level;
            if (sortBy === "ap") return b.ap - a.ap;
            return a.element.localeCompare(b.element) || a.name.localeCompare(b.name);
        });
    })();

    const dropJutsu = (event: DragEvent<HTMLElement>, slotIndex: number) => {
        event.preventDefault();
        const jutsuId = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData("text/plain");
        setDragOverSlot(null);
        if (!jutsuId) return;
        setSelectedId(jutsuId);
        onPlaceJutsu(jutsuId, slotIndex);
    };

    const placeJutsu = (jutsuId: string) => {
        onPlaceJutsu(jutsuId, loadoutFull && replacementSlotValid ? replacementSlot : undefined);
    };

    const moveActiveJutsu = (jutsuId: string, slotIndex: number) => {
        setSelectedId(jutsuId);
        setReplacementSlot(slotIndex);
        onPlaceJutsu(jutsuId, slotIndex);
    };

    return (
        <section className="profile-build-panel jutsu-workbench">
            <div className="jutsu-workbench-layout">
                <main className="jutsu-workbench-main">
                    <header className="jutsu-workbench-header">
                        <div className="jutsu-workbench-heading">
                            <h2>Jutsu Loadout</h2>
                            <strong>{activeEquippedIds.length} / {unlockedSlots} active</strong>
                        </div>
                        <button
                            type="button"
                            className="danger-button jutsu-unequip-all"
                            disabled={character.equippedJutsuIds.length === 0 || preservedCount > 0}
                            aria-describedby={preservedCount ? "jutsu-dormant-bulk-copy" : undefined}
                            onClick={onUnequipAll}
                        >Unequip All</button>
                    </header>
                    {preservedCount > 0 && (
                        <p id="jutsu-dormant-bulk-copy" className="jutsu-dormant-bulk-copy" role="status">
                            {preservedCount} dormant Supporter preference{preservedCount === 1 ? " is" : "s are"} preserved beyond your active slots. Bulk clear is unavailable because removing an active jutsu promotes the next saved preference into that open slot.
                        </p>
                    )}

                    <div className="jutsu-workbench-tabs" role="tablist" aria-label="Jutsu workspace">
                        <button
                            type="button"
                            id="jutsu-workspace-tab-loadout"
                            role="tab"
                            aria-selected={workspaceTab === "loadout"}
                            aria-controls="jutsu-workspace-loadout"
                            className={workspaceTab === "loadout" ? "is-active" : ""}
                            onClick={() => setWorkspaceTab("loadout")}
                        >
                            <span>Loadout</span>
                            <strong>{activeEquippedIds.length}/{unlockedSlots}</strong>
                        </button>
                        <button
                            type="button"
                            id="jutsu-workspace-tab-collection"
                            role="tab"
                            aria-selected={workspaceTab === "collection"}
                            aria-controls="jutsu-workspace-collection"
                            className={workspaceTab === "collection" ? "is-active" : ""}
                            onClick={() => setWorkspaceTab("collection")}
                        >
                            <span>Learned Jutsu</span>
                            <strong>{learnedJutsus.length}</strong>
                        </button>
                    </div>

                    {workspaceTab === "loadout" ? (
                    <section
                        className="jutsu-workspace-panel is-loadout"
                        id="jutsu-workspace-loadout"
                        role="tabpanel"
                        aria-labelledby="jutsu-workspace-tab-loadout"
                    >
                    <div className="jutsu-lens-row">
                        <label htmlFor="jutsu-lens-discipline">Effect preview:</label>
                        <select
                            id="jutsu-lens-discipline"
                            value={lensOverride ?? "Auto"}
                            onChange={(event) => setLensOverride(
                                event.target.value === "Auto" ? null : event.target.value as JutsuType,
                            )}
                        >
                            <option value="Auto">Auto · {automaticLensDiscipline}</option>
                            {(["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"] as JutsuType[]).map((discipline) => (
                                <option key={discipline} value={discipline}>{discipline}</option>
                            ))}
                        </select>
                        <span>Auto follows equipped 60 AP jutsu, then your highest offense. Preview only — combat uses each jutsu's actual discipline.</span>
                    </div>

                    {signature && (
                        <div className="jutsu-legacy-signature">
                            <span>◆ Legacy Signature</span>
                            <strong>{signature.name}</strong>
                            <small>Always equipped · no loadout slot</small>
                        </div>
                    )}

                    <div className="jutsu-section-heading">
                        <div>
                            <h3>Your Loadout <span className="jutsu-info-dot" title="Loadout order matches your battle action bar">i</span></h3>
                            <p id="jutsu-loadout-reorder-help">Drag equipped jutsu, or use each slot's arrow buttons, to reorder your battle action bar.</p>
                        </div>
                        <div className="jutsu-subscriber-callout">
                            <span>♛</span>
                            <div>
                                <strong>{subscriber ? "Supporter Active" : "Supporter Benefit"}</strong>
                                <small id="jutsu-supporter-slot-copy">{subscriber ? "Supporter: 15 equipped jutsu." : "Base account: 12 equipped jutsu · Supporter: 15 equipped jutsu."}</small>
                            </div>
                        </div>
                    </div>

                    <div className="jutsu-loadout-grid" aria-label="Equipped jutsu loadout" aria-describedby="jutsu-loadout-reorder-help">
                        {Array.from({ length: LOADOUT_CAP_SUB }, (_, slotIndex) => {
                            const jutsuId = character.equippedJutsuIds[slotIndex];
                            const jutsu = learnedJutsus.find((candidate) => candidate.id === jutsuId);
                            const locked = slotIndex >= unlockedSlots;
                            if (locked) {
                                return (
                                    <button
                                        type="button"
                                        className="jutsu-loadout-slot is-locked"
                                        key={slotIndex}
                                        aria-describedby="jutsu-supporter-slot-copy"
                                        onClick={() => {
                                            if (jutsu) setSelectedId(jutsu.id);
                                            captureProductEvent("locked_jutsu_slot_inspected", {
                                                screenId: "jutsu-loadout",
                                                source: "profile",
                                                contentId: `slot-${slotIndex + 1}`,
                                            });
                                        }}
                                    >
                                        <span className="jutsu-slot-number">{slotIndex + 1}</span>
                                        <span className="jutsu-lock-icon">{jutsu ? "◇" : "🔒"}</span>
                                        <strong>{jutsu?.name ?? "Supporter Slot"}</strong>
                                        <small>{jutsu ? "Preserved · inactive" : "Inspect slot limits"}</small>
                                    </button>
                                );
                            }
                            return (
                                <div
                                    className={`jutsu-loadout-slot ${jutsu ? "is-filled" : "is-open"} ${selectedJutsu?.id === jutsu?.id || replacementSlot === slotIndex ? "is-selected" : ""} ${dragOverSlot === slotIndex ? "is-drag-over" : ""}`}
                                    key={slotIndex}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        setDragOverSlot(slotIndex);
                                    }}
                                    onDragLeave={() => setDragOverSlot((current) => current === slotIndex ? null : current)}
                                    onDrop={(event) => dropJutsu(event, slotIndex)}
                                    draggable={Boolean(jutsu)}
                                    onDragStart={(event) => {
                                        if (!jutsu) return;
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData(DRAG_TYPE, jutsu.id);
                                        event.dataTransfer.setData("text/plain", jutsu.id);
                                    }}
                                >
                                    <span className="jutsu-slot-number">{slotIndex + 1}</span>
                                    {jutsu ? (
                                        <>
                                            <button type="button" className="jutsu-slot-select" onClick={() => { setSelectedId(jutsu.id); setReplacementSlot(slotIndex); }} aria-label={`Select ${jutsu.name}, replacement slot ${slotIndex + 1}`}>
                                                <JutsuArtwork jutsu={jutsu} />
                                                <span className="jutsu-workbench-level">{getJutsuMastery(character, jutsu.id).level}</span>
                                                <strong>{jutsu.name}</strong>
                                            </button>
                                            <span className="jutsu-slot-order-controls" role="group" aria-label={`Reorder ${jutsu.name}`}>
                                                <button
                                                    type="button"
                                                    disabled={slotIndex === 0}
                                                    aria-label={`Move ${jutsu.name} to slot ${slotIndex}`}
                                                    onClick={() => moveActiveJutsu(jutsu.id, slotIndex - 1)}
                                                >←</button>
                                                <button
                                                    type="button"
                                                    disabled={slotIndex >= activeEquippedIds.length - 1}
                                                    aria-label={`Move ${jutsu.name} to slot ${slotIndex + 2}`}
                                                    onClick={() => moveActiveJutsu(jutsu.id, slotIndex + 1)}
                                                >→</button>
                                            </span>
                                            <button type="button" className="jutsu-slot-remove" aria-label={`Unequip ${jutsu.name}`} onClick={() => onUnequip(jutsu.id)}>×</button>
                                        </>
                                    ) : (
                                        <span className="jutsu-open-slot" aria-label={`Open jutsu slot ${slotIndex + 1}`}>+</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    </section>
                    ) : (
                    <section
                        className="jutsu-workspace-panel is-collection"
                        id="jutsu-workspace-collection"
                        role="tabpanel"
                        aria-labelledby="jutsu-workspace-tab-collection"
                    >
                    <section className="jutsu-collection-section">
                        <div className="jutsu-collection-heading">
                            <div>
                                <h3>Learned Jutsu <span className="jutsu-info-dot" title="Only trained, currently usable jutsu are shown">i</span></h3>
                                <p>Select a jutsu to inspect it. Use + or double-click to equip.</p>
                            </div>
                            <div className="jutsu-collection-controls">
                                <label className="jutsu-search">
                                    <span>⌕</span>
                                    <input type="search" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Search jutsu..." aria-label="Search jutsu" />
                                </label>
                                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by offense">
                                    <option value="All">All Offenses</option>
                                    {disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}
                                </select>
                                <select value={elementFilter} onChange={(event) => setElementFilter(event.target.value)} aria-label="Filter by element">
                                    <option value="All">All Elements</option>
                                    {elements.map((element) => <option key={element} value={element}>{element}</option>)}
                                </select>
                                <select value={effectFilter} onChange={(event) => setEffectFilter(event.target.value)} aria-label="Filter by effect">
                                    <option value="All">All Effects</option>
                                    {effects.map((effect) => <option key={effect} value={effect}>{effect}</option>)}
                                </select>
                                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as JutsuCollectionSort)} aria-label="Sort jutsu">
                                    <option value="default">Sort: Default</option>
                                    <option value="name">Sort: Name</option>
                                    <option value="level">Sort: Mastery</option>
                                    <option value="ap">Sort: AP</option>
                                    <option value="element">Sort: Element</option>
                                </select>
                                <div className="jutsu-view-toggle" role="group" aria-label="Collection view">
                                    <button type="button" className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grid view">▦</button>
                                    <button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} title="List view">☷</button>
                                </div>
                            </div>
                        </div>

                        <div className={`jutsu-collection-grid ${view === "list" ? "is-list-view" : ""}`}>
                            {filteredJutsus.length ? filteredJutsus.map((jutsu) => (
                                <JutsuCard
                                    key={jutsu.id}
                                    jutsu={jutsu}
                                    character={character}
                                    selected={selectedJutsu?.id === jutsu.id}
                                    equipped={activeEquippedIds.includes(jutsu.id)}
                                    view={view}
                                    onSelect={() => setSelectedId(jutsu.id)}
                                    onEquip={() => {
                                        setSelectedId(jutsu.id);
                                        placeJutsu(jutsu.id);
                                    }}
                                />
                            )) : (
                                <div className="jutsu-collection-empty">No jutsu match these filters.</div>
                            )}
                        </div>
                    </section>

                    </section>
                    )}
                </main>

                <aside className="jutsu-workbench-sidebar">
                    <section className="jutsu-sidebar-section jutsu-details-section">
                        <h2>Jutsu Details</h2>
                        <SelectedJutsuDetails
                            jutsu={selectedJutsu}
                            character={character}
                            lensDiscipline={lensDiscipline}
                            equipped={Boolean(selectedJutsu && activeEquippedIds.includes(selectedJutsu.id))}
                            loadoutFull={loadoutFull && !replacementSlotValid}
                            onEquip={() => selectedJutsu && placeJutsu(selectedJutsu.id)}
                            onUnequip={() => selectedJutsu && onUnequip(selectedJutsu.id)}
                        />
                    </section>
                </aside>
            </div>
        </section>
    );
}
