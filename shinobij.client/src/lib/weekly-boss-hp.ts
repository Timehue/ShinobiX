/*
 * Weekly Boss shared-HP view model (screens/WeeklyBossArena).
 *
 * ONE boss, ONE world pool: the server publishes `hpMax` and
 * `hpRemaining = max(0, hpMax − Σ damageByPlayer)`, and the client re-derives
 * the remainder so a stale or legacy payload still reads correctly.
 *
 * It lives here, apart from the screen, because of the failure it exists to
 * prevent: a stale or partial payload arriving with `hpMax: 0` used to render a
 * triumphant gold "BROKEN · staggered" bar reading `0 / 0` — the arena
 * announcing a world-first kill that never happened. With no pool there is
 * nothing to draw, so `showBar` is false and `broken` stays false, and that
 * rule is unit-tested rather than trusted to a JSX read-through.
 */

export type WeeklyBossHpSource = {
    hpMax?: number;
    hpRemaining?: number;
    broken?: boolean;
    damageByPlayer?: Record<string, number>;
};

export type WeeklyBossHpView = {
    hpMax: number;
    hpRemaining: number;
    /** 0-100, clamped. */
    hpPct: number;
    /** hpPct for display: whole numbers, but one decimal below 1% so the last
     *  sliver of a world pool never reads as a flat 0%. */
    hpPctLabel: string;
    /** Pool exhausted — staggered, NOT despawned. Never true without a pool. */
    broken: boolean;
    /** False when there is no pool to draw. */
    showBar: boolean;
};

export function weeklyBossHpView(boss: WeeklyBossHpSource | null | undefined): WeeklyBossHpView {
    const hpMax = Math.max(0, Math.floor(Number(boss?.hpMax ?? 0)) || 0);
    const totalDamage = Object.values(boss?.damageByPlayer ?? {})
        .reduce((sum, d) => sum + Math.max(0, Math.floor(Number(d) || 0)), 0);
    const published = Number(boss?.hpRemaining);
    const hpRemaining = Math.max(0, Math.min(hpMax, Number.isFinite(published) ? Math.floor(published) : hpMax - totalDamage));
    const hpPct = hpMax > 0 ? Math.max(0, Math.min(100, (hpRemaining / hpMax) * 100)) : 0;
    const hpPctLabel = hpPct > 0 && hpPct < 1 ? hpPct.toFixed(1) : String(Math.round(hpPct));
    const broken = hpMax > 0 && (boss?.broken === true || hpRemaining <= 0);
    return { hpMax, hpRemaining, hpPct, hpPctLabel, broken, showBar: hpMax > 0 };
}
