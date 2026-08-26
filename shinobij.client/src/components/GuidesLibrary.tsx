import { useRef, useState } from "react";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { EmptyState } from "./ui/EmptyState";
import { Panel } from "./ui/Panel";
import { GiOpenBook, GiScrollUnfurled, GiSpyglass, GiTrail } from "./icons/LightweightGameIcons";
import { GUIDE_CATEGORIES, GUIDES, type Guide, type GuideBlock, type GuideCategory } from "../data/guides";
import fieldManualHero from "../assets/guides/field-manual.webp";
import "../styles/guides-skin.css";

type CategoryFilter = "All guides" | GuideCategory;

function searchText(guide: Guide): string {
    return `${guide.title} ${guide.tagline} ${guide.blurb} ${guide.audience} ${guide.category} ${guide.keywords}`.toLowerCase();
}

function Block({ block }: { block: GuideBlock }) {
    if (block.type === "p") return <p className="guide-p">{block.text}</p>;
    if (block.type === "h") return <h3 className="guide-subh">{block.text}</h3>;
    if (block.type === "list") return <ul className="guide-list">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
    if (block.type === "callout") return <aside className={`guide-callout ${block.tone}`}><strong>{block.label}</strong><p>{block.text}</p></aside>;
    if (block.type === "figure") return (
        <figure className="guide-figure">
            <img src={block.src} alt={block.alt} loading="lazy" decoding="async" width={1600} height={900} style={{ objectPosition: block.objectPosition }} />
            <figcaption>{block.caption}</figcaption>
        </figure>
    );
    return (
        <div className="guide-table-wrap" tabIndex={0} role="region" aria-label={block.caption}>
            <table className="guide-table">
                <caption>{block.caption}</caption>
                <thead><tr>{block.head.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => (
                    <tr key={`${rowIndex}-${row[0]}`}>{row.map((cell, cellIndex) => cellIndex
                        ? <td key={cellIndex}>{cell}</td>
                        : <th key={cellIndex} scope="row">{cell}</th>)}</tr>
                ))}</tbody>
            </table>
        </div>
    );
}

function GuideCard({ guide, open }: { guide: Guide; open: (id: string) => void }) {
    return (
        <Panel as="article" surface="steel" interactive className="guide-card">
            <div className="guide-card-media" aria-hidden="true">
                <img src={guide.hero} alt="" loading="lazy" decoding="async" width={1600} height={900} style={{ objectPosition: guide.heroPosition }} />
            </div>
            <div className="guide-card-body">
                <h3>{guide.title}</h3>
                <p>{guide.blurb}</p>
                <Button variant="ghost" size="sm" data-guide-open={guide.id} aria-label={`Read ${guide.title}`} onClick={() => open(guide.id)}>
                    Read guide <span aria-hidden="true">→</span>
                </Button>
            </div>
        </Panel>
    );
}

function GuideToc({ guide, mobile }: { guide: Guide; mobile?: boolean }) {
    const links = guide.sections.map((section, index) => (
        <button key={section.id} type="button" className="guide-toc-link" onClick={() => {
            const heading = document.getElementById(`guide-${guide.id}-${section.id}`);
            heading?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
            window.setTimeout(() => heading?.focus({ preventScroll: true }), 0);
        }}><span>{String(index + 1).padStart(2, "0")}</span>{section.heading}</button>
    ));
    if (mobile) return <details className="guide-mobile-toc"><summary><GiScrollUnfurled /> On this page</summary><nav aria-label="Guide sections">{links}</nav></details>;
    return <aside className="guide-reader-rail"><nav className="guide-toc" aria-label="Guide sections"><strong><GiScrollUnfurled /> On this page</strong>{links}</nav></aside>;
}

function GuideReader({ guide, back, exit }: { guide: Guide; back: () => void; exit: () => void }) {
    return (
        <>
            <div className="guides-reader-actions"><Button variant="ghost" size="sm" onClick={back}><GiOpenBook /> All guides</Button><CloseButton label="Close guide library" onClick={exit} /></div>
            <header className="guide-reader-header">
                <figure className="guide-reader-hero"><img src={guide.hero} alt={guide.heroAlt} decoding="async" fetchPriority="high" width={1600} height={900} style={{ objectPosition: guide.heroPosition }} /></figure>
                <div className="guide-reader-heading">
                    <div className="guide-meta"><Badge tone="spirit">{guide.category}</Badge><Badge tone="neutral">{guide.readMinutes} min · {guide.audience}</Badge></div>
                    <h1>{guide.title}</h1><p>{guide.tagline}</p>
                </div>
            </header>
            <Panel surface="spirit" className="guide-quick-take"><h2>The short version</h2><ul>{guide.quickTake.map((point) => <li key={point}>{point}</li>)}</ul></Panel>
            <GuideToc guide={guide} mobile />
            <div className="guide-reader-layout">
                <GuideToc guide={guide} />
                <article className="guide-content">{guide.sections.map((section, index) => (
                    <section key={section.id} className="guide-section" aria-labelledby={`guide-${guide.id}-${section.id}`}>
                        <small>SECTION {String(index + 1).padStart(2, "0")}</small>
                        <h2 id={`guide-${guide.id}-${section.id}`} tabIndex={-1}>{section.heading}</h2>
                        {section.blocks.map((block, blockIndex) => <Block key={`${section.id}-${blockIndex}`} block={block} />)}
                    </section>
                ))}</article>
            </div>
        </>
    );
}

