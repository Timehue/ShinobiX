import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { EmptyState } from "./ui/EmptyState";
import { Panel } from "./ui/Panel";
import {
    GiCompass,
    GiOpenBook,
    GiSandsOfTime,
    GiScrollUnfurled,
    GiSpyglass,
    GiTrail,
} from "./icons/LightweightGameIcons";
import {
    GUIDE_CATEGORIES,
    parseGuideCatalog,
    type Guide as CatalogGuide,
    type GuideAssetId,
    type GuideBlock as CatalogGuideBlock,
    type GuideCategory,
} from "../data/guide-schema";
import guideCatalogUrl from "../data/guides-content.json?url";
import fieldManualHero from "../assets/guides/field-manual.webp";
import combatHero from "../assets/guides/combat-tactics.webp";
import companionHero from "../assets/guides/companion-squad.webp";
import worldHero from "../assets/guides/living-world.webp";
import missionHallHero from "../assets/facilities/mission-hall.webp";
import forgeHero from "../assets/central/crafter-forge-v1.webp";
import townHallHero from "../assets/town-hall/town-hall-command-center.webp";
import worldMapFigure from "../assets/Maps/world_map.webp";
import chronicleHero from "../assets/card-clash/board.webp";
import professionsHero from "../assets/professions/overview.webp";
import towersHero from "../assets/towers/battle-towers-key-art-v1.webp";
import gameHero from "../assets/background-image.webp";
import "../styles/guides-skin.css";

const DISCORD_URL = "https://discord.gg/bCQGs8r6SK";
const GUIDE_ASSETS = {
    fieldManual: fieldManualHero,
    combat: combatHero,
    companion: companionHero,
    world: worldHero,
    missionHall: missionHallHero,
    forge: forgeHero,
    townHall: townHallHero,
    worldMap: worldMapFigure,
    chronicle: chronicleHero,
    professions: professionsHero,
    towers: towersHero,
    game: gameHero,
} satisfies Record<GuideAssetId, string>;
type GuideBlock = Exclude<CatalogGuideBlock, { type: "figure" }>
    | (Omit<Extract<CatalogGuideBlock, { type: "figure" }>, "src"> & { src: string });
type GuideSection = Omit<CatalogGuide["sections"][number], "blocks"> & { blocks: GuideBlock[] };
type Guide = Omit<CatalogGuide, "hero" | "sections"> & { hero: string; sections: GuideSection[] };
const EMPTY_GUIDES: Guide[] = [];
type CategoryFilter = "All guides" | GuideCategory;

let catalogRequest: Promise<Guide[]> | undefined;

function resolveGuideAsset(assetId: GuideAssetId): string {
    return GUIDE_ASSETS[assetId];
}

function prepareGuide(guide: CatalogGuide): Guide {
    return {
        ...guide,
        hero: resolveGuideAsset(guide.hero),
        sections: guide.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) => block.type === "figure"
                ? { ...block, src: resolveGuideAsset(block.src) }
                : block),
        })),
    };
}

function loadGuideCatalog(): Promise<Guide[]> {
    if (!catalogRequest) {
        catalogRequest = fetch(guideCatalogUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`Guide catalog request failed: ${response.status}`);
                return response.json() as Promise<unknown>;
            })
            .then(parseGuideCatalog)
            .then((guides) => guides.map(prepareGuide))
            .catch((error: unknown) => {
                catalogRequest = undefined;
                throw error;
            });
    }
    return catalogRequest;
}

// Screen preloading imports this module before the library opens, so begin the
// small catalog request at the same time as the component chunk.
void loadGuideCatalog().catch(() => undefined);

function textForBlock(block: GuideBlock): string {
    switch (block.type) {
        case "p":
        case "h":
            return block.text;
        case "list":
            return block.items.join(" ");
        case "table":
            return `${block.caption} ${block.head.join(" ")} ${block.rows.flat().join(" ")}`;
        case "callout":
            return `${block.label} ${block.text}`;
        case "figure":
            return `${block.alt} ${block.caption}`;
    }
}

