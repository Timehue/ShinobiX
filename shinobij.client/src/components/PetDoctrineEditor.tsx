// ─────────────────────────────────────────────────────────────────────────────
// PetDoctrineEditor.tsx — author a pet's standing orders
// (docs/pet-coliseum-player-control-plan.md §11).
//
// These are the orders the pet follows when its owner is NOT commanding it: a
// sector-war garrison, or a live duel whose player dropped. The screen is framed
// as briefing a pet you are about to leave somewhere, because that is what it is.
//
// Kept deliberately small. A doctrine that needed a spreadsheet would be a worse
// answer than the AI it replaces — three decisions is enough to express a plan
// without turning garrisoning into homework.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import type { Pet } from "../types/pet";
import {
    parseDoctrine, DEFAULT_DOCTRINE,
    type PetDoctrine, type DoctrineBreakRule,
} from "../lib/pet-duel-doctrine";

export type PetDoctrineEditorProps = {
    pet: Pet;
    onChange: (doctrine: PetDoctrine) => void;
};

const STANCES = [
    { value: 0, label: "Press", hint: "Close the distance and commit." },
    { value: 1, label: "Balance", hint: "Fight to its own judgement." },
    { value: 2, label: "Guard", hint: "Hold range and read the telegraph." },
] as const;

const BREAK_RULES: ReadonlyArray<{ value: DoctrineBreakRule; label: string; hint: string }> = [
    { value: "ready", label: "As soon as it fills", hint: "Simple, and rarely wrong." },
    { value: "foeBloodied", label: "Once they're under half", hint: "Holds the signature for a real opening." },
    { value: "finisher", label: "For the kill", hint: "Also fires if your pet is about to go down." },
    { value: "never", label: "Never", hint: "Fights without its signature at all." },
];

export function PetDoctrineEditor({ pet, onChange }: PetDoctrineEditorProps) {
    // The engine fights with the first four jutsu, with the signature guaranteed a
    // slot. The signature is spent by the Bond rule, not ordered directly, so it is
    // not offered here.
    const slots = useMemo(() => (pet.jutsus ?? []).slice(0, 4)
        .map((jutsu, index) => ({ jutsu, index }))
        .filter(({ jutsu }) => !jutsu.signature), [pet.jutsus]);
    const doctrine = useMemo(() => parseDoctrine(pet.doctrine, Math.max(4, pet.jutsus?.length ?? 4)), [pet.doctrine, pet.jutsus]);

    const setStance = (stance: number) => onChange({ ...doctrine, stance });
    const setBreak = (breakAt: DoctrineBreakRule) => onChange({ ...doctrine, breakAt });
    const togglePriority = (slot: number) => {
        const at = doctrine.priority.indexOf(slot);
        // Clicking a listed move removes it; clicking an unlisted one appends it.
        // Order IS the priority, so appending is the only sensible insert.
        const priority = at >= 0
            ? doctrine.priority.filter((s) => s !== slot)
            : [...doctrine.priority, slot];
        onChange({ ...doctrine, priority });
    };

    const unbriefed = doctrine.priority.length === 0 && doctrine.stance === DEFAULT_DOCTRINE.stance;

    return (
        <div className="summary-box" data-testid="pet-doctrine-editor" style={{ padding: "0.9rem" }}>
            <h3 style={{ marginTop: 0 }}>📋 Standing orders</h3>
            <p className="hint" style={{ marginTop: 2 }}>
                What {pet.nickname ?? pet.name} does when you are not there to command it — holding a
                sector, or if your connection drops mid-duel.
            </p>

            <div style={{ marginTop: 12 }}>
                <div style={{ font: "800 11px/1 var(--font-display), Inter, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>Stance</div>
                <div className="menu" style={{ marginTop: 6, gap: 6 }}>
                    {STANCES.map((s) => (
                        <button
                            key={s.value}
                            type="button"
                            aria-pressed={doctrine.stance === s.value}
                            title={s.hint}
                            className={doctrine.stance === s.value ? "admin-button" : undefined}
                            onClick={() => setStance(s.value)}
                        >{s.label}</button>
                    ))}
                </div>
            </div>

            <div style={{ marginTop: 14 }}>
                <div style={{ font: "800 11px/1 var(--font-display), Inter, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>
                    Move priority
                </div>
                <p className="hint" style={{ marginTop: 4 }}>
                    Tap in the order you want them tried. Anything you leave out is left to the pet's own judgement.
                </p>
                <div className="menu" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
                    {slots.length === 0 && <span className="hint">This pet has no ordinary moves to prioritise.</span>}
                    {slots.map(({ jutsu, index }) => {
                        const rank = doctrine.priority.indexOf(index);
                        return (
                            <button
                                key={`${jutsu.name}-${index}`}
                                type="button"
                                aria-pressed={rank >= 0}
                                className={rank >= 0 ? "admin-button" : undefined}
                                onClick={() => togglePriority(index)}
                            >
                                {rank >= 0 ? `${rank + 1}. ` : ""}{jutsu.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div style={{ marginTop: 14 }}>
                <div style={{ font: "800 11px/1 var(--font-display), Inter, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>
                    Spend Bond Break
                </div>
                <div className="menu" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
                    {BREAK_RULES.map((r) => (
                        <button
                            key={r.value}
                            type="button"
                            aria-pressed={doctrine.breakAt === r.value}
                            title={r.hint}
                            className={doctrine.breakAt === r.value ? "admin-button" : undefined}
                            onClick={() => setBreak(r.value)}
                        >{r.label}</button>
                    ))}
                </div>
            </div>

            {unbriefed && (
                <p className="hint" style={{ marginTop: 12 }}>
                    No orders set — this pet fights exactly as it always has. Briefing it does not make it
                    stronger, it makes it fight your way.
                </p>
            )}
        </div>
    );
}
