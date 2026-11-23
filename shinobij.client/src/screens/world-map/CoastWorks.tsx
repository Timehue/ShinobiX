import type { LandingWork } from "./coast-service";

export function CoastWorks({ works, officer, busy, nameOf, build }: {
    works: LandingWork[]; officer: boolean; busy: boolean;
    nameOf: (item: string) => string; build: (work: LandingWork) => void;
}) {
    if (!works.length) return null;
    return <section className="coast-works" aria-label="Landing works"><h4>Landing works</h4>
        {works.map(work => <details key={work.id}>
            <summary><img src={"/coast-map/landing/" + work.id + "-v1.webp"} alt="" />{work.name}{work.built ? " · Built" : ""}</summary>
            <p>{work.does}</p>
            {!work.built && <>
                <p>{Object.entries(work.cost).map(([id, n]) => n + " " + nameOf(id)).join(", ")}</p>
                {work.needsQuest && <p>Finish {work.quest} to build this work.</p>}
                {work.block === "tier" && <p>Requires {work.needsTier}.</p>}
                {work.block === "stores" && <p>The Landing needs more materials in its stores.</p>}
                {work.block === "dormant" && <p>Pay the upkeep to wake the Landing.</p>}
                {officer && <button type="button" disabled={busy || !work.canBuild} onClick={() => build(work)}>Build {work.name}</button>}
            </>}
        </details>)}
    </section>;
}
