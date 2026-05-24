"""
PvP v4 sim — endgame-balanced (max stats assumed) + selective tag stacking.

What's modeled:
  - Raw damage from EP table (xlsx-style), no stat scaling
  - Three buckets: gear, bloodline, multiplicative tag amps
  - Tag amps stackable with exponent cap (4 / 6 / unc tested)
  - DR pool soft-capped via K_DR = 0.5 (no cliff)
  - DoT stacking: Wound + Drain stack, Poison does NOT
  - Pierce v3 (locked formula)

Usage: python scripts/pvp_v4_stacking_sim.py
"""
from dataclasses import dataclass, field
from typing import List

# ── Constants ─────────────────────────────────────────────────────────────────
K_DR             = 0.5
TRUE_DMG_CAP     = 900
TRUE_DMG_FLOOR   = 100
POISON_MAX_PCT   = 25         # single Poison capped at 25% maxChakra/tick
WOUND_MAX_PER_TICK = 800      # cap to prevent stacked oneshots
DRAIN_MAX_PER_TICK = 600

# EP → raw dmg (xlsx-style linear)
def ep_to_raw(ep: int) -> float:
    return ep * 12.625

# ── Status instance ───────────────────────────────────────────────────────────
@dataclass
class Status:
    name: str
    pct: int = 0
    amount: int = 0
    rounds: int = 2
    kind: str = "positive"   # or "negative"

# ── Build ─────────────────────────────────────────────────────────────────────
@dataclass
class Build:
    name: str
    max_hp: int = 5000
    max_chakra: int = 2000
    armor_raw_dr: float = 0.5
    item_damage_pct: int = 10
    bloodline_mult: float = 1.4
    jutsu_ap: int = 60
    jutsu_ep: int = 50
    mastery_level: int = 50
    statuses: List[Status] = field(default_factory=list)

# ── Stacking semantics ────────────────────────────────────────────────────────
STACKABLE = {
    "Increase Damage Given", "Increase Damage Taken", "Ignition",
    "Decrease Damage Given", "Decrease Damage Taken",
    "Wound", "Drain",
    "Lifesteal", "Reflect", "Absorb",
}
# Everything else, including Poison/Stun/Barrier/Push/Pull/Prevents/Seals,
# does NOT stack — re-applying refreshes duration.

def add_status(b: Build, s: Status):
    if s.name in STACKABLE:
        b.statuses.append(s)
    else:
        b.statuses = [x for x in b.statuses if x.name != s.name] + [s]

def count_active(b: Build, name: str) -> int:
    return sum(1 for s in b.statuses if s.name == name)

# ── Damage formula ────────────────────────────────────────────────────────────
def amp_mult(attacker: Build, defender: Build, exp_cap: int) -> float:
    m = 1.0
    # Attacker IDG + Ignition (own buffs)
    n_idg = count_active(attacker, "Increase Damage Given")
    if n_idg:
        n = min(n_idg, exp_cap) if exp_cap > 0 else n_idg
        m *= (1 + 0.25) ** n
    # Defender IDT + Ignition (vulnerability on them)
    n_idt = count_active(defender, "Increase Damage Taken")
    if n_idt:
        n = min(n_idt, exp_cap) if exp_cap > 0 else n_idt
        m *= (1 + 0.25) ** n
    n_ign = count_active(defender, "Ignition")
    if n_ign:
        n = min(n_ign, exp_cap) if exp_cap > 0 else n_ign
        m *= (1 + 0.25) ** n
    return m

def raw_dr(attacker: Build, defender: Build) -> float:
    # armor + def's DDT stacks + att's DDG stacks (debuff on att lowers att dmg)
    dr = defender.armor_raw_dr
    dr += count_active(defender, "Decrease Damage Taken") * 0.25
    dr += count_active(attacker, "Decrease Damage Given") * 0.25
    return dr

def eff_dr(raw: float) -> float:
    return raw / (raw + K_DR)

