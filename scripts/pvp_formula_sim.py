"""
PvP v3 formula simulator — mirrors the actual math in api/pvp/move.ts.

Usage:  python scripts/pvp_formula_sim.py
"""
from dataclasses import dataclass, field
from typing import Callable

# ── Constants (must match move.ts) ────────────────────────────────────────────
MAX_STAT     = 2500
PVP_SCALE    = 0.42
K_DR         = 0.5
TRUE_DMG_CAP = 900
TRUE_DMG_FLOOR = 100

# ── Build ─────────────────────────────────────────────────────────────────────
@dataclass
class Build:
    name: str
    # Composite offense = sum of three stats (e.g. taiOff + str + spd). 0–7500.
    offense: int = 3000
    defense: int = 3000
    max_hp: int = 5000
    max_chakra: int = 2000
    # Raw armor DR (e.g. 7 pieces × 0.15 = 1.05). Feeds the DR soft-cap pool.
    armor_raw_dr: float = 0.5
    item_damage_pct: float = 15           # itemDamagePct (%)
    bloodline_mult: float = 1.4            # 1.0 if no BL or sealed
    # Active in-combat tag stacks (each tag costs an AP/jutsu to apply)
    idg_stacks: int = 0; idg_pct: int = 25  # Increase Damage Given (on attacker)
    idt_stacks: int = 0; idt_pct: int = 25  # Increase Damage Taken (on defender)
    ign_stacks: int = 0; ign_pct: int = 25  # Ignition (on defender)
    ddg_stacks: int = 0; ddg_pct: int = 25  # Decrease Damage Given (on attacker)
    ddt_stacks: int = 0; ddt_pct: int = 25  # Decrease Damage Taken (on defender)
    # Per-jutsu params
    jutsu_ap: int = 60
    jutsu_ep: int = 50
    mastery_level: int = 0                 # 0–50
    # Weather/terrain (1.0 = neutral)
    w_mult: float = 1.0
    t_mult: float = 1.0

# ── v3 formula (mirrors applyJutsu in move.ts) ────────────────────────────────
def stat_factor(off: int, dfn: int) -> float:
    # v3: tightened from [0.35, 1.85] → [0.7, 1.4], divisor MAX_STAT not 2×, coef 0.4
    return max(0.7, min(1.4, 1 + (off - dfn) / MAX_STAT * 0.4))

def amp_mult(att: Build, dfn: Build) -> float:
    m = 1.0
    if att.idg_stacks: m *= (1 + att.idg_pct / 100) ** att.idg_stacks
    if dfn.idt_stacks: m *= (1 + dfn.idt_pct / 100) ** dfn.idt_stacks
    if dfn.ign_stacks: m *= (1 + dfn.ign_pct / 100) ** dfn.ign_stacks
    return m

def raw_dr(att: Build, dfn: Build) -> float:
    return (dfn.armor_raw_dr
          + att.ddg_stacks * att.ddg_pct / 100
          + dfn.ddt_stacks * dfn.ddt_pct / 100)

def eff_dr(raw: float) -> float:
    return raw / (raw + K_DR)

def base_dmg(att: Build, dfn: Build) -> float:
    effect_factor = max(0, att.jutsu_ep + att.mastery_level * 0.2) / 100
    sf            = stat_factor(att.offense, dfn.defense)
    item_mult     = 1 + max(0, att.item_damage_pct) / 100
    return (att.max_hp * effect_factor * sf * PVP_SCALE
            * att.w_mult * att.t_mult * att.bloodline_mult * item_mult)

# Pierce v3 (mirrors pierceTrueDamage in move.ts)
def pierce_true(att: Build) -> int:
    ap_factor      = max(0.5, att.jutsu_ap / 60)
    mastery_factor = 1 + max(0, min(50, att.mastery_level)) * 0.005
    raw            = att.offense * 0.35 * ap_factor * mastery_factor
    return int(max(TRUE_DMG_FLOOR, min(TRUE_DMG_CAP, raw)))

# Final per-hit damage
def hit(att: Build, dfn: Build, pierce: bool=False):
    if pierce:
        d = pierce_true(att)
        return d, 0, d, 0.0
    base   = base_dmg(att, dfn)
    amp    = amp_mult(att, dfn)
    dr     = eff_dr(raw_dr(att, dfn))
    normal = int(max(0, base * amp * (1 - dr)))
    return normal, normal, 0, dr

def ttk(att, dfn, pierce=False, cap=25):
    hp = dfn.max_hp
    for r in range(1, cap + 1):
        d, _, _, _ = hit(att, dfn, pierce)
        hp -= d
        if hp <= 0: return r
    return cap + 1

# ── Scenarios ─────────────────────────────────────────────────────────────────
def banner(t): print("\n" + "=" * 72 + f"\n  {t}\n" + "=" * 72)

def scenario_mirror():
    banner("S1 — Mirror match, no buffs (target TTK 9-11)")
    a = Build("A"); d = Build("B")
    h, *_ = hit(a, d)
    dr = eff_dr(raw_dr(a, d))
    print(f"  per-hit: {h}   eff DR: {dr:.1%}   statFactor: {stat_factor(a.offense, d.defense):.2f}")
    print(f"  TTK: {ttk(a, d)}   {'PASS' if 9 <= ttk(a, d) <= 11 else 'TUNE'}")

