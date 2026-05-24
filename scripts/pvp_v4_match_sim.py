"""
PvP v4 — full-fight simulator between two capped players (10K HP).
Both fighters: max stats, max gear, max weapon, same maxHP=10000, same BL multiplier.
Only difference: tag loadout (the actual skill/strategy lever in v4).

EP table retuned for 10K HP target (ep × 20).
DoT damage doubled.
AI fixed: nukes at 2+ stacks, rotates Pierce.
"""
from dataclasses import dataclass, field
from typing import List, Optional

# ── Formula constants (v4.2 — TTK 10 target + rank-based Wound caps) ────────────
K_DR             = 0.5
AMP_EXP_CAP      = 4
TRUE_DMG_CAP     = 900
TRUE_DMG_FLOOR   = 100
POISON_PCT       = 25
# Drain: single-stack now (like Poison), tick scales with attacker's mastery 0..50 → 50..300
DRAIN_BASE       = 50
DRAIN_PER_LVL    = 5
DRAIN_MAX_TICK   = 300
DR_DOT_SCALE     = 0.5

# Wound is now % of the application hit, capped by jutsu rank:
WOUND_CAP_BY_RANK = {
    "basic": 25,   # basic jutsus — 25% of application damage per tick
    "AB":    30,   # A/B rank bloodline jutsus
    "S":     35,   # S rank
}
WOUND_HARD_CAP_PCT = 60     # absolute ceiling (matches cappedPostDamage in move.ts)

# Buff durations extended to 4 for reliable stack-to-2
STATUS_DURATIONS = {
    "Increase Damage Given":   4,
    "Increase Damage Taken":   4,
    "Decrease Damage Given":   4,
    "Decrease Damage Taken":   4,
}

def status_duration(name: str) -> int:
    return STATUS_DURATIONS.get(name, 2)

def ep_to_raw(ep): return ep * 40      # bumped for TTK 10 target at 10K HP

# Capped-build defaults (10K HP)
CAP = dict(
    max_hp=10000, max_chakra=2000, max_stamina=2000,
    armor_raw_dr=1.0,
    item_damage_pct=15,
    bloodline_mult=1.4,
)

STACKABLE = {
    "Increase Damage Given", "Increase Damage Taken", "Ignition",
    "Decrease Damage Given", "Decrease Damage Taken",
    "Wound",
    "Lifesteal", "Reflect", "Absorb",
    # Drain removed — single-stack now (refresh duration on reapply, scales with mastery)
}

# ── Models ────────────────────────────────────────────────────────────────────
@dataclass
class Status:
    name: str; pct: int = 0; amount: int = 0; rounds: int = 2; kind: str = "negative"
    # Wound stores its per-tick damage on `amount` at application time (% of finalDmg, rank-capped)

@dataclass
class Jutsu:
    name: str; ap: int; ep: int = 0; cd: int = 0
    tags: List[dict] = field(default_factory=list)
    target: str = "enemy"
    pierce: bool = False
    clear: bool = False
    cleanse: bool = False
    rank: str = "basic"     # basic | AB | S — controls Wound % cap

@dataclass
class Fighter:
    name: str
    hp: int = CAP["max_hp"]
    max_hp: int = CAP["max_hp"]
    chakra: int = CAP["max_chakra"]
    max_chakra: int = CAP["max_chakra"]
    armor_raw_dr: float = CAP["armor_raw_dr"]
    item_damage_pct: int = CAP["item_damage_pct"]
    bloodline_mult: float = CAP["bloodline_mult"]
    mastery_level: int = 50      # assumed maxed for capped builds
    statuses: List[Status] = field(default_factory=list)
    cooldowns: dict = field(default_factory=dict)
    jutsus: List[Jutsu] = field(default_factory=list)

def add_status(f: Fighter, s: Status):
    # Stackable types append; everything else (incl. Poison) replaces
    if s.name in STACKABLE:
        f.statuses.append(s)
    else:
        f.statuses = [x for x in f.statuses if x.name != s.name] + [s]

def count(f: Fighter, name: str) -> int:
    return sum(1 for s in f.statuses if s.name == name)

def has(f, name): return count(f, name) > 0

def tick_statuses(f: Fighter):
    for s in f.statuses: s.rounds -= 1
    f.statuses = [s for s in f.statuses if s.rounds > 0]
    for k in list(f.cooldowns):
        f.cooldowns[k] -= 1
        if f.cooldowns[k] <= 0: del f.cooldowns[k]