def base_dmg(attacker: Build, defender: Build) -> float:
    raw = ep_to_raw(attacker.jutsu_ep)
    gear = 1 + attacker.item_damage_pct / 100
    return raw * gear * attacker.bloodline_mult

def normal_hit(attacker: Build, defender: Build, exp_cap: int = 4) -> int:
    base = base_dmg(attacker, defender)
    amp  = amp_mult(attacker, defender, exp_cap)
    dr   = eff_dr(raw_dr(attacker, defender))
    return int(max(0, base * amp * (1 - dr)))

def pierce_true(attacker: Build) -> int:
    # Pierce v3 — keep formula even though capped at 900 for all max-stat builds
    composite_offense = 7500  # max-stat assumption
    ap_factor = max(0.5, attacker.jutsu_ap / 60)
    mastery_factor = 1 + max(0, min(50, attacker.mastery_level)) * 0.005
    raw = composite_offense * 0.35 * ap_factor * mastery_factor
    return int(max(TRUE_DMG_FLOOR, min(TRUE_DMG_CAP, raw)))

# ── DoT tick (applied per turn before the attacker acts) ──────────────────────
def apply_dots(b: Build, max_chakra: int = 2000) -> int:
    total = 0
    # Wound stacks → sum, capped per tick
    n_wound = count_active(b, "Wound")
    if n_wound:
        per_stack = 200    # base wound damage per stack
        tick = min(WOUND_MAX_PER_TICK, per_stack * n_wound)
        total += tick
    # Drain stacks → sum, capped per tick
    n_drain = count_active(b, "Drain")
    if n_drain:
        per_stack = 250
        tick = min(DRAIN_MAX_PER_TICK, per_stack * n_drain)
        total += tick
    # Poison — single stack only (does not multiply!)
    if count_active(b, "Poison"):
        pct = POISON_MAX_PCT
        total += int(max_chakra * pct / 100)
    return total

# ── Scenarios ─────────────────────────────────────────────────────────────────
def banner(t): print("\n" + "=" * 76 + f"\n  {t}\n" + "=" * 76)

def scenario_baseline():
    banner("S1 — Mirror, no buffs (target TTK ~10)")
    a = Build("A"); d = Build("B")
    print(f"  hit: {normal_hit(a, d)}   eff DR: {eff_dr(raw_dr(a, d)):.1%}")
    print(f"  TTK at 5000 HP: ~{5000 // normal_hit(a, d)} rounds")

def scenario_amp_cap_curve():
    banner("S2 — Damage at N stacked IDG (cap 4 vs 6 vs uncapped)")
    a = Build("A"); d = Build("B")
    print(f"  {'N stacks':<10} {'cap=4':>10} {'cap=6':>10} {'uncapped':>10} {'ratio_vs_0':>12}")
    base = normal_hit(a, d, exp_cap=999)
    for n in range(0, 9):
        a.statuses = [Status("Increase Damage Given", pct=25) for _ in range(n)]
        c4  = normal_hit(a, d, exp_cap=4)
        c6  = normal_hit(a, d, exp_cap=6)
        unc = normal_hit(a, d, exp_cap=999)
        print(f"  {n:<10} {c4:>10} {c6:>10} {unc:>10} {(unc/base):>12.2f}x")

def scenario_dot_stacking():
    banner("S3 — DoT stacking (Wound + Drain stack; Poison does NOT)")
    d = Build("Target", max_chakra=2000)
    print(f"  {'tags applied':<30} {'wound/tick':>12} {'drain/tick':>12} {'poison/tick':>14} {'total':>8}")
    cases = [
        ("0 of each", [], 0),
        ("1 Wound", [Status("Wound")], 0),
        ("3 Wound", [Status("Wound")] * 3, 0),
        ("5 Wound", [Status("Wound")] * 5, 0),
        ("1 Drain", [Status("Drain")], 0),
        ("3 Drain", [Status("Drain")] * 3, 0),
        ("1 Poison", [Status("Poison")], 0),
        ("3 Poison (stacks ignored)", [Status("Poison")] * 3, 0),
        ("3W + 3D + 1P", [Status("Wound")]*3 + [Status("Drain")]*3 + [Status("Poison")], 0),
    ]
    for label, ss, _ in cases:
        d.statuses = list(ss)
        n_w = count_active(d, "Wound")
        n_d = count_active(d, "Drain")
        n_p = count_active(d, "Poison")
        w_tick = min(WOUND_MAX_PER_TICK, 200 * n_w) if n_w else 0
        d_tick = min(DRAIN_MAX_PER_TICK, 250 * n_d) if n_d else 0
        p_tick = int(d.max_chakra * POISON_MAX_PCT / 100) if n_p else 0
        print(f"  {label:<30} {w_tick:>12} {d_tick:>12} {p_tick:>14} {w_tick+d_tick+p_tick:>8}")

