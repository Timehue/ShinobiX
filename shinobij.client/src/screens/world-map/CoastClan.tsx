import { HallLivery, HallPainting } from "./HallLivery";
import { DEFAULT_HALL, type HallStyle } from "../../../../shared/coast-hall-style";
import { useEffect, useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../../types/character";
import { requestAiFight } from "../../lib/ai-fight-request";
import clanBanner from "../../assets/village-war/owned-sector-clan-neutral.webp";
import freeBanner from "../../assets/village-war/owned-sector-unmoored.webp";
import { CoastError, coastMessage, coastPost, useCoastGround, type Mutation } from "./coast-service";

import { CoastWorks } from "./CoastWorks";
import { weatherEffects } from "../../data/world";

const fallbackName = (id: string) => id.replace(/^(gather|quest)-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const time = (date: number) => new Date(date).toLocaleString();
// The four schools a holding clan can favour on its ground. The server's ids are these with "Offense" after them.
const SCHOOLS = ["Bukijutsu", "Taijutsu", "Ninjutsu", "Genjutsu"];
const schoolId = (school: string) => school.toLowerCase() + "Offense";
const schoolOf = (id?: string) => SCHOOLS.find(school => schoolId(school) === id);
type Gift = { itemId: string; count: number; requestId: string };
function savedGift(key: string): Gift | null {
    try { return JSON.parse(sessionStorage.getItem(key) ?? "null") as Gift | null; } catch { return null; }
}

type CoastClanProps = {
    character: Character; sector?: number; commit: VersionedCharacterCommit; enter?: (tier: number) => void; plot?: boolean;
};
export default function CoastClan(props: CoastClanProps) {
    const ground = useCoastGround(props.character.name);
    return <CoastClanPanel {...props} ground={ground} />;
}
export function CoastClanPanel({ character, sector, commit, enter, plot = false, ground }: CoastClanProps & { ground: ReturnType<typeof useCoastGround> }) {
    const { lands, base, revision, reload } = ground;
    const [selected, select] = useState(0);
    const [item, setItem] = useState(""), [count, setCount] = useState(1);
    const [busy, setBusy] = useState(false), [note, setNote] = useState("");
    const lock = useRef(false);
    const key = "coast-gift:" + JSON.stringify([character.name, character.clan]);
    const [pending, setPending] = useState(() => savedGift(key));
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const info = base.data, landing = info?.landing;
    const materialName = (id: string) => info?.rules.materialNames?.[id] ?? fallbackName(id);
    const available = lands.data?.sectors ?? [];
    const paused = lands.data?.paused === true;
    const area = available.find(row => row.sector === (sector ?? (selected || info?.holds?.sector))) ?? (sector === undefined ? available[0] : undefined);
    const contest = area?.contest;
    const school = schoolOf(area?.holder?.terrainBuffStat), cost = lands.data?.rules?.declareScrolls;
    // The server names the sky; a name this client does not know is not shown.
    const sky = area?.sky && weatherEffects[area.sky.weather] ? area.sky : undefined;
    const material = item || info?.rules.materials[0] || "";
    const updating = busy || lands.pending || base.pending;
    const cap = Math.max(0, Math.min(info?.rules.perContribution ?? 0, (landing?.yours.cap ?? 0) - (landing?.yours.used ?? 0)));
    function remember(gift: Gift | null) {
        if (alive.current) setPending(gift);
        try { if (gift) sessionStorage.setItem(key, JSON.stringify(gift)); else sessionStorage.removeItem(key); } catch { /* Keep the in-memory receipt. */ }
    }
    // `choice` is what an officer picked for held ground: `{ terrainBuffStat }` for the school, `{ weather }` for the sky.
    async function act(action: "declare" | "withdraw" | "terrain" | "weather" | "found" | "raise" | "contribute" | "build" | "hall-style", workId?: string, hallStyle?: HallStyle, choice?: Record<string, string>) {
        if (lock.current) return;
        lock.current = true; setBusy(true); setNote("");
        const land = action === "declare" || action === "withdraw" || action === "terrain" || action === "weather";
        const gift = action === "contribute" ? pending ?? { itemId: material, count, requestId: crypto.randomUUID() } : null;
        if (gift) remember(gift);
        try {
            const result = await coastPost<Mutation>(land ? "land" : "landing", { action, ...(hallStyle ? { hallStyle } : {}), ...(workId ? { workId } : {}), ...(land ? { sector: area?.sector } : {}), ...choice, ...gift });
            if (result.character) commit(result.character, result._saveVersion);
            if (gift) remember(null);
            if (alive.current) setNote({ "hall-style": "Hall appearance saved.", declare: "Contest posted.", withdraw: "Contest withdrawn.", terrain: "Favoured school saved.", weather: "Sector weather saved.", found: "Landing founded.", build: "Landing work built.", raise: "Landing raised.", contribute: "Materials received." }[action]);
        } catch (error) {
            if (gift && error instanceof CoastError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) remember(null);
            if (alive.current) setNote(coastMessage(error));
        } finally {
            lock.current = false;
            if (alive.current) { setBusy(false); reload(); }
        }
    }
    const onGround = sector === undefined || plot || info?.holds?.sector === sector;
    return <section className="coast-clan" aria-label="Coast land and Landing">
        {sector === undefined && available.length > 0 && <label>Contest ground <select value={area?.sector ?? ""} onChange={e => select(Number(e.target.value))}>
            {available.map(row => <option key={row.sector} value={row.sector}>{row.name}</option>)}</select></label>}
        {paused && <p role="status">Land contests on the coast are paused for now. Nothing posted is lost.</p>}
        {area && <div>
            <img src={area.holder ? clanBanner : freeBanner} width="52" height="52" alt="" />
            <strong>{area.name}</strong><p>Held by {area.holder?.clan ?? "the Unmoored"}.</p>
            {area.holder && area.holder.immuneUntil > revision && <p>Protected until {time(area.holder.immuneUntil)}.</p>}
            {area.holder && school && <p>{area.holder.clan} favours {school} here. Its members hit 10% harder with it in fights on this ground.</p>}
            {info?.officer && area.holder?.clan === info.clan && <label>Favoured school <select value={school ?? ""} disabled={updating} onChange={e => void act("terrain", undefined, undefined, { terrainBuffStat: schoolId(e.target.value) })}>
                {!school && <option value="" disabled>Choose a school</option>}{SCHOOLS.map(name => <option key={name}>{name}</option>)}</select></label>}
            {sky && <p>Weather: {weatherEffects[sky.weather].name}. {weatherEffects[sky.weather].effect}{sky.fixed && area.holder ? ` ${area.holder.clan} keeps it so.` : ""}</p>}
            {info?.officer && area.holder?.clan === info.clan && <label>Sector weather <select value={area.holder.weather ?? "scheduled"} disabled={updating} onChange={e => void act("weather", undefined, undefined, { weather: e.target.value })}>
                <option value="scheduled">Leave it to the sky</option>{Object.entries(weatherEffects).map(([id, weather]) => <option key={id} value={id}>{weather.name}</option>)}</select></label>}
            {contest && <><p>{contest.clan} · {contest.phase} · {contest.score}/{contest.target} points · {contest.roster} on roster.</p>
                <p>Opens {time(contest.opensAt)} · closes {time(contest.closesAt)}.</p>
                {contest.defender && <p>{contest.defender.clan} defending · {contest.defender.score} points · {contest.defender.roster} on roster.</p>}
                {sector === area.sector && contest.phase === "open" && info?.clan === contest.clan &&
                    <button type="button" disabled={paused || updating} onClick={() => { if (!requestAiFight({ opponentId: contest.id, opponentName: `${contest.defender?.clan ?? "Unmoored"} Garrison Guard`,
                        opponentLevel: character.level, battleKind: "world", returnScreen: "worldMap", sector,
                        worldEncounter: { kind: "coast-garrison", sourceId: contest.id, sector } })) setNote("The fight could not start. Try again."); }}>Challenge the garrison</button>}
            </>}
            {info?.officer && !contest && area.holder?.clan !== info.clan && <><button type="button" disabled={updating || paused} onClick={() => void act("declare")}>Declare contest</button>
                {!!cost && <p>Declaring takes {cost} Territory Control Scrolls from the clan hall. Withdrawing before the fighting opens returns them.</p>}</>}
            {info?.officer && contest?.clan === info.clan && contest?.phase === "posted" && <button type="button" disabled={updating} onClick={() => void act("withdraw")}>Withdraw contest</button>}
        </div>}
        {onGround && info && <div><h3>Clan Landing</h3>
            {info.fallen && <p>Lost in sector {info.fallen.sector} on {time(info.fallen.at)}. {info.fallen.reason}</p>}
            {info.holds && <p>{info.clan} holds {info.holds.name}.{info.holds.supply ? ` ${info.holds.supply.toLocaleString()} War Supply is ready to collect in the Clan Hall.` : ""}</p>}
            {info.canFound && <HallLivery key={info.clan} found busy={updating} submit={style => void act("found", undefined, style)} />}
            {!info.holds && <p>{info.clan ? "Your clan must hold a sector to found a Landing." : "Join a clan to found a Landing."}</p>}
            {landing && <>{info.officer && landing.status === "active" ? <details><summary>Customize clan hall</summary>
                    <HallLivery key={[landing.sector, landing.hallStyle?.model, landing.hallStyle?.dye].join("-")} found={false} saved={landing.hallStyle ?? DEFAULT_HALL}
                        busy={updating} submit={style => void act("hall-style", undefined, style)} /></details> : <HallPainting style={landing.hallStyle ?? DEFAULT_HALL} />}
                <strong>{landing.name} · Tier {landing.tier} · {landing.status}</strong>
                {enter && landing.tier > 0 && sector === landing.sector && <button type="button" onClick={() => enter(landing.tier)}>Enter {landing.name}</button>}
                <p>Weekly upkeep {landing.upkeep.perWeek} common materials · {landing.upkeep.dormantWeeks} dormant weeks. Grace ends {time(landing.upkeep.graceUntil)}.</p>
                <p>You contributed {landing.yours.used} of {landing.yours.cap} this week.</p>
                {!!Object.keys(landing.thisWeek).length && <details><summary>This week’s contributors</summary>{Object.entries(landing.thisWeek).map(([name, amount]) => <p key={name}>{name} · {amount}</p>)}</details>}
                <ul>{info.rules.materials.map(id => <li key={id}>{materialName(id)} · {landing.stores[id] ?? 0} stored{landing.next?.cost[id] ? " / " + landing.next.cost[id] + " needed" : ""}</li>)}</ul>
                {landing.next && <p>Next building · {landing.next.name}</p>}
                {info.officer && landing.next && <button type="button" disabled={updating || !landing.next.ready} onClick={() => void act("raise")}>Raise {landing.next.name}</button>}
                <CoastWorks works={landing.works ?? []} officer={!!info.officer} busy={updating} nameOf={materialName} build={work => void act("build", work.id)} />
                {!pending && <><label>Material <select value={material} onChange={e => setItem(e.target.value)}>{info.rules.materials.map(id => <option key={id} value={id}>{materialName(id)}</option>)}</select></label>
                <label>Quantity <input type="number" min={1} max={cap} value={count || ""} onChange={e => setCount(Number(e.target.value))} /></label></>}
            </>}
            {(landing || pending) && <button type="button" disabled={updating || (!pending && (!Number.isInteger(count) || count < 1 || count > cap))}
                onClick={() => void act("contribute")}>{pending ? "Retry contribution of " + pending.count + " " + materialName(pending.itemId) : "Contribute materials"}</button>}
        </div>}
        {(note || lands.error || base.error) && <p role="status">{[note, lands.error, base.error].filter(Boolean).join(" ")}</p>}
        <button type="button" disabled={updating} onClick={reload}>Refresh coast status</button>
    </section>;
}

