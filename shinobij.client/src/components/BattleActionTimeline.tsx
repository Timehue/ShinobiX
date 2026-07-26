/*
 * Horizontal action timeline for a durable battle record.
 *
 * Oldest on the left, newest on the right — the same direction the fight was
 * read live. Two scroll rules matter and are easy to get wrong:
 *
 *   1. Loading OLDER actions must not move what the player is looking at. New
 *      nodes are prepended, so the browser keeps scrollLeft and the content
 *      slides out from under them. We restore the offset by the width the strip
 *      grew, in a layout effect (before paint) so there is no visible jump.
 *   2. Auto-scrolling to a newly-arrived action is only correct if the player
 *      was ALREADY at the end. Yanking the strip away from someone reading
 *      round 2 is worse than making them scroll.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActionReceiptCategory, DurableActionReceipt } from "../types/battle-log";
import { actionCategory, actionLabel, BASIC_CATEGORIES } from "../types/battle-log";

export type TimelineActorFilter = "all" | "self" | "opponent";

/** Text glyph per category — the fallback when a receipt carries no image. */
const CATEGORY_GLYPH: Record<ActionReceiptCategory, string> = {
    jutsu: "✦",
    basic: "⚔",
    weapon: "🗡",
    item: "◈",
    movement: "⇢",
    turn: "⏳",
    system: "⚙",
};

/** Short category word — never rely on colour alone to convey the type. */
const CATEGORY_WORD: Record<ActionReceiptCategory, string> = {
    jutsu: "Jutsu",
    basic: "Basic",
    weapon: "Weapon",
    item: "Item",
    movement: "Move",
    turn: "Turn",
    system: "System",
};

function TimelineNode({
    entry,
    side,
    selected,
    onSelect,
}: {
    entry: DurableActionReceipt;
    side: "self" | "opponent";
    selected: boolean;
    onSelect: (seq: number) => void;
}) {
    const category = actionCategory(entry);
    const label = actionLabel(entry);
    const isTerminal = entry.result === "battle_end";
    const hpHit = entry.targetDelta?.hp;
    // Spoken form for screen readers: who, what, when, and what it did.
    const aria = [
        side === "self" ? "You" : entry.actorName || "Opponent",
        label,
        `round ${entry.round}`,
        `action ${entry.seq}`,
        typeof hpHit === "number" && hpHit < 0 ? `${Math.abs(hpHit)} damage` : "",
        isTerminal ? "battle end" : "",
    ].filter(Boolean).join(", ");

    return (
        <li className="bt-node-wrap">
            <button
                type="button"
                className={`bt-node bt-node-${side}${selected ? " bt-node-selected" : ""}${isTerminal ? " bt-node-terminal" : ""}`}
                aria-label={aria}
                aria-pressed={selected}
                onClick={() => onSelect(entry.seq)}
            >
                <span className="bt-node-art" aria-hidden="true">
                    {entry.display?.imageRef
                        ? <img src={entry.display.imageRef} alt="" loading="lazy" />
                        : <span className={`bt-node-glyph bt-cat-${category}`}>{CATEGORY_GLYPH[category]}</span>}
                </span>
                <span className="bt-node-label">{label}</span>
                <span className="bt-node-meta">
                    <span className="bt-node-round">R{entry.round}</span>
                    <span className="bt-node-cat">{CATEGORY_WORD[category]}</span>
                </span>
            </button>
        </li>
    );
}

export const BattleActionTimeline = memo(function BattleActionTimeline({
    entries,
    myRole,
    selectedSeq,
    onSelect,
    onLoadOlder,
    hasOlder,
    loadingOlder,
    actorFilter,
    onActorFilter,
    hideBasic,
    onHideBasic,
}: {
    entries: DurableActionReceipt[];
    myRole: "p1" | "p2" | null;
    selectedSeq: number | null;
    onSelect: (seq: number) => void;
    onLoadOlder?: () => void;
    hasOlder?: boolean;
    loadingOlder?: boolean;
    actorFilter: TimelineActorFilter;
    onActorFilter: (f: TimelineActorFilter) => void;
    hideBasic: boolean;
    onHideBasic: (v: boolean) => void;
}) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    // Snapshot taken before a prepend so the restore can measure the growth.
    const prependAnchor = useRef<{ scrollWidth: number; scrollLeft: number } | null>(null);
    const [following, setFollowing] = useState(true);
    const lastCount = useRef(entries.length);

    const visible = entries.filter((e) => {
        if (hideBasic && BASIC_CATEGORIES.has(actionCategory(e))) return false;
        if (actorFilter === "all" || !myRole) return true;
        const mine = e.actorRole === myRole;
        return actorFilter === "self" ? mine : !mine;
    });

    // Track whether the player is parked at the newest end. ~24px of slack so a
    // sub-pixel or momentum offset doesn't read as "scrolled away".
    const handleScroll = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return;
        setFollowing(el.scrollLeft + el.clientWidth >= el.scrollWidth - 24);
    }, []);

    // Restore position after older entries are prepended. Layout effect: runs
    // after DOM mutation but BEFORE paint, so the correction is never visible.
    useLayoutEffect(() => {
        const el = scrollerRef.current;
        const anchor = prependAnchor.current;
        if (!el || !anchor) return;
        prependAnchor.current = null;
        const grew = el.scrollWidth - anchor.scrollWidth;
        if (grew > 0) el.scrollLeft = anchor.scrollLeft + grew;
    }, [visible.length]);

    // Follow the newest action only when already at the end.
    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const grew = entries.length > lastCount.current;
        lastCount.current = entries.length;
        if (grew && following && !prependAnchor.current) el.scrollLeft = el.scrollWidth;
    }, [entries.length, following]);

    const requestOlder = useCallback(() => {
        const el = scrollerRef.current;
        if (el) prependAnchor.current = { scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft };
        onLoadOlder?.();
    }, [onLoadOlder]);

    return (
        <section className="battle-timeline" aria-label="Action timeline">
            <header className="bt-controls">
                <div className="bt-filter-group" role="group" aria-label="Filter actions by fighter">
                    {(["all", "self", "opponent"] as const).map((f) => (
                        <button
                            key={f}
                            type="button"
                            className={`bt-filter${actorFilter === f ? " bt-filter-on" : ""}`}
                            aria-pressed={actorFilter === f}
                            onClick={() => onActorFilter(f)}
                        >
                            {f === "all" ? "All" : f === "self" ? "You" : "Opponent"}
                        </button>
                    ))}
                </div>
                <label className="bt-toggle">
                    <input
                        type="checkbox"
                        checked={hideBasic}
                        onChange={(e) => onHideBasic(e.target.checked)}
                    />
                    <span>Hide basic actions</span>
                </label>
            </header>

            <div className="bt-strip" ref={scrollerRef} onScroll={handleScroll}>
                {hasOlder && (
                    <button
                        type="button"
                        className="bt-load-older"
                        onClick={requestOlder}
                        disabled={loadingOlder}
                    >
                        {loadingOlder ? "Loading…" : "◂ Load older"}
                    </button>
                )}
                {visible.length === 0 ? (
                    <p className="bt-empty">No actions match this filter.</p>
                ) : (
                    <ol className="bt-list">
                        {visible.map((entry) => (
                            <TimelineNode
                                key={entry.seq}
                                entry={entry}
                                side={myRole && entry.actorRole === myRole ? "self" : "opponent"}
                                selected={selectedSeq === entry.seq}
                                onSelect={onSelect}
                            />
                        ))}
                    </ol>
                )}
            </div>
        </section>
    );
});