# ── v4 damage formula ─────────────────────────────────────────────────────────
def amp_mult(att: Fighter, dfn: Fighter) -> float:
    m = 1.0
    n_idg = min(count(att, "Increase Damage Given"), AMP_EXP_CAP); m *= (1.25 ** n_idg)
    n_idt = min(count(dfn, "Increase Damage Taken"), AMP_EXP_CAP); m *= (1.25 ** n_idt)
    n_ign = min(count(dfn, "Ignition"), AMP_EXP_CAP);              m *= (1.25 ** n_ign)
    return m

def raw_dr(att: Fighter, dfn: Fighter) -> float:
    return (dfn.armor_raw_dr
            + count(dfn, "Decrease Damage Taken") * 0.25
            + count(att, "Decrease Damage Given") * 0.25)

def eff_dr(r): return r / (r + K_DR)

def normal_damage(att: Fighter, dfn: Fighter, ep: int) -> int:
    raw = ep_to_raw(ep)
    gear = 1 + att.item_damage_pct / 100
    return int(max(0, raw * gear * att.bloodline_mult * amp_mult(att, dfn) * (1 - eff_dr(raw_dr(att, dfn)))))

def pierce_damage(att: Fighter, ap: int) -> int:
    composite_offense = 7500  # max stats
    ap_factor = max(0.5, ap / 60)
    mastery_factor = 1.25     # mastery 50
    raw = composite_offense * 0.35 * ap_factor * mastery_factor
    return int(max(TRUE_DMG_FLOOR, min(TRUE_DMG_CAP, raw)))

def dot_tick(f: Fighter) -> int:
    own_dr = f.armor_raw_dr + count(f, "Decrease Damage Taken") * 0.25
    edr = eff_dr(own_dr)
    mitigation = 1 - edr * DR_DOT_SCALE
    total = 0
    # Wound: each stack ticks for its stored per-instance amount.
    for s in f.statuses:
        if s.name == "Wound":
            total += s.amount
    # Drain: single-stack, ticks for stored amount (set at application based on attacker mastery)
    for s in f.statuses:
        if s.name == "Drain":
            total += s.amount
    # Poison: single stack only
    if has(f, "Poison"): total += int(f.max_chakra * POISON_PCT / 100)
    return int(total * mitigation)

# ── Jutsu resolution ──────────────────────────────────────────────────────────
def apply_jutsu(att: Fighter, dfn: Fighter, j: Jutsu, log: List[str]):
    # Preventions
    if j.clear:
        if has(dfn, "Clear Prevent"):
            log.append(f"  {dfn.name} blocks Clear (Clear Prevent).")
            return
        before = len(dfn.statuses)
        dfn.statuses = [s for s in dfn.statuses if s.kind != "positive"]
        log.append(f"  {att.name} clears {before - len(dfn.statuses)} buff(s) on {dfn.name}.")
        return
    if j.cleanse:
        if has(att, "Cleanse Prevent"):
            log.append(f"  {att.name} blocks own Cleanse (Cleanse Prevent).")
            return
        before = len(att.statuses)
        att.statuses = [s for s in att.statuses if s.kind != "negative"]
        log.append(f"  {att.name} cleanses {before - len(att.statuses)} debuff(s) from self.")
        return

    # Damage step
    final_dmg = 0
    if j.pierce:
        d = pierce_damage(att, j.ap)
        dfn.hp = max(0, dfn.hp - d)
        final_dmg = d
        log.append(f"  PIERCE {d} dmg → {dfn.name} (HP {dfn.hp}/{dfn.max_hp})")
    elif j.ep > 0:
        d = normal_damage(att, dfn, j.ep)
        dfn.hp = max(0, dfn.hp - d)
        final_dmg = d
        log.append(f"  {j.name} hits for {d} → {dfn.name} (HP {dfn.hp}/{dfn.max_hp})")

    # Tag application
    for tag in j.tags:
        name = tag["name"]; pct = tag.get("pct", 25); target = tag.get("target", "auto")
        if target == "self" or name in {"Increase Damage Given", "Decrease Damage Taken", "Lifesteal", "Reflect", "Absorb", "Debuff Prevent", "Cleanse Prevent"}:
            who = att
        else:
            who = dfn
        if who is dfn and has(dfn, "Debuff Prevent"):
            log.append(f"  {dfn.name}'s Debuff Prevent blocks {name}.")
            continue
        if who is att and name == "Buff Prevent":
            who = dfn

        # Rank-capped Wound: tick amount = finalDmg × min(tag.pct, rank_cap, HARD_CAP) / 100
        amount = 0
        if name == "Wound":
            rank_cap = WOUND_CAP_BY_RANK.get(j.rank, 25)
            effective_pct = min(pct, rank_cap, WOUND_HARD_CAP_PCT)
            amount = int(final_dmg * effective_pct / 100)
        # Mastery-scaled Drain: tick = clamp(50 + masteryLevel * 5, 50, 300). Single-stack.
        elif name == "Drain":
            amount = max(DRAIN_BASE, min(DRAIN_MAX_TICK, DRAIN_BASE + att.mastery_level * DRAIN_PER_LVL))

        s = Status(name=name, pct=pct, amount=amount,
                   rounds=status_duration(name),
                   kind="positive" if who is att else "negative")
        add_status(who, s)
        n_now = count(who, name)
        suffix = f" tick={amount}" if name == "Wound" else (f" +{pct}%" if pct else "")
        log.append(f"  {name}{suffix} → {who.name} (stacks: {n_now})")

