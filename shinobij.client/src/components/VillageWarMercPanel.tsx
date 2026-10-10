import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/character";
import { visiblePoll } from "../lib/poll";
import { useSharedNow } from "../lib/use-shared-now";
import {
    deployMerc,
    hireMerc,
    listMercs,
    newMercRequestId,
    type MercContextView,
    type MercLeaseView,
    type MercListView,
    type WrMercTierView,
} from "../lib/village-war-map";
import { busyLabel, wrAffordability } from "../lib/village-war-map-ui";
import {
    MERC_RULES_LINES,
    groupMercBands,
    mercAllowanceLine,
    mercBandLine,
    mercContextTime,
    mercContextTitle,
    mercTierCost,
    withMercRetry,
} from "../lib/village-war-merc-panel";
import { mercPortrait } from "../lib/merc-ai";
import { mercTierName } from "../lib/merc-roam-client";
import { gameToast } from "./GameToast";
import { GameArtIcon } from "./GameArtIcon";

// ─── War Map mercenaries (owner redesign 2026-10-08) ────────────────────────
// Moved out of screens/VillageWarMap.tsx. A band is hired FOR one war — the
// village's all-out village war (Kage seat 3 hires, each Elder seat 1) or a
// Combat sector war the village DEFENDS (3 hires per contest) — and fights only
// there. Everything shown comes from /api/village/war-merc `list`, including
// the price the server will actually charge and the hires left; the server
// re-checks every rule on hire and deploy.

const LIST_POLL_MS = 30_000;

export function VillageWarMercPanel({ character, onChanged }: { character: Character; onChanged?: () => unknown }) {
    const village = (character.village ?? "").trim();
    const [data, setData] = useState<MercListView | null>(null);
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [targets, setTargets] = useState<Record<string, string>>({});
    const now = useSharedNow();

    const load = useCallback(async () => {
        try {
            setData(await listMercs(character.name, village));
        } catch { /* mercs are best-effort (feature off / not a war village / not a member) */ }
    }, [character.name, village]);

    useEffect(() => visiblePoll(load, LIST_POLL_MS, 0.1, { immediate: true }), [load]);

    const act = useCallback(async (label: string, fn: () => Promise<void>) => {
        setBusy(label);
        setError("");
        try {
            await fn();
            await load();
            await onChanged?.();
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setBusy("");
        }
    }, [load, onChanged]);

    if (!data) return null;
    const tiers = data.tiers ?? [];
    const contexts = data.contexts ?? [];
    const canHire = data.viewer?.canHire === true;
    const pool = data.warResources ?? 0;
    const groups = groupMercBands(data.leases ?? [], contexts);

    const hire = (c: MercContextView, t: WrMercTierView) => act(`hire-${c.key}-${t.id}`, async () => {
        // One id per click, reused by every retry of THIS click: a lost response
        // replays the first hire instead of paying for a second.
        const requestId = newMercRequestId();
        const context = c.kind === "sector" && c.contestId ? { kind: "sector" as const, contestId: c.contestId } : { kind: "village" as const };
        const r = await withMercRetry(() => hireMerc(character.name, village, t.id, context, requestId));
        gameToast(r.replayed
            ? `That ${mercTierName(t.id)} band was already hired — nothing more was spent.`
            : `${mercTierName(t.id)} band hired for ${mercContextTitle(c)} — ${Math.max(0, Number(r.cost) || 0).toLocaleString()} WR.`);
    });

    const deploy = (band: MercLeaseView) => act(`deploy-${band.id}`, async () => {
        const target = (targets[band.id ?? ""] ?? "").trim();
        const r = await deployMerc(character.name, village, band.id ?? "", target);
        const outcome = r.winner === "merc" ? "the band won" : r.winner === "player" ? `${target} cut the mercenary down` : "neither side fell";
        gameToast(`Sector ${band.sector ?? "?"}: ${outcome} — war score ${r.attackerPoints ?? "?"} : ${r.defenderPoints ?? "?"}, ${r.mercsRemaining ?? 0} merc(s) left.`);
    });

    return (
        <div className="card vwm-mercs">
            <h3>Mercenaries</h3>
            {MERC_RULES_LINES.map((line) => <p key={line} className="hint">{line}</p>)}
            {!canHire && (
                <p className="hint" style={{ color: "#fbbf24" }}><GameArtIcon kind="crown" size={16} /> Only your seated Kage or a current Elder can hire and send mercenaries.</p>
            )}
            {contexts.length === 0 && (
                <p className="hint">No war to hire for right now. Bands can be hired during your village's all-out war, or to defend a Combat sector an enemy is attacking.</p>
            )}
            {(data.attacking ?? []).map((a) => (
                <p key={a.contestId} className="hint">Your village is attacking Sector {a.sector} — only {a.enemy}, the defender, can field mercenaries there.</p>
            ))}
            {contexts.map((c) => (
                <div key={c.key} className="vwm-merc-context">
                    <h4>{mercContextTitle(c)} · {mercContextTime(c, now)}</h4>
                    <p className="hint">{mercAllowanceLine(c, canHire)}</p>
                    <div className="vwm-merc-tiers">
                        {tiers.map((t) => {
                            const id = `hire-${c.key}-${t.id}`;
                            const portrait = mercPortrait(t.id);
                            const afford = wrAffordability(mercTierCost(t), pool, { verb: "Hire" });
                            const outOfHires = canHire && c.callerHiresLeft <= 0;
                            return (
                                <div key={t.id} className="vwm-merc-tier">
                                    {portrait && <img className="vwm-merc-portrait" src={portrait} alt={t.id} />}
                                    <div className="vwm-merc-name">{mercTierName(t.id)} · L{t.level}</div>
                                    <button
                                        disabled={!canHire || outOfHires || !!busy || !afford.affordable}
                                        title={!canHire ? "Only the seated Kage or a current Elder can hire mercenaries" : undefined}
                                        onClick={() => void hire(c, t)}
                                    >
                                        {outOfHires ? "No hires left" : busyLabel(busy, id, "Hiring…", afford.label)}
                                    </button>
                                    {t.band ? <div className="vwm-merc-band">{t.band} mercs · 2-day contract</div> : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
            {groups.length > 0 && (
                <div className="vwm-merc-bands">
                    <h4>Your bands</h4>
                    {groups.map((g) => (
                        <div key={g.key} className="vwm-contest-row">
                            <b>{g.title}</b>
                            {g.bands.map((band) => (
                                <div key={band.id ?? `${band.tierId}:${band.player}`}>
                                    <span className="vwm-merc-band">{mercBandLine(band, mercTierName(band.tierId), now)}</span>
                                    {band.deployable && band.id && (
                                        <div className="vwm-merc-deploy">
                                            <input
                                                placeholder="attacking player"
                                                aria-label={`Send a ${mercTierName(band.tierId)} at`}
                                                value={targets[band.id] ?? ""}
                                                disabled={!!busy}
                                                onChange={(e) => setTargets((s) => ({ ...s, [band.id as string]: e.target.value }))}
                                            />
                                            <button
                                                disabled={!!busy || !(targets[band.id] ?? "").trim()}
                                                onClick={() => void deploy(band)}
                                            >{busyLabel(busy, `deploy-${band.id}`, "Deploying…", "Send a merc")}</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            {error && (
                <p className="vwm-error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="vwm-error-dismiss" onClick={() => setError("")} aria-label="Dismiss this message">Dismiss</button>
                </p>
            )}
        </div>
    );
}