export function GuidesLibrary({ onExit }: { onExit: () => void }) {
    const [openId, setOpenId] = useState("");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<CategoryFilter>("All guides");
    const root = useRef<HTMLDivElement>(null);
    const returnFocusId = useRef("");
    const guide = GUIDES.find((candidate) => candidate.id === openId);
    const needle = query.trim().toLowerCase();
    const filtered = GUIDES.filter((candidate) => (category === "All guides" || candidate.category === category) && (!needle || searchText(candidate).includes(needle)));
    const featured = !needle && category === "All guides" ? GUIDES.find((candidate) => candidate.featured) : undefined;

    function open(id: string) {
        returnFocusId.current = id;
        setOpenId(id);
        requestAnimationFrame(() => root.current?.scrollIntoView({ block: "start" }));
    }

    function back() {
        const id = returnFocusId.current;
        setOpenId("");
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-guide-open="${id}"]`)?.focus());
    }

    if (guide) return <div ref={root} className="guides-root guides-root--reading"><GuideReader guide={guide} back={back} exit={onExit} /></div>;
    return (
        <div ref={root} className="guides-root">
            <div className="guides-index-actions"><Button variant="ghost" size="sm" onClick={onExit}><GiTrail /> Return</Button></div>
            <Panel as="header" surface="steel" className="guides-masthead">
                <img src={fieldManualHero} alt="" decoding="async" fetchPriority="high" width={1600} height={900} />
                <div className="guides-masthead-copy"><small>SHINOBI JOURNEY GUIDES</small><h1>Game guides</h1><p>Clear answers for combat, progression, companions, war, and endgame.</p><Badge tone="spirit" icon={<GiOpenBook />}>{GUIDES.length} field guides</Badge></div>
            </Panel>
            <section className="guides-discovery" aria-labelledby="guides-discovery-heading">
                <div className="guides-discovery-heading"><div><small>FIND YOUR ANSWER</small><h2 id="guides-discovery-heading">What are you trying to do?</h2></div>
                    <label className="guides-search"><span className="guides-sr-only">Search guides</span><GiSpyglass /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search AP, breeding, Hollow Gate…" />{query && <CloseButton label="Clear guide search" onClick={() => setQuery("")} />}</label>
                </div>
                <div className="guides-filters" aria-label="Guide categories">{(["All guides", ...GUIDE_CATEGORIES] as CategoryFilter[]).map((name) => <Button key={name} variant={category === name ? "info" : "ghost"} size="sm" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</Button>)}</div>
            </section>
            <p className="guides-results" aria-live="polite">{needle || category !== "All guides" ? `${filtered.length} ${filtered.length === 1 ? "guide" : "guides"} found` : "Start with Your First Hour, or browse by system."}</p>
            {featured && <Panel as="section" surface="spirit" className="guide-featured">
                <img src={featured.hero} alt="" decoding="async" width={1600} height={900} style={{ objectPosition: featured.heroPosition }} />
                <div><small>START HERE</small><h2>{featured.title}</h2><p>{featured.tagline}</p><Button variant="primary" data-guide-open={featured.id} onClick={() => open(featured.id)}>Read Your First Hour <span>→</span></Button></div>
            </Panel>}
            {!filtered.length ? <EmptyState className="guides-empty" icon={<GiSpyglass />} title="No guides match that search">Try training, Warfront, Bloodline, or Weekly Boss.</EmptyState> :
                <div className="guide-groups">{GUIDE_CATEGORIES.map((name) => {
                    const group = filtered.filter((candidate) => candidate.category === name && candidate.id !== featured?.id);
                    return group.length ? <section key={name} className="guide-group"><header><h2>{name}</h2></header><div className="guides-grid">{group.map((candidate) => <GuideCard key={candidate.id} guide={candidate} open={open} />)}</div></section> : null;
                })}</div>}
        </div>
    );
}