def scenario_burst_window():
    banner("S4 — Burst window: stack IDG up to cap, then nuke")
    a = Build("A"); d = Build("B")
    print(f"  Plan: cast 4 IDG over 2 turns (cap=4), then nuke")
    cap = 4
    for n in [0, 1, 2, 3, 4, 5, 6]:
        a.statuses = [Status("Increase Damage Given", pct=25) for _ in range(n)]
        hit = normal_hit(a, d, exp_cap=cap)
        amp = amp_mult(a, d, exp_cap=cap)
        print(f"  After {n} IDG stacks: hit {hit}  ({amp:.2f}x of base)")

def scenario_clear_value():
    banner("S5 — Clear value vs no-Clear in a 4-stack matchup")
    glass = Build("Glass", item_damage_pct=15, bloodline_mult=1.4)
    tank  = Build("Tank",  armor_raw_dr=1.2, item_damage_pct=0, bloodline_mult=1.4)
    glass.statuses = [Status("Increase Damage Given", pct=25) for _ in range(4)]
    hit_buffed = normal_hit(glass, tank, exp_cap=4)
    glass.statuses = []
    hit_cleared = normal_hit(glass, tank, exp_cap=4)
    print(f"  Buffed (4 IDG):   {hit_buffed}/hit")
    print(f"  After Clear:      {hit_cleared}/hit")
    print(f"  Damage prevented: {hit_buffed - hit_cleared} per round  ({(hit_buffed/hit_cleared):.2f}x reduction)")

def scenario_anti_dr_pierce():
    banner("S6 — Pierce vs 4-stack DDT tank (DR stacking)")
    pierce = Build("Pierce", jutsu_ap=60, mastery_level=50)
    tank   = Build("Tank",   armor_raw_dr=1.5, item_damage_pct=0)
    tank.statuses = [Status("Decrease Damage Taken", pct=25) for _ in range(4)]
    n_dr   = normal_hit(pierce, tank, exp_cap=4)
    p_dr   = pierce_true(pierce)
    raw = raw_dr(pierce, tank)
    print(f"  Tank raw DR: {raw:.2f}  →  eff DR: {eff_dr(raw):.1%}")
    print(f"  Normal hit:  {n_dr}/round")
    print(f"  Pierce hit:  {p_dr}/round  ({p_dr/max(1,n_dr):.2f}x multiplier)")

def scenario_dr_stack_curve():
    banner("S7 — DR pool at N stacked DDT (soft cap behavior)")
    pierce = Build("Att"); tank = Build("Tank", armor_raw_dr=0.5)
    print(f"  {'N DDT stacks':<14} {'raw_DR':>10} {'eff_DR':>10} {'%hit_dmg':>10}")
    for n in range(0, 10):
        tank.statuses = [Status("Decrease Damage Taken", pct=25) for _ in range(n)]
        raw = raw_dr(pierce, tank)
        edr = eff_dr(raw)
        print(f"  {n:<14} {raw:>10.2f} {edr:>10.1%} {(1-edr)*100:>10.1f}%")

if __name__ == "__main__":
    scenario_baseline()
    scenario_amp_cap_curve()
    scenario_dot_stacking()
    scenario_burst_window()
    scenario_clear_value()
    scenario_anti_dr_pierce()
    scenario_dr_stack_curve()
