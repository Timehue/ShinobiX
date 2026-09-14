import { ELEMENT_TINT, elementCrest, KIND_FAMILY } from './presentation-tokens';
import {
    type ShowdownIconName,
    ShowdownIcon,
} from "../icons/ShowdownIcon";
import {
    type ShowdownPetView,
} from "../../lib/pet-showdown-api";
import {
    SHOWDOWN_ELEMENT_BEATS,
} from "../../../../shared/pet-showdown-contract";

const STATUS_GLYPH: Record<string, ShowdownIconName> = {
    burn: "pyre", wound: "rend", stun: "bind", freeze: "frost", confuse: "daze",
    debuff: "wane", buff: "wax", shield: "aegis", mark: "mark", slow: "drag",
    haste: "haste", crush: "crush", taunt: "provoke", steadfast: "steadfast",
    protect: "brace",
    // The bench is what a root denies, so the bench is what it wears.
    movelock: "bench",
};

/** Plain English for every status the view can actually carry. `tauntGuard` is
 *  unreachable (the engine renames it in 1v1). `movelock` USED to be unreachable
 *  too — the engine aliased it to `slow` — until it became a real trap. */
const STATUS_TITLE: Record<string, string> = {
    burn: "Burning — takes damage each round",
    wound: "Wounded — bleeds each round and heals for less",
    stun: "Stunned — loses its next action",
    freeze: "Frozen — may lose its next action",
    confuse: "Confused — may hit itself instead",
    debuff: "Weakened — deals less damage",
    buff: "Empowered — deals more damage",
    shield: "Shielded — absorbs incoming damage",
    mark: "Marked — the next hit lands harder",
    slow: "Slowed — acts later in the round",
    movelock: "Trapped — cannot switch out",
    protect: "Braced — blocks all damage this round",
    haste: "Hastened — acts earlier in the round",
    crush: "Crushed — defence lowered",
    taunt: "Taunting — draws single-target attacks",
    steadfast: "Steadfast — immune to stun and freeze",
};

function statusTitle(s: { kind: string; rounds: number; magnitude: number }): string {
    const base = STATUS_TITLE[s.kind] ?? s.kind;
    const pool = s.kind === "shield" && s.magnitude > 0 ? ` (${s.magnitude} left)` : "";
    return `${base}${pool} · ${s.rounds} round${s.rounds === 1 ? "" : "s"}`;
}

// ─── Team panel (DOM) ────────────────────────────────────────────────────────

interface DisplayEntry { hp: number; stamina: number; meter: number; ko: boolean; guarding: boolean; statuses: { kind: string; rounds: number; magnitude: number }[] }

/** The one numeral treatment, reused for every ratio in the HUD.
 *
 *  Numerals NEVER tween — the value snaps to what the server sent the instant it
 *  arrives, and only the bar animates. A counting tween would put numbers on
 *  screen that no event ever carried.
 *
 *  Enemy readouts show a PERCENTAGE rather than absolutes: it is honest about
 *  what the client legitimately knows, and it separates the two plate stacks
 *  without spending a second colour. Both values are already server-sent, so
 *  this implies nothing new. */
function Num({ cur, max, pct }: { cur: number; max: number; pct?: boolean }) {
    const safeMax = Math.max(1, Math.round(max));
    const safeCur = Math.max(0, Math.round(cur));
    if (pct) {
        return <span className="sd-num pct">{Math.round((safeCur / safeMax) * 100)}<i>%</i></span>;
    }
    return <span className="sd-num">{safeCur}<i>/{safeMax}</i></span>;
}

/** A single ornate status plate: portrait, name/level/element, HP and Stamina
 *  read out as `cur / max`, then the signature meter. Bench members render the
 *  same plate at a reduced size so the team is always legible at a glance.
 *
 *  Plates are READOUTS, not the primary controls — you target by clicking the
 *  creature itself. The plate is still focusable while it is a legal target so
 *  keyboard players keep a path to the same choice. */
