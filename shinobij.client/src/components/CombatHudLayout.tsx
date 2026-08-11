import { forwardRef, memo, type HTMLAttributes, type ReactNode } from "react";
import { BattleLogLine } from "./BattleLogLine";

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
            className={classNames(`combat-layout${hasActionNotice ? " has-rookie-tip" : ""}`, className)}
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

/** Basic combat controls; mode-specific actions such as Pet or Flee remain caller-owned children. */
export function CombatCommandBar({ children, className, ...props }: DivProps) {
    return <div className={classNames("basic-action-bar shinobi-command-bar", className)} {...props}>{children}</div>;
}

/** Shared accessible battle-log frame. Callers may provide plain or structured log content. */
export const CombatBattleLogPanel = forwardRef<HTMLDivElement, DivProps & { turnLabel: ReactNode }>(
    function CombatBattleLogPanel({ children, className, turnLabel, ...props }, ref) {
        return (
            <div
                ref={ref}
                {...props}
                className={classNames("combat-text-log", className)}
                role="log"
                aria-live="polite"
                aria-label="Battle log"
            >
                <div className="combat-log-header">
                    <strong>Battle Log</strong>
                    <span>{turnLabel}</span>
                </div>
                {children}
            </div>
        );
    },
);

const ROUND_LOG_LINE = /^--- Round \d+ ---$/i;

type CombatLogEntry = { line: string; originalIndex: number };

function visibleLogEntries(lines: readonly string[], newestFirst: boolean): CombatLogEntry[] {
    const entries: CombatLogEntry[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        entries.push({ line: lines[index] ?? "", originalIndex: index });
    }
    if (newestFirst) entries.reverse();
    return entries;
}

/** Large, direct battle-log feed used by authoritative Solo PvE and PvP. */
export const PlainCombatBattleLog = memo(function PlainCombatBattleLog({
    lines,
    turnLabel,
    newestFirst = true,
    emptyMessage = "No entries yet.",
    className,
}: {
    lines: readonly string[];
    turnLabel: ReactNode;
    newestFirst?: boolean;
    emptyMessage?: string;
    className?: string;
}) {
    const entries = visibleLogEntries(lines, newestFirst);
    return (
        <CombatBattleLogPanel className={classNames("plain-combat-battle-log", className)} turnLabel={turnLabel}>
            {entries.length === 0 ? (
                <p className="plain-combat-log-empty">{emptyMessage}</p>
            ) : entries.map(({ line, originalIndex }) => (
                <BattleLogLine
                    key={originalIndex}
                    line={line}
                    className={`combat-log-line plain-combat-log-line${ROUND_LOG_LINE.test(line.trim()) ? " plain-combat-log-round" : ""}`}
                />
            ))}
        </CombatBattleLogPanel>
    );
});
