import { useState } from "react";
import { DEFAULT_HALL, HALL_DYES, HALL_MODELS, type HallStyle } from "../../../../shared/coast-hall-style";

const MODEL_IDS = Object.keys(HALL_MODELS) as HallStyle["model"][];
const DYE_IDS = Object.keys(HALL_DYES) as HallStyle["dye"][];

/** Only a known design and dye ever reach an image path or a colour, whatever a saved style holds. */
function knownStyle(style: HallStyle): HallStyle {
    return {
        model: MODEL_IDS.find(id => id === style.model) ?? DEFAULT_HALL.model,
        dye: DYE_IDS.find(id => id === style.dye) ?? DEFAULT_HALL.dye,
    };
}

export function HallPainting({ style: given, label = true }: { style: HallStyle; label?: boolean }) {
    const style = knownStyle(given);
    const src = "/coast-map/halls/" + style.model;
    return <span className="hall-painting" role={label ? "img" : undefined} aria-hidden={label ? undefined : true}
        aria-label={label ? HALL_MODELS[style.model] + " in " + HALL_DYES[style.dye][0] : undefined}>
        <img src={src + ".webp"} alt="" />
        <i style={{ backgroundColor: HALL_DYES[style.dye][1], maskImage: "url(" + src + "-cloth.webp)" }} />
    </span>;
}

export function HallLivery({ saved, found, busy, submit }: { saved?: HallStyle; found: boolean; busy: boolean; submit: (style: HallStyle) => void }) {
    const [choice, setChoice] = useState(() => knownStyle(saved ?? DEFAULT_HALL));
    return <fieldset className="hall-livery" disabled={busy}><legend>Clan hall appearance</legend>
        <HallPainting style={choice} />
        {/* The option is read by its position in the known list, never from the element's text. */}
        <label>Hall design<select value={choice.model} onChange={e => setChoice({ ...choice, model: MODEL_IDS[e.target.selectedIndex] ?? choice.model })}>
            {MODEL_IDS.map(id => <option key={id} value={id}>{HALL_MODELS[id]}</option>)}</select></label>
        <div className="hall-dyes" role="group" aria-label="Banner dye">{Object.entries(HALL_DYES).map(([id, [name, color]]) =>
            <button type="button" key={id} title={name} aria-label={name} aria-pressed={choice.dye === id}
                onClick={() => setChoice({ ...choice, dye: id as HallStyle["dye"] })}><i style={{ background: color }} />{choice.dye === id && "✓"}</button>)}</div>
        <p>{HALL_MODELS[choice.model]} · {HALL_DYES[choice.dye][0]}</p>
        <button type="button" disabled={!found && saved?.model === choice.model && saved.dye === choice.dye}
            onClick={() => submit(choice)}>{found ? "Found Landing" : "Save hall appearance"}</button>
    </fieldset>;
}

