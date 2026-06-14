/*
 * GuidesLibrary — the in-app guide browser. Rendered both on the start screen
 * (GUIDES button) and in-game (side-menu → Guides). Pure presentational leaf:
 * it walks the structured content in data/guides.ts (paragraphs, lists, tables,
 * callouts) and needs no character/auth, so it works pre-login and in-game alike.
 *
 * Two views: the library index (cards for each guide) and a single-guide reader
 * with a jump-to-section table of contents. `onExit` returns to wherever it was
 * opened from (start-screen main view, or the village).
 */
import { useState } from "react";
import { GUIDES, type Guide, type GuideBlock } from "../data/guides";

const DISCORD_URL = "https://discord.gg/bCQGs8r6SK";

function Block({ block }: { block: GuideBlock }) {
    switch (block.type) {
        case "p":
            return <p className="guide-p">{block.text}</p>;
        case "h":
            return <h4 className="guide-subh">{block.text}</h4>;
        case "list":
            return (
                <ul className="guide-list">
                    {block.items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
            );
        case "table":
            return (
                <div className="guide-table-wrap">
                    <table className="guide-table">
                        <thead>
                            <tr>{block.head.map((h, i) => <th key={i}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, ri) => (
                                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case "callout":
            return (
                <div className={`guide-callout ${block.tone}`}>
                    <span className="guide-callout-label">{block.label}</span>
                    <span>{block.text}</span>
                </div>
            );
    }
}

function GuideReader({ guide, onBack, onExit }: { guide: Guide; onBack: () => void; onExit: () => void }) {
    function jumpTo(i: number) {
        document.getElementById(`guide-sec-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return (
        <div className="guides-root reading">
            <div className="guides-head">
                <button className="guides-back" onClick={onBack}>← All guides</button>
                <h2 className="guides-title">{guide.icon} {guide.title}</h2>
                <button className="guides-back ghost" onClick={onExit}>✕ Close</button>
            </div>
            <p className="guide-tagline">{guide.tagline}</p>

            {guide.sections.length > 3 && (
                <nav className="guide-toc">
                    {guide.sections.map((s, i) => (
                        <button key={i} className="guide-toc-link" onClick={() => jumpTo(i)}>{s.heading}</button>
                    ))}
                </nav>
            )}

            <div className="guide-content">
                {guide.sections.map((section, i) => (
                    <section key={i} id={`guide-sec-${i}`} className="guide-section">
                        <h3 className="guide-section-h">{section.heading}</h3>
                        {section.blocks.map((b, bi) => <Block key={bi} block={b} />)}
                    </section>
                ))}
            </div>

            <div className="guides-foot-row">
                <button className="guides-back" onClick={onBack}>← All guides</button>
                <span className="guides-foot-note">Systems and values are kept current with the live game and may change as it's balanced.</span>
            </div>
        </div>
    );
}

export function GuidesLibrary({ onExit }: { onExit: () => void }) {
    const [openId, setOpenId] = useState<string | null>(null);
    const guide = openId ? GUIDES.find((g) => g.id === openId) ?? null : null;

    if (guide) {
        return <GuideReader guide={guide} onBack={() => setOpenId(null)} onExit={onExit} />;
    }

    return (
        <div className="guides-root">
            <div className="guides-head">
                <button className="guides-back" onClick={onExit}>← Back</button>
                <h2 className="guides-title">📖 Shinobi Journey — Guides</h2>
                <span className="guides-head-spacer" />
            </div>
            <p className="guides-intro">From your first day in the village to endgame war. Pick a guide.</p>

            <div className="guides-grid">
                {GUIDES.map((g) => (
                    <button key={g.id} className="guide-card" onClick={() => setOpenId(g.id)}>
                        <span className="guide-card-icon">{g.icon}</span>
                        <span className="guide-card-text">
                            <span className="guide-card-title">{g.title}</span>
                            <span className="guide-card-blurb">{g.blurb}</span>
                        </span>
                    </button>
                ))}
            </div>

            <p className="guides-foot">
                Need help or want to talk strategy?{" "}
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Join the Discord →</a>
            </p>
        </div>
    );
}
