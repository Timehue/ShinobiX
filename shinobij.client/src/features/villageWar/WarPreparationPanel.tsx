import { useCallback, useEffect, useRef, useState } from 'react';
import { preparationMaxTier, preparationTreasuryCost, preparationUpkeep, WAR_PREPARATION_DEFS, type WarPreparation } from '../../../../shared/war-preparations';
import { RYO_PER_WR } from '../../../../shared/war-treasury-costs';
import { clearWarMapCache, fetchWarMap, upgradeWarStructure, type VillageWarMapView } from '../../lib/village-war-map';
import { treasuryAffordability } from '../../lib/village-war-map-ui';
import { visiblePoll } from '../../lib/poll';
import { useSharedNow } from '../../lib/use-shared-now';
import { STRUCTURE_IMAGES } from '../../data/war-ui-images';
import './war-preparations.css';

export function WarPreparationPanel({ playerName, village, isKage }: { playerName: string; village: string; isKage: boolean }) {
    const [view, setView] = useState<VillageWarMapView | null>(null);
    const [selected, setSelected] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const serial = useRef(0), pending = useRef(false);
    const now = useSharedNow();
    const invalidate = useCallback(() => { ++serial.current; }, []);
    const load = useCallback(async () => {
        if (pending.current) return;
        const ticket = ++serial.current;
        try {
            const data = await fetchWarMap();
            if (ticket === serial.current) { setView(data.villages.find(v => v.village === village && !v.restricted) ?? null); setError(''); }
        } catch (e) { if (ticket === serial.current) setError(e instanceof Error ? e.message : 'Could not read war preparations.'); }
    }, [village]);
    useEffect(() => { const stop = visiblePoll(load, 15_000, 0.1, { immediate: true }); return () => { invalidate(); stop(); }; }, [load, invalidate]);
    const wars = (view?.preparations ?? []).filter(p => p.endsAt > now);
    const war = wars.find(p => p.instance === selected) ?? wars[0];
    // Tiers also cost treasury ryo and Bone Charms (2026-10 rebalance), at the
    // rate the server sent; the shared default only when it sent none.
    const perWr = Number.isFinite(Number(view?.ryoPerWr)) ? Number(view?.ryoPerWr) : RYO_PER_WR;
    const ladder = [0, 1, 2].map(tier => preparationTreasuryCost(tier, perWr));
    const priceLine = `Three tiers · ${ladder.map(q => q.wr).join(' / ')} WR`
        + (ladder[0].ryo > 0 ? `, plus ${ladder.map(q => q.ryo.toLocaleString()).join(' / ')} treasury ryo and ${ladder.map(q => q.boneCharms).join(' / ')} Bone Charms` : '');
    async function upgrade(p: WarPreparation, key: typeof WAR_PREPARATION_DEFS[number]['key']) {
        if (pending.current) return;
        pending.current = true; setBusy(true); ++serial.current; setError('');
        let purchaseError = '';
        try { await upgradeWarStructure(playerName, village, key, p.levels[key] + 1, p.instance); }
        catch (e) { purchaseError = e instanceof Error ? e.message : 'Purchase could not be confirmed. Refresh before trying again.'; }
        finally { pending.current = false; setBusy(false); clearWarMapCache(); await load(); if (purchaseError) setError(purchaseError); }
    }
    return <section className='war-preparations summary-box' aria-label='Individual war preparations'>
        <h3>War preparations</h3>
        <p>Watchtower, Barracks and War Academy serve one war. {priceLine} · Expire when that war ends.</p>
        {error && <p role='alert'>{error}</p>}
        {!view ? <p role='status'>Reading the war chest…</p> : !war ? <p>No active war. Permanent Supply Depot and Treasury Vault projects are in Town Hall → Upgrades.</p> : <>
            <label>Prepare for <select aria-label='War to prepare for' value={war.instance} disabled={busy} onChange={e => setSelected(e.target.value)}>
                {wars.map(p => <option key={p.instance} value={p.instance}>{p.kind === 'village' ? 'Village war' : `Sector ${p.sector}`} vs {p.enemy}</option>)}
            </select></label>
            <p>{(view.warResources ?? 0).toLocaleString()} WR available · {preparationUpkeep(war.levels)} WR/day upkeep · Ends {new Date(war.endsAt).toLocaleString()}</p>
            {view.treasuryRyo !== undefined && <p>Treasury: {view.treasuryRyo.toLocaleString()} ryo · {(view.treasuryBoneCharms ?? 0).toLocaleString()} Bone Charms</p>}
            {view.dormant && <p role='status'>Buildings are dormant: bonuses resume after upkeep is funded.</p>}
            <div className='war-preparation-grid'>{WAR_PREPARATION_DEFS.map(def => {
                const tier = war.levels[def.key], max = preparationMaxTier(war.kind, def.key);
                // The server's quote for the next tier, else the shared price at its rate.
                const quote = war.nextCost?.[def.key] ?? preparationTreasuryCost(tier, perWr), cost = quote.wr;
                const ryoShort = !treasuryAffordability(quote.ryo, view.treasuryRyo, 'ryo').affordable;
                const charmShort = !treasuryAffordability(quote.boneCharms, view.treasuryBoneCharms, 'Bone Charms').affordable;
                const price = [`${cost} WR`, ...(quote.ryo > 0 ? [`${quote.ryo.toLocaleString()} ryo`] : []), ...(quote.boneCharms > 0 ? [`${quote.boneCharms} BC`] : [])].join(' · ');
                return <article key={def.key}><h4><img src={STRUCTURE_IMAGES[def.key]} alt='' />{def.name} <small>Tier {tier}/{max}</small></h4>
                    <p>{war.kind === 'sector' && def.key === 'watchtower' ? 'Reports attacks in this contested sector. One tier; extra Espionage tiers apply only to village campaigns.' : def.description}</p>
                    {isKage && <button disabled={busy || tier >= max || (view.warResources ?? 0) < cost || ryoShort || charmShort} onClick={() => void upgrade(war, def.key)}>
                        {tier >= max ? `${def.name} complete` : busy ? 'Updating preparations…' : ryoShort || charmShort ? `Treasury short · ${price}` : `Upgrade ${def.name} · ${price}`}
                    </button>}
                </article>;
            })}</div>
            {!isKage && <p>Only the seated Kage can purchase preparations.</p>}
            <p>Academy: +{war.levels.warAcademy * 10}% supporting points. {war.kind === 'village' ? 'PvE contributes at most 20% of the final score; first daily Espionage success gains bonus intel.' : 'Garrison support keeps its existing cap; mercenary discounts apply only to Combat sector defense.'} Human PvP awards stay fixed.</p>
            {war.alerts.length > 0 && <><h4>Watchtower reports</h4><ul>{war.alerts.slice(-5).reverse().map(a => <li key={a.id}>Sector {a.sector} · {a.mode === 'combat' ? 'PvP combat' : a.mode === 'pet' ? 'Pet battle' : 'Card battle'} assault · {new Date(a.at).toLocaleTimeString()}</li>)}</ul></>}
        </>}
    </section>;
}
