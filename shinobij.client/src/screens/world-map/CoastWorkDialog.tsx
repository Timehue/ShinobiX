import { useRef, useState } from "react";
import type { CoastJob } from "../../../../shared/coast-work";
import { Modal } from "../../components/ui/Modal";
import { doCoastWork } from "../../lib/quest-lines-api";
import type { Character, VersionedCharacterCommit } from "../../types/character";

export function CoastWorkDialog({ job, index, character, sector, tile, close, walk, update, commit, speech }: {
    job: CoastJob; index: number; character: Character; sector: number; tile: number;
    close: () => void; walk: (tile: number) => void; update: (progress: Record<string, number>) => void;
    commit: VersionedCharacterCommit; speech?: string;
}) {
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const step = job.steps[index];
    async function act(choice: string) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
            const response = await doCoastWork(character.name, job.id, index, choice);
            if (response.character) commit(response.character, response._saveVersion);
            if (response.ok && response.coastWork) {
                update(response.coastWork);
                setMessage("");
            } else setMessage(response.error ?? "Check the work point and try again.");
        } finally { pending.current = false; setBusy(false); }
    }
    return <Modal open title={job.title} onClose={close}>
        <p><strong>{job.worker}</strong> · {step ? job.working : job.finished}</p>
        <p>{step?.detail ?? job.result}</p>
        {job.id === "read-the-ford" && index === 1 && character.activePetId && <p>Your companion catches a scent at the sharp print.</p>}
        {step && (step.sector !== sector ? <p>Continue in sector {step.sector}.</p> :
            step.tile !== tile ? <button onClick={() => walk(step.tile)}>Walk to the work point</button> :
            <div className="coast-work-actions">
                {[step.action, ...(step.alternative ? [step.alternative] : [])].sort().map(choice =>
                    <button key={choice} disabled={busy} onClick={() => void act(choice)}>{choice}</button>)}
            </div>)}
        <details><summary>Ask about the area</summary><p>{job.tip}</p>{speech && <p>{speech}</p>}</details>
        {message && <p role="status">{message}</p>}
        <button type="button" onClick={close}>Leave</button>
    </Modal>;
}
