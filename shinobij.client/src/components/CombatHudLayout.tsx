import { forwardRef, memo, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { BattleActionBlock } from "./BattleActionBlock";
import { BattleLogLine } from "./BattleLogLine";
import { groupPlainCombatLog } from "../lib/plain-combat-log";

type DivProps = HTMLAttributes<HTMLDivElement>;
type MainProps = HTMLAttributes<HTMLElement>;

function classNames(base: string, extra?: string): string {
    return extra ? `${base} ${extra}` : base;
}

/** Shared visual grid for shinobi combat. Combat state and mode logic stay with callers. */
export function CombatHudLayout({
    children,
    className,
    hasActionNotice = false,
    ...props
}: DivProps & { hasActionNotice?: boolean }) {
    return (
        <div
            className={classNames(`combat-layout${hasActionNotice ? " has-action-notice" : ""}`, className)}
            {...props}
        >
            {children}
        </div>
    );
}

/** Central board/actions/log column shared by PvP and Solo PvE. */
export function CombatHudMain({
    children,
    className,
    activeTab,
    ...props
}: MainProps & { activeTab: "actions" | "log" }) {
    return (
        <main className={classNames(`combat-main-area bt-${activeTab}`, className)} {...props}>
            {children}
        </main>
    );
}

export function CombatHudHeader({ title, subtitle }: { title: ReactNode; subtitle: ReactNode }) {
    return (
        <div className="arena-top-panel">
            <div className="arena-title-panel">
                <h2>{title}</h2>
                <span className="combat-brand-mark" role="img" aria-label="Shinobi Journey" />
                <p>{subtitle}</p>
            </div>
        </div>
    );
}

export function CombatEnvironmentStrip({ children, className, ...props }: DivProps) {
    return <div className={classNames("twp-strip", className)} {...props}>{children}</div>;
}

export function CombatApPanel({ children, className, ...props }: DivProps) {
    return <div className={classNames("dual-ap-panel", className)} {...props}>{children}</div>;
}

export function CombatBoardStage({ children, className, ...props }: DivProps) {
    return <div className={classNames("combat-board-stage", className)} {...props}>{children}</div>;
}

/**
 * Phone-only merge point for the two action surfaces. On desktop this is
 * `display: contents`, so the command bar and the jutsu/weapon/item tray keep
 * their own grid areas exactly as before. On a phone the wrapper becomes the
 * single bordered, single-scrolling action panel: the basic commands ride at
 * the top of the same scrollport as the loadout cards instead of spending a
 * second fixed band of a viewport that has none to spare.
 */
export function CombatActionTray({ children, className, ...props }: DivProps) {
    return <div className={classNames("combat-action-tray", className)} {...props}>{children}</div>;
}

/** Basic combat controls; mode-specific actions such as Pet or Flee remain caller-owned children. */
export function CombatCommandBar({ children, className, ...props }: DivProps) {
    return <div className={classNames("basic-action-bar shinobi-command-bar", className)} {...props}>{children}</div>;
}

/** Shared lower-right desktop frame for mode-specific combat controls. */
export function CombatModePanel({
    children,
    className,
    headerAction,
    title,
    ...props
}: DivProps & { title: ReactNode; headerAction?: ReactNode }) {
    return (
        <aside className={classNames("combat-mode-panel", className)} {...props}>
            <div className="battle-side-header combat-mode-panel-header">
                <span>{title}</span>
                {headerAction}
            </div>
            <div className="combat-mode-panel-body">{children}</div>
        </aside>
    );
}

/** Shared accessible battle-log frame. Callers may provide plain or structured log content. */
export const CombatBattleLogPanel = forwardRef<HTMLDivElement, DivProps & {
    turnLabel: ReactNode;
    headerMeta?: ReactNode;
    headerActions?: ReactNode;
}>(
    function CombatBattleLogPanel({ children, className, turnLabel, headerMeta, headerActions, role = "log", ...props }, ref) {
        return (
            <div
                ref={ref}
                {...props}
                className={classNames("combat-text-log", className)}
                role={role}
                aria-live={role === "log" ? "polite" : undefined}
                aria-label="Battle log"
            >
                <div className="combat-log-header">
                    <div className="combat-log-title">
                        <strong>Battle Log</strong>
                        {headerMeta && <small className="combat-log-summary">{headerMeta}</small>}
                    </div>
                    <div className="combat-log-header-actions">
                        <span className="combat-log-turn">{turnLabel}</span>
                        {headerActions}
                    </div>
                </div>
                <div className="combat-log-scroll-region" tabIndex={0}>
                    {children}
                </div>
            </div>
        );
    },
);

/** Structured, color-coded battle-log feed used by authoritative Solo PvE and PvP. */
export const PlainCombatBattleLog = memo(function PlainCombatBattleLog({
    lines,
    turnLabel,
    selfName = "",
    oppName = "",
    newestFirst = true,
    emptyMessage = "No entries yet.",
    className,
}: {
    lines: readonly string[];
    turnLabel: ReactNode;
    selfName?: string;
    oppName?: string;
    newestFirst?: boolean;
    emptyMessage?: string;
    className?: string;
}) {
    const rounds = useMemo(() => groupPlainCombatLog(lines, selfName, oppName), [lines, selfName, oppName]);
    const visibleRounds = useMemo(
        () => newestFirst ? [...rounds].reverse() : rounds,
        [newestFirst, rounds],
    );
    const defaultOpenRounds = useMemo(() => new Set(rounds.slice(-1).map((group) => group.round)), [rounds]);
    const [roundOverrides, setRoundOverrides] = useState<Record<number, boolean>>({});
    const [expanded, setExpanded] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!expanded) return;
        const containExpandedFocus = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setExpanded(false);
                return;
            }
            if (event.key !== "Tab") return;
            const panel = panelRef.current;
            if (!panel) return;
            const focusable = [...panel.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            )].filter((element) => !element.hasAttribute("hidden"));
            if (focusable.length === 0) return;
            const first = focusable[0]!;
            const last = focusable[focusable.length - 1]!;
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !panel.contains(active))) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        document.addEventListener("keydown", containExpandedFocus);
        return () => document.removeEventListener("keydown", containExpandedFocus);
    }, [expanded]);

    const eventCount = rounds.reduce((total, group) => total + group.lineCount, 0);
    const roundSummary = `${rounds.length} ${rounds.length === 1 ? "round" : "rounds"}`;
    const eventSummary = `${eventCount} ${eventCount === 1 ? "event" : "events"}`;
    return (
        <>
            {expanded && <div className="combat-log-modal-backdrop" aria-hidden="true" onClick={() => setExpanded(false)} />}
            <CombatBattleLogPanel
                ref={panelRef}
                className={classNames(`plain-combat-battle-log${expanded ? " is-expanded" : ""}`, className)}
                turnLabel={turnLabel}
                role={expanded ? "dialog" : "log"}
                aria-modal={expanded || undefined}
                headerMeta={rounds.length > 0 ? `${roundSummary} · ${eventSummary}` : undefined}
                headerActions={(
                    <button
                        type="button"
                        className="combat-log-expand"
                        aria-pressed={expanded}
                        aria-label={expanded ? "Restore battle log" : "Expand battle log"}
                        title={expanded ? "Restore battle log (Esc)" : "Expand battle log"}
                        onClick={() => setExpanded((value) => !value)}
                    >
                        <svg className="combat-log-expand-icon" viewBox="0 0 20 20" aria-hidden="true">
                            {expanded ? (
                                <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" />
                            ) : (
                                <path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5" />
                            )}
                        </svg>
                        <span className="combat-log-expand-label">{expanded ? "Restore" : "Expand"}</span>
                    </button>
                )}
            >
                {visibleRounds.length === 0 ? (
                    <p className="plain-combat-log-empty">{emptyMessage}</p>
                ) : (
                    <div className="plain-combat-rounds combat-timeline">
                        {visibleRounds.map((group) => {
                            const open = roundOverrides[group.round] ?? defaultOpenRounds.has(group.round);
                            const isLatestRound = group.round === rounds[rounds.length - 1]?.round;
                            const visibleActions = newestFirst ? [...group.actions].reverse() : group.actions;
                            return (
                                <section
                                    className={`plain-combat-log-round timeline-round${open ? " open" : " collapsed"}${isLatestRound ? " is-latest" : ""}`}
                                    key={group.round}
                                >
                                    <button
                                        type="button"
                                        className="timeline-round-header timeline-round-toggle"
                                        aria-expanded={open}
                                        onClick={() => setRoundOverrides((current) => ({ ...current, [group.round]: !open }))}
                                    >
                                        <span className="timeline-round-chevron" aria-hidden="true">▾</span>
                                        <span className="plain-combat-round-label">Round {group.round}</span>
                                        {isLatestRound && <span className="plain-combat-current-round">Latest</span>}
                                        <span className="timeline-round-count">{group.lineCount} events</span>
                                    </button>
                                    {open && (
                                        <div className="plain-combat-round-events">
                                            {visibleActions.map((action) => {
                                                if (!action.actor && !action.headline) {
                                                    return (
                                                        <div className="plain-combat-orphan-effects" key={action.renderKey}>
                                                            {action.effectLines.map((line, lineIndex) => (
                                                                <BattleLogLine line={line} key={lineIndex} />
                                                            ))}
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <BattleActionBlock
                                                        action={action}
                                                        selfName={selfName}
                                                        oppName={oppName}
                                                        key={action.renderKey}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                )}
            </CombatBattleLogPanel>
        </>
    );
});