# ── AI: pick next jutsu ───────────────────────────────────────────────────────
def choose_jutsu(att: Fighter, dfn: Fighter) -> Optional[Jutsu]:
    available = [j for j in att.jutsus
                 if att.chakra >= max(0, j.ap // 2)
                 and att.cooldowns.get(j.name, 0) == 0]
    if not available: return None
    edr = eff_dr(raw_dr(att, dfn))

    # 1) Clear if opponent has 2+ buffs (reality at 2-turn duration: max 2 stacks)
    for j in available:
        if j.clear and len([s for s in dfn.statuses if s.kind == "positive"]) >= 2: return j

    # 2) Cleanse if I'm heavily debuffed
    for j in available:
        if j.cleanse and len([s for s in att.statuses if s.kind == "negative"]) >= 2: return j

    # 3) Pierce if it's available + better than normal damage
    for j in available:
        if j.pierce:
            # Pierce true dmg > normal nuke dmg vs this defender? Use it.
            best_normal = max((normal_damage(att, dfn, k.ep) for k in available if k.ep > 0), default=0)
            if pierce_damage(att, j.ap) >= best_normal * 0.9:  # within 10% or better
                return j

    # 4) Refresh IDG if expired (count == 0). Otherwise damage with it active.
    if count(att, "Increase Damage Given") == 0:
        for j in available:
            if any(t["name"] == "Increase Damage Given" for t in j.tags):
                return j

    # 5) Apply Wound/Drain/Poison DoT if it's not currently on opponent
    for j in available:
        for t in j.tags:
            if t["name"] in {"Wound", "Drain", "Poison"} and count(dfn, t["name"]) == 0:
                return j

    # 6) Default: highest-EP attack we have available
    return max(available, key=lambda j: j.ep)

# ── Fight loop ────────────────────────────────────────────────────────────────
def fight(a: Fighter, b: Fighter, label: str, max_rounds: int = 25, verbose: bool = True):
    print(f"\n{'='*78}\n  {label}\n{'='*78}")
    log = []
    for rnd in range(1, max_rounds + 1):
        for actor, target in [(a, b), (b, a)]:
            dmg = dot_tick(actor)
            if dmg:
                actor.hp = max(0, actor.hp - dmg)
                log.append(f"R{rnd} {actor.name}: DoT tick {dmg} (HP {actor.hp})")
                if actor.hp <= 0: break
            if actor.hp <= 0 or target.hp <= 0: break
            j = choose_jutsu(actor, target)
            if not j:
                log.append(f"R{rnd} {actor.name}: no jutsu available")
                continue
            actor.cooldowns[j.name] = j.cd
            actor.chakra = max(0, actor.chakra - j.ap // 4)
            log.append(f"R{rnd} {actor.name} casts {j.name}:")
            apply_jutsu(actor, target, j, log)
        if a.hp <= 0 or b.hp <= 0:
            break
        tick_statuses(a); tick_statuses(b)
    winner = a.name if b.hp <= 0 and a.hp > 0 else (b.name if a.hp <= 0 and b.hp > 0 else "draw/timeout")
    if verbose:
        for line in log: print("  " + line)
    print(f"  --- Winner: {winner}   Final HP: {a.name}={a.hp}, {b.name}={b.hp}   Rounds: {rnd}")
    return {"winner": winner, "rounds": rnd, "hp_a": a.hp, "hp_b": b.hp}

# ── Jutsu library (max-cap builds) ────────────────────────────────────────────
def buff_idg():  return Jutsu("BuffIDG",  ap=40, ep=0,  cd=0, tags=[{"name":"Increase Damage Given","pct":25,"target":"self"}])
def buff_ddt():  return Jutsu("BuffDDT",  ap=40, ep=0,  cd=0, tags=[{"name":"Decrease Damage Taken","pct":25,"target":"self"}])
def debuff_idt():return Jutsu("DebuffIDT",ap=50, ep=20, cd=1, tags=[{"name":"Increase Damage Taken","pct":25}])
def ignition():  return Jutsu("Ignition", ap=50, ep=20, cd=1, tags=[{"name":"Ignition","pct":25}])
def wound_strike():return Jutsu("Wound",  ap=50, ep=25, cd=1, tags=[{"name":"Wound","pct":30}], rank="basic")
def wound_AB():    return Jutsu("WoundAB",ap=55, ep=30, cd=1, tags=[{"name":"Wound","pct":30}], rank="AB")
def wound_S():     return Jutsu("WoundS", ap=60, ep=35, cd=2, tags=[{"name":"Wound","pct":35}], rank="S")
def drain_strike():return Jutsu("Drain",  ap=50, ep=30, cd=1, tags=[{"name":"Drain","pct":25}])
def poison():    return Jutsu("Poison",   ap=50, ep=20, cd=2, tags=[{"name":"Poison","pct":25}])
def big_nuke():  return Jutsu("BigNuke",  ap=60, ep=80, cd=2)
def pierce_st(): return Jutsu("Pierce",   ap=60, ep=0,  cd=3, pierce=True)
def clear_act(): return Jutsu("Clear",    ap=60, ep=0,  cd=8, clear=True)
def cleanse_act():return Jutsu("Cleanse", ap=60, ep=0,  cd=8, cleanse=True)
def basic_atk(): return Jutsu("BasicAtk", ap=40, ep=20, cd=0)
def buff_prev(): return Jutsu("BuffPrev", ap=50, ep=20, cd=4, tags=[{"name":"Buff Prevent","pct":0,"target":"enemy"}])

# ── Three matchups ────────────────────────────────────────────────────────────
def make_fighter(name, jutsus): return Fighter(name=name, jutsus=jutsus)

if __name__ == "__main__":
    print("v4 formula sim — both fighters at the cap (5000 HP, 1.4 BL, +15% gear, 1.0 raw armor)")
    print("Only difference: tag-jutsu loadouts.")

    # FIGHT 1 — Stack-burst vs Mirror Stack-burst (same loadout, who wins?)
    A = make_fighter("StackBurst-A", [buff_idg(), buff_idg(), big_nuke(), wound_strike()])
    B = make_fighter("StackBurst-B", [buff_idg(), buff_idg(), big_nuke(), wound_strike()])
    fight(A, B, "FIGHT 1 — Stack-burst Mirror (both stack IDG then nuke)")

    # FIGHT 2 — Stack-burst vs Anti-stack (Clear-heavy counter)
    A = make_fighter("StackBurst", [buff_idg(), buff_idg(), debuff_idt(), big_nuke(), wound_strike()])
    B = make_fighter("AntiStack",  [clear_act(), buff_ddt(), buff_ddt(), big_nuke(), cleanse_act()])
    fight(A, B, "FIGHT 2 — Stack-burst vs Anti-stack (Clear-heavy)")

    # FIGHT 3 — DoT spec (uses A/B-rank Wound, the bloodline jutsu) vs Pierce spec
    A = make_fighter("DoTSpec",   [wound_AB(), drain_strike(), poison(), debuff_idt(), big_nuke()])
    B = make_fighter("PierceSpec",[buff_ddt(), buff_ddt(), pierce_st(), pierce_st(), big_nuke()])
    fight(A, B, "FIGHT 3 — DoT specialist (A/B-rank Wound) vs Pierce specialist")