function StatusPlate({ pet, d, side, benched, clickable, onPick, commanding, hintElement, art, hovered }: {
    pet: ShowdownPetView;
    d: DisplayEntry;
    side: "player" | "enemy";
    benched: boolean;
    clickable: boolean;
    onPick?: (petId: string) => void;
    commanding: boolean;
    hintElement?: string;
    art?: string;
    hovered: boolean;
}) {
    const hpPct = Math.max(0, (d.hp / Math.max(1, pet.maxHp)) * 100);
    const stPct = Math.max(0, (d.stamina / Math.max(1, pet.maxStamina)) * 100);
    const showHint = !!hintElement && !d.ko && !benched;
    const strong = showHint && SHOWDOWN_ELEMENT_BEATS[hintElement!] === pet.element;
    const weak = showHint && SHOWDOWN_ELEMENT_BEATS[pet.element] === hintElement;
    const tint = ELEMENT_TINT[pet.element] ?? ELEMENT_TINT.None;
    const Tag = clickable ? "button" : "div";
    return (
        <Tag
            type={clickable ? "button" : undefined}
            onClick={clickable && onPick ? () => onPick(pet.id) : undefined}
            className={[
                "showdown-plate", side,
                d.ko ? "ko" : "",
                benched ? "benched" : "",
                clickable ? "targetable" : "",
                hovered ? "hovered" : "",
                commanding ? "commanding" : "",
                // Threshold recolours the FILL only; the channel and the gloss
                // ramp never change, so the bar keeps its character as it drains.
                d.ko ? "" : hpPct < 20 ? "hp-low" : hpPct <= 50 ? "hp-mid" : "",
            ].join(" ")}
            style={{ "--plate-tint": tint } as React.CSSProperties}
        >
            <span className="showdown-plate-portrait">
                {art
                    ? <img src={art} alt="" loading="lazy" />
                    : <ShowdownIcon name={elementCrest(pet.element)} size={20} />}
                {d.ko && <span className="showdown-plate-ko"><ShowdownIcon name="ko-stamp" size={26} title="Knocked out" /></span>}
            </span>
            <span className="showdown-plate-body">
                <span className="showdown-plate-title">
                    <span className="showdown-plate-name">{pet.name}</span>
                    <span className="showdown-plate-lv">Lv{pet.level}</span>
                    <span className="showdown-plate-elem" style={{ color: tint }}>
                        <ShowdownIcon name={elementCrest(pet.element)} size={14} title={pet.element} />
                    </span>
                </span>
                <span className="showdown-plate-bar hp">
                    <span className="showdown-plate-key"><ShowdownIcon name="hp" size={12} title="Health" /></span>
                    <span className="showdown-plate-track">
                        {/* The chip layer drains SLOWLY behind the instant fill —
                            the classic "damage you just took" read. */}
                        <span className="chip" style={{ width: `${hpPct}%` }} />
                        <span className="fill" style={{ width: `${hpPct}%` }} />
                    </span>
                    <Num cur={d.hp} max={pet.maxHp} pct={side === "enemy"} />
                </span>
                <span className="showdown-plate-bar en">
                    <span className="showdown-plate-key"><ShowdownIcon name="stamina" size={12} title="Stamina" /></span>
                    <span className="showdown-plate-track">
                        <span className="fill" style={{ width: `${stPct}%` }} />
                    </span>
                    <Num cur={d.stamina} max={pet.maxStamina} pct={side === "enemy"} />
                </span>
                <span className={`showdown-plate-meter ${d.meter >= 100 ? "full" : ""}`}
                    role="meter" aria-label={`${pet.name} signature charge`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, d.meter))}>
                    <span style={{ width: `${Math.max(0, Math.min(100, d.meter))}%` }} />
                </span>
                <span className="showdown-plate-tags">
                    {!d.ko && !benched && <span className={`showdown-charge-tag ${d.meter >= 100 ? "full" : ""}`} title="Signature charge — fill the meter to unlock your finisher">
                        <ShowdownIcon name="signature" size={11} />{d.meter >= 100 ? "SIG FULL" : `SIG ${Math.round(d.meter)}%`}
                    </span>}
                    {d.guarding && !d.ko && <span className="showdown-guard-tag"><ShowdownIcon name="brace" size={11} />GUARD</span>}
                    {/* The matchup readout is gated on the ELEMENT being known,
                        never on the plate being a click target — it used to
                        require multi-target mode, so in 1v1 (the format whose
                        blurb sells the wheel) it could never render at all.
                        Word + crest, never colour alone. */}
                    {strong && (
                        <span className="showdown-matchup up" title={`Your ${hintElement} beats ${pet.element}`}>
                            <ShowdownIcon name={elementCrest(hintElement!)} size={11} />STRONG
                        </span>
                    )}
                    {weak && (
                        <span className="showdown-matchup down" title={`${pet.element} resists your ${hintElement}`}>
                            <ShowdownIcon name={elementCrest(pet.element)} size={11} />RESISTED
                        </span>
                    )}
                    {benched && !d.ko && (
                        <span className="showdown-bench-tag" title="Waiting on the bench">
                            <ShowdownIcon name="bench" size={11} />BENCH
                        </span>
                    )}
                    {pet.skipsNextAction && !d.ko && (
                        <span className="showdown-skip-tag" title="Loses its next action">
                            <ShowdownIcon name="action-lost" size={11} />SKIP
                        </span>
                    )}
                    {side === "player" && pet.trait && <span className="showdown-kit-chip trait" title="Trait">{pet.trait}</span>}
                    {side === "player" && pet.gearName && <span className="showdown-kit-chip gear" title="Equipped gear">{pet.gearName}</span>}
                    {/* Present only while the charge is live — the server stops
                        publishing it once spent, so no client bookkeeping. */}
                    {side === "player" && pet.consumableName && <span className="showdown-kit-chip consum" title="Battle item — one use">{pet.consumableName}</span>}
                    {d.statuses.map((s) => (
                        <span key={s.kind} className={`showdown-status-pip fam-${KIND_FAMILY[s.kind] ?? "ctl"}`} title={statusTitle(s)} aria-label={statusTitle(s)}>
                            <ShowdownIcon name={STATUS_GLYPH[s.kind] ?? "mark"} size={12} />
                            <span className="showdown-status-label">{(STATUS_TITLE[s.kind] ?? s.kind).split(" — ")[0]}</span>
                            <b>{s.rounds}</b>
                        </span>
                    ))}
                </span>
            </span>
        </Tag>
    );
}