def scenario_buffs():
    banner("S2 — Mirror + each fighter stacks IDG×1 (target: faster TTK)")
    a = Build("A", idg_stacks=1); d = Build("B")
    h, *_ = hit(a, d)
    print(f"  Attacker IDG+25%:  {h}/hit, TTK {ttk(a, d)}")
    a2 = Build("A", idg_stacks=2)
    h2, *_ = hit(a2, d)
    print(f"  Attacker IDG×2:    {h2}/hit, TTK {ttk(a2, d)}   (multiplicative check)")

def scenario_glass_vs_tank():
    banner("S3 — Glass cannon vs tank (glass should win)")
    glass = Build("Glass", offense=4500, defense=2500, max_hp=4500,
                  armor_raw_dr=0.3, item_damage_pct=40, idg_stacks=2, jutsu_ep=60)
    tank  = Build("Tank",  offense=2500, defense=4500, max_hp=6000,
                  armor_raw_dr=1.5, item_damage_pct=0,  ddt_stacks=2, jutsu_ep=40)
    g_d, *_ , g_dr = hit(glass, tank)
    t_d, *_ , t_dr = hit(tank, glass)
    print(f"  Glass→Tank: {g_d}/hit (DR {g_dr:.1%}), TTK {ttk(glass, tank)}")
    print(f"  Tank→Glass: {t_d}/hit (DR {t_dr:.1%}), TTK {ttk(tank, glass)}")
    print(f"  Winner: {'Glass PASS' if ttk(glass, tank) < ttk(tank, glass) else 'Tank — unexpected'}")

def scenario_pierce_old_vs_new():
    banner("S4 — Pierce old (flat 900) vs new (stat-scaled, cap 900)")
    print(f"  {'offense':<10} {'ap':<5} {'mastery':<8} {'old':>6} {'new':>6}")
    for off in [1500, 2500, 3500, 4500, 6000]:
        for ap in [40, 60, 80]:
            for m in [0, 50]:
                att = Build("X", offense=off, jutsu_ap=ap, mastery_level=m)
                old = 900 if ap >= 60 else 0
                new = pierce_true(att)
                print(f"  {off:<10} {ap:<5} {m:<8} {old:>6} {new:>6}")

def scenario_pierce_vs_tank():
    banner("S5 — Pierce specialist vs 88% DR tank (TTK comparison)")
    pierce_build = Build("Pierce", offense=4500, jutsu_ep=60, jutsu_ap=60, mastery_level=40,
                         item_damage_pct=15, idg_stacks=1)
    tank = Build("Tank", defense=4500, max_hp=6000, armor_raw_dr=2.5, ddt_stacks=3, ddt_pct=30)
    n_dmg, *_ = hit(pierce_build, tank, pierce=False)
    p_dmg, *_ = hit(pierce_build, tank, pierce=True)
    dr_active = eff_dr(raw_dr(pierce_build, tank))
    print(f"  Tank effective DR: {dr_active:.1%}")
    print(f"  Normal hit:  {n_dmg:>4}/hit, TTK {ttk(pierce_build, tank, pierce=False)}")
    print(f"  Pierce hit:  {p_dmg:>4}/hit, TTK {ttk(pierce_build, tank, pierce=True)}")
    print(f"  Pierce multiplier: {p_dmg / max(1, n_dmg):.2f}x")

def scenario_pierce_vs_glass():
    banner("S6 — Pierce vs unarmored target (should NOT be dominant)")
    pierce_build = Build("Pierce", offense=4500, jutsu_ep=60, jutsu_ap=60, mastery_level=40)
    glass = Build("Glass", defense=2500, max_hp=4000, armor_raw_dr=0.1, ddt_stacks=0)
    n_dmg, *_ = hit(pierce_build, glass, pierce=False)
    p_dmg, *_ = hit(pierce_build, glass, pierce=True)
    print(f"  Glass effective DR: {eff_dr(raw_dr(pierce_build, glass)):.1%}")
    print(f"  Normal hit: {n_dmg:>4}/hit   Pierce hit: {p_dmg:>4}/hit")
    print(f"  → Pierce is {'CORRECTLY SITUATIONAL' if p_dmg < n_dmg else 'TOO STRONG vs glass'}")

def scenario_stat_factor_curve():
    banner("S7 — statFactor at various off-def deltas (sanity check)")
    print(f"  {'off':<6} {'def':<6} {'old [0.35,1.85]':<18} {'new [0.7,1.4]':<14}")
    for off, dfn in [(1000, 5000), (2000, 4000), (3000, 3000), (4000, 2000), (5000, 1000)]:
        old = max(0.35, min(1.85, 1 + (off - dfn) / (MAX_STAT * 2) * 0.85))
        new = stat_factor(off, dfn)
        print(f"  {off:<6} {dfn:<6} {old:<18.3f} {new:<14.3f}")

def scenario_dr_curve():
    banner("S8 — DR pool curve (raw DR → effective DR)")
    print(f"  {'raw DR':<10} {'eff DR':<10} {'1-eff':>10}")
    for r in [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0]:
        e = eff_dr(r)
        print(f"  {r:<10.2f} {e:<10.1%} {(1-e):>10.1%}")

if __name__ == "__main__":
    scenario_mirror()
    scenario_buffs()
    scenario_glass_vs_tank()
    scenario_pierce_old_vs_new()
    scenario_pierce_vs_tank()
    scenario_pierce_vs_glass()
    scenario_stat_factor_curve()
    scenario_dr_curve()