function searchableText(guide: Guide): string {
    return [
        guide.title,
        guide.tagline,
        guide.blurb,
        guide.audience,
        guide.category,
        ...guide.keywords,
        ...guide.sections.flatMap((section) => [
            section.heading,
            ...section.blocks.map(textForBlock),
        ]),
    ].join(" ").toLocaleLowerCase();
}

function Block({ block }: { block: GuideBlock }) {
    switch (block.type) {
        case "p":
            return <p className="guide-p">{block.text}</p>;
        case "h":
            return <h3 className="guide-subh">{block.text}</h3>;
        case "list":
            return (
                <ul className="guide-list">
                    {block.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
            );
        case "table":
            return (
                <div className="guide-table-wrap" tabIndex={0} role="region" aria-label={block.caption}>
                    <table className="guide-table">
                        <caption>{block.caption}</caption>
                        <thead>
                            <tr>{block.head.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, rowIndex) => (
                                <tr key={`${rowIndex}-${row[0]}`}>
                                    {row.map((cell, cellIndex) => cellIndex === 0
                                        ? <th key={cellIndex} scope="row">{cell}</th>
                                        : <td key={cellIndex}>{cell}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case "callout":
            return (
                <aside className={`guide-callout guide-callout--${block.tone}`}>
                    <span className="guide-callout-label">{block.label}</span>
                    <p>{block.text}</p>
                </aside>
            );
        case "figure":
            return (
                <figure className="guide-figure">
                    <img
                        src={block.src}
                        alt={block.alt}
                        loading="lazy"
                        decoding="async"
                        width={1600}
                        height={900}
                        style={{ objectPosition: block.objectPosition }}
                    />
                    <figcaption>{block.caption}</figcaption>
                </figure>
            );
    }
}

function GuideMeta({ guide }: { guide: Guide }) {
    return (
        <div className="guide-meta" aria-label="Guide details">
            <Badge tone="spirit">{guide.category}</Badge>
            <Badge tone="neutral" icon={<GiSandsOfTime />}>{guide.readMinutes} min read</Badge>
            <Badge tone="neutral">{guide.audience}</Badge>
            <Badge tone="neutral">Reviewed {guide.reviewedAt}</Badge>
        </div>
    );
}

function GuideCard({ guide, onOpen }: { guide: Guide; onOpen: (id: string) => void }) {
    return (
        <Panel as="article" surface="steel" interactive className="guide-card">
            <div className="guide-card-media" aria-hidden="true">
                <img
                    src={guide.hero}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={1600}
                    height={900}
                    style={{ objectPosition: guide.heroPosition }}
                />
                <span>{guide.category}</span>
            </div>
            <div className="guide-card-body">
                <div className="guide-card-kicker">
                    <span>{guide.audience}</span>
                    <span>{guide.readMinutes} min</span>
                </div>
                <h3>{guide.title}</h3>
                <p>{guide.blurb}</p>
                <Button
                    variant="ghost"
                    size="sm"
                    className="guide-card-action"
                    data-guide-open={guide.id}
                    aria-label={`Read ${guide.title}`}
                    onClick={() => onOpen(guide.id)}
                >
                    Read guide <span aria-hidden="true">→</span>
                </Button>
            </div>
        </Panel>
    );
}

function GuideToc({ guide, mobile = false }: { guide: Guide; mobile?: boolean }) {
    function jumpTo(sectionId: string) {
        const heading = document.getElementById(`guide-${guide.id}-${sectionId}`);
        if (!heading) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        window.setTimeout(() => heading.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
    }

    const links = guide.sections.map((section, index) => (
        <button key={section.id} type="button" className="guide-toc-link" onClick={() => jumpTo(section.id)}>
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            {section.heading}
        </button>
    ));

    if (mobile) {
        return (
            <details className="guide-mobile-toc">
                <summary><GiScrollUnfurled aria-hidden="true" /> On this page</summary>
                <nav aria-label="Guide sections">{links}</nav>
            </details>
        );
    }

    return (
        <aside className="guide-reader-rail">
            <nav className="guide-toc" aria-label="Guide sections">
                <p><GiScrollUnfurled aria-hidden="true" /> On this page</p>
                {links}
            </nav>
        </aside>
    );
}

function GuideReader({ guide, guides, onBack, onExit, onOpen }: {
    guide: Guide;
    guides: Guide[];
    onBack: () => void;
    onExit: () => void;
    onOpen: (id: string) => void;
}) {
    const related = guide.relatedGuideIds
        .map((id) => guides.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is Guide => Boolean(candidate));

    return (
        <>
            <div className="guides-reader-actions">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <GiOpenBook aria-hidden="true" /> All guides
                </Button>
                <CloseButton label="Close guide library" onClick={onExit} />
            </div>

            <header className="guide-reader-header">
                <figure className="guide-reader-hero">
                    <img
                        src={guide.hero}
                        alt={guide.heroAlt}
                        decoding="async"
                        fetchPriority="high"
                        width={1600}
                        height={900}
                        style={{ objectPosition: guide.heroPosition }}
                    />
                </figure>
                <div className="guide-reader-heading">
                    <GuideMeta guide={guide} />
                    <h1 tabIndex={-1}>{guide.title}</h1>
                    <p>{guide.tagline}</p>
                </div>
            </header>

            <Panel surface="spirit" className="guide-quick-take" aria-labelledby="guide-quick-take-heading">
                <div>
                    <GiCompass aria-hidden="true" />
                    <h2 id="guide-quick-take-heading">The short version</h2>
                </div>
                <ul>{guide.quickTake.map((point) => <li key={point}>{point}</li>)}</ul>
            </Panel>

            <GuideToc guide={guide} mobile />

            <div className="guide-reader-layout">
                <GuideToc guide={guide} />
                <article className="guide-content">
                    {guide.sections.map((section, index) => (
                        <section key={section.id} className="guide-section" aria-labelledby={`guide-${guide.id}-${section.id}`}>
                            <p className="guide-section-number" aria-hidden="true">SECTION {String(index + 1).padStart(2, "0")}</p>
                            <h2 id={`guide-${guide.id}-${section.id}`} tabIndex={-1}>{section.heading}</h2>
                            {section.blocks.map((block, blockIndex) => (
                                <Block key={`${section.id}-${blockIndex}`} block={block} />
                            ))}
                        </section>
                    ))}
                </article>
            </div>

            <section className="guide-related" aria-labelledby="guide-related-heading">
                <div className="guide-related-heading">
                    <p>CONTINUE LEARNING</p>
                    <h2 id="guide-related-heading">Related guides</h2>
                </div>
                <div className="guide-related-grid">
                    {related.map((candidate) => (
                        <Panel key={candidate.id} surface="steel" className="guide-related-card">
                            <span>{candidate.category}</span>
                            <h3>{candidate.title}</h3>
                            <p>{candidate.blurb}</p>
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Continue to ${candidate.title}`}
                                onClick={() => onOpen(candidate.id)}
                            >
                                Continue <span aria-hidden="true">→</span>
                            </Button>
                        </Panel>
                    ))}
                </div>
            </section>

            <footer className="guide-reader-footer">
                <Button variant="ghost" size="sm" onClick={onBack}><GiOpenBook aria-hidden="true" /> All guides</Button>
                <p>Reviewed {guide.reviewedAt}. If a number differs from the current interface, use the value shown in game.</p>
            </footer>
        </>
    );
}

export function GuidesLibrary({ onExit }: { onExit: () => void }) {
    const [guides, setGuides] = useState<Guide[] | null>(null);
    const [catalogError, setCatalogError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [openId, setOpenId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<CategoryFilter>("All guides");
    const rootRef = useRef<HTMLDivElement>(null);
    const returnFocusId = useRef<string | null>(null);
    const catalog = guides ?? EMPTY_GUIDES;
    const guide = openId ? catalog.find((candidate) => candidate.id === openId) ?? null : null;

    const filteredGuides = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return catalog.filter((candidate) => {
            const inCategory = category === "All guides" || candidate.category === category;
            return inCategory && (!normalizedQuery || searchableText(candidate).includes(normalizedQuery));
        });
    }, [catalog, category, query]);

    const groupedGuides = useMemo(() => GUIDE_CATEGORIES
        .map((name) => ({ name, guides: filteredGuides.filter((candidate) => candidate.category === name) }))
        .filter((group) => group.guides.length > 0), [filteredGuides]);

    const showFeatured = !query.trim() && category === "All guides";
    const featured = showFeatured ? catalog.find((candidate) => candidate.featured) ?? null : null;

    useEffect(() => {
        let active = true;
        loadGuideCatalog().then(
            (loadedGuides) => {
                if (active) setGuides(loadedGuides);
            },
            () => {
                if (active) setCatalogError(true);
            },
        );
        return () => {
            active = false;
        };
    }, [loadAttempt]);

    useEffect(() => {
        if (!openId) return;
        const frame = window.requestAnimationFrame(() => {
            const root = rootRef.current;
            root?.scrollIntoView({ block: "start" });
            root?.querySelector<HTMLHeadingElement>(".guide-reader-heading h1")?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [openId]);

    function openGuide(id: string) {
        // Keep the archive card that launched the reader as the return target.
        // Related-guide links may point outside the active archive filters.
        if (!openId) returnFocusId.current = id;
        setOpenId(id);
    }

    function returnToLibrary() {
        const focusId = returnFocusId.current;
        setOpenId(null);
        window.requestAnimationFrame(() => {
            if (!focusId) return;
            document.querySelector<HTMLButtonElement>(`[data-guide-open="${focusId}"]`)?.focus();
        });
    }

    if (!guides) {
        return (
            <div ref={rootRef} className="guides-root">
                <div className="guides-index-actions">
                    <Button variant="ghost" size="sm" onClick={onExit}><GiTrail aria-hidden="true" /> Return</Button>
                </div>
                <EmptyState
                    className="guides-empty"
                    icon={<GiOpenBook />}
                    title={catalogError ? "The guide library did not load" : "Opening the guide library"}
                >
                    {catalogError ? (
                        <span className="guide-load-error">
                            <span>Please check your connection and try again.</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setCatalogError(false);
                                    setLoadAttempt((attempt) => attempt + 1);
                                }}
                            >
                                Try again
                            </Button>
                        </span>
                    ) : "Loading the latest field notes…"}
                </EmptyState>
            </div>
        );
    }

    return (
        <div ref={rootRef} className={`guides-root${guide ? " guides-root--reading" : ""}`}>
            {guide ? (
                <GuideReader guide={guide} guides={catalog} onBack={returnToLibrary} onExit={onExit} onOpen={openGuide} />
            ) : (
                <>
                    <div className="guides-index-actions">
                        <Button variant="ghost" size="sm" onClick={onExit}><GiTrail aria-hidden="true" /> Return</Button>
                    </div>

                    <Panel as="header" surface="steel" className="guides-masthead">
                        <img src={fieldManualHero} alt="" decoding="async" fetchPriority="high" width={1600} height={900} />
                        <div className="guides-masthead-shade" />
                        <div className="guides-masthead-copy">
                            <p>SHINOBI JOURNEY GUIDES</p>
                            <h1>Game guides</h1>
                            <p className="guides-intro">Clear explanations of the Academy, combat, progression, companions, war, and endgame systems.</p>
                            <div>
                                <Badge tone="spirit" icon={<GiOpenBook />}>{catalog.length} field guides</Badge>
                                <Badge tone="neutral">Reviewed August 2026</Badge>
                            </div>
                        </div>
                    </Panel>

                    <section className="guides-discovery" aria-labelledby="guides-discovery-heading">
                        <div className="guides-discovery-heading">
                            <div>
                                <p>FIND YOUR ANSWER</p>
                                <h2 id="guides-discovery-heading">What are you trying to do?</h2>
                            </div>
                            <label className="guides-search">
                                <span className="guides-sr-only">Search guides</span>
                                <GiSpyglass aria-hidden="true" />
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search AP, breeding, Hollow Gate…"
                                />
                                {query ? <CloseButton label="Clear guide search" onClick={() => setQuery("")} /> : null}
                            </label>
                        </div>

                        <div className="guides-filters" aria-label="Guide categories">
                            {(["All guides", ...GUIDE_CATEGORIES] as CategoryFilter[]).map((name) => {
                                const count = name === "All guides"
                                    ? catalog.length
                                    : catalog.filter((candidate) => candidate.category === name).length;
                                return (
                                    <Button
                                        key={name}
                                        variant={category === name ? "info" : "ghost"}
                                        size="sm"
                                        className="guide-filter"
                                        aria-pressed={category === name}
                                        onClick={() => setCategory(name)}
                                    >
                                        {name} <span>{count}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </section>

                    <p className="guides-results" aria-live="polite">
                        {query.trim() || category !== "All guides"
                            ? `${filteredGuides.length} ${filteredGuides.length === 1 ? "guide" : "guides"} found`
                            : "Start with Your First Hour, or browse by system."}
                    </p>

                    {featured ? (
                        <Panel as="section" surface="spirit" className="guide-featured" aria-labelledby="guide-featured-title">
                            <div className="guide-featured-media" aria-hidden="true">
                                <img src={featured.hero} alt="" decoding="async" width={1600} height={900} style={{ objectPosition: featured.heroPosition }} />
                            </div>
                            <div className="guide-featured-copy">
                                <p>START HERE</p>
                                <h2 id="guide-featured-title">{featured.title}</h2>
                                <p>{featured.tagline}</p>
                                <div className="guide-featured-meta">
                                    <span>{featured.readMinutes} min read</span>
                                    <span>{featured.audience}</span>
                                </div>
                                <Button variant="primary" data-guide-open={featured.id} onClick={() => openGuide(featured.id)}>
                                    Read Your First Hour <span aria-hidden="true">→</span>
                                </Button>
                            </div>
                        </Panel>
                    ) : null}

                    {filteredGuides.length === 0 ? (
                        <EmptyState
                            className="guides-empty"
                            icon={<GiSpyglass />}
                            title="No guides match that search"
                        >
                            Try a system name such as training, Warfront, Bloodline, or Weekly Boss.
                        </EmptyState>
                    ) : (
                        <div className="guide-groups">
                            {groupedGuides.map((group) => {
                                const guides = featured
                                    ? group.guides.filter((candidate) => candidate.id !== featured.id)
                                    : group.guides;
                                if (guides.length === 0) return null;
                                return (
                                    <section key={group.name} className="guide-group" aria-labelledby={`guide-group-${group.name.replaceAll(" ", "-").toLowerCase()}`}>
                                        <div className="guide-group-heading">
                                            <h2 id={`guide-group-${group.name.replaceAll(" ", "-").toLowerCase()}`}>{group.name}</h2>
                                            <span>{guides.length} {guides.length === 1 ? "guide" : "guides"}</span>
                                        </div>
                                        <div className="guides-grid">
                                            {guides.map((candidate) => <GuideCard key={candidate.id} guide={candidate} onOpen={openGuide} />)}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}

                    <footer className="guides-community">
                        <GiOpenBook aria-hidden="true" />
                        <div>
                            <h2>Still need help?</h2>
                            <p>Include the exact screen, your rank, and what you already tried so other players have enough context to help.</p>
                        </div>
                        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Join the Discord <span aria-hidden="true">↗</span></a>
                    </footer>
                </>
            )}
        </div>
    );
}