function TeamPanel({ side, pets, display, targeting, onPickTarget, commanderId, hintElement, art, benchedIds, benchPicking, onPickBench, hoveredId }: {
    side: "player" | "enemy";
    pets: ShowdownPetView[];
    display: Record<string, DisplayEntry>;
    targeting: boolean;
    onPickTarget?: (petId: string) => void;
    commanderId?: string | null;
    /** While targeting: the commander's element, for the STRONG/RESISTED badge. */
    hintElement?: string;
    /** petId → portrait/card art url. */
    art?: Record<string, string>;
    /** Which team members currently wait on the bench. */
    benchedIds?: ReadonlySet<string>;
    /** Switch flow: bench plates become the pick targets. */
    benchPicking?: boolean;
    onPickBench?: (petId: string) => void;
    /** Mirrors the creature the pointer is over in the 3D scene. */
    hoveredId?: string | null;
}) {
    // The bench stays OFF the field until the Switch flow asks for it. A
    // standing row of reserve plates was chrome the stage paid for every
    // round, to present a choice that exists only inside one action — and for
    // the ENEMY side it also leaked the full reserve roster, where a count is
    // all the opponent has earned. The count survives as pips.
    const benchHidden = pets.filter((pet) => (benchedIds?.has(pet.id) ?? false)
        && !(benchPicking && side === "player"));
    return (
        <div className={`showdown-team-panel ${side}`}>
            {pets.map((pet) => {
                const d = display[pet.id] ?? { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, guarding: pet.guarding, statuses: pet.statuses };
                const benched = benchedIds?.has(pet.id) ?? false;
                if (benched && !(benchPicking && side === "player")) return null;
                const clickable = !d.ko && (benchPicking ? benched : targeting && !benched);
                return (
                    <StatusPlate
                        key={pet.id}
                        pet={pet}
                        d={d}
                        side={side}
                        benched={benched}
                        clickable={clickable}
                        onPick={benchPicking ? onPickBench : onPickTarget}
                        commanding={commanderId === pet.id}
                        hintElement={hintElement}
                        art={art?.[pet.id]}
                        hovered={hoveredId === pet.id}
                    />
                );
            })}
            {benchHidden.length > 0 && (
                <span
                    className="showdown-reserve-pips"
                    title={side === "player" ? "Reserves — press Switch to send one in" : "Enemy reserves"}
                    aria-label={`${benchHidden.length} reserve${benchHidden.length > 1 ? "s" : ""} waiting`}
                >
                    {benchHidden.map((pet) => <i key={pet.id} className={(display[pet.id]?.ko ?? pet.ko) ? "down" : ""} aria-hidden="true" />)}
                </span>
            )}
        </div>
    );
}

export {
    type DisplayEntry,
    TeamPanel,
};
