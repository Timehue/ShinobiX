import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors, safeName } from "../_utils.js";
import { safeLogValue } from "../_safe-log.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import { recordEchoesWitnessChoice } from "./_echoes-witness.js";

/** POST { playerName, eraId, choiceId } — seal one non-reward witness decision. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).end();
    try {
        const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ""));
        if (!playerName) return res.status(400).json({ error: "Invalid player name." });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: "Authentication required." });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: "You can only record your own witness decision." });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, "echoes-witness", 16, 60_000, identity.name))) return;

        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const recorded = recordEchoesWitnessChoice(character, body.eraId, body.choiceId);
            if (!recorded.ok) return recorded;
            return {
                ok: true as const,
                character: recorded.character,
                value: {
                    eraId: recorded.eraId,
                    choiceId: recorded.choiceId,
                    choices: recorded.choices,
                    alreadySealed: recorded.alreadySealed,
                },
                write: recorded.write,
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            ...result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error("[card-clash/echoes-witness]", safeLogValue(error));
        return res.status(500).json({ error: "Could not seal the witness record." });
    }
}
