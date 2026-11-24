import { useEffect, useState } from "react";
import type { CoastFloor } from "../../../../shared/coast-world-rules";
import CoastInterior from "./CoastInterior";
import unmoored from "../../assets/village-war/owned-sector-unmoored.webp";
import clan from "../../assets/village-war/owned-sector-clan-neutral.webp";

type Plan = { name: string; scene: string; sprite: string; description: string; floors: CoastFloor[] };
export default function CoastLandingPlans({ avatar, name, leave, tier, player }: { player: import('../../types/character').Character; tier?: number; avatar?: string | null; name: string; leave: () => void }) {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState(tier ? tier - 1 : 0);
    const [inside, setInside] = useState(!!tier);
    useEffect(() => {
        const controller = new AbortController();
        fetch("/coast-landing/plans.json", { signal: controller.signal }).then(response => {
            if (!response.ok) throw Error("Plan request failed");
            return response.json() as Promise<Plan[]>;
        }).then(setPlans).catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [attempt]);
    const plan = plans[selected];
    if (!plan) return <div className="coast-site-body">{failed
        ? <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry loading plans</button>
        : <p role="status">Opening the building plans…</p>}</div>;
    if (inside) return <CoastInterior player={player} floors={plan.floors} avatar={avatar} name={name} leave={leave} />;
    return <>
        <img className="coast-site-scene" src={plan.scene} alt={plan.name} />
        <div className="coast-site-body">
            <h3>Clan Landing plans</h3>
            <div className="coast-list">{plans.map((entry, index) => <button key={entry.name} type="button" aria-pressed={selected === index}
                onClick={() => setSelected(index)}><img src={entry.sprite} width="44" height="44" alt="" />{entry.name}</button>)}</div>
            <p>{plan.description}</p>
            <button type="button" onClick={() => setInside(true)}>Walk through {plan.name}</button>
            <details><summary>Ownership banners</summary>
                <figure><img src={clan} width="96" height="96" alt="" /><figcaption>Clan-held plot</figcaption></figure>
                <figure><img src={unmoored} width="96" height="96" alt="" /><figcaption>Unmoored-held plot</figcaption></figure>
            </details>
            <button type="button" onClick={leave}>Return to the plot</button>
        </div>
    </>;
}
