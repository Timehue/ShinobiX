import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { enforceRateLimit, clientKey } from './_ratelimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Require a logged-in player or admin — this endpoint burns OpenAI credits
    // and would be trivially abused if left open.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // 2 images per 60 s per authenticated identity. Tight limit because each
    // call costs real money ($0.02-0.04/image at gpt-image-1 low quality).
    const authedName = identity.admin ? null : (identity as { name: string }).name;
    if (!enforceRateLimit(req, res, 'generate-image', 2, 60_000, authedName)) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel environment variables.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { prompt, label } = body as { prompt?: string; label?: string };

        if (!prompt?.trim()) {
            return res.status(400).json({ error: 'Missing image prompt.' });
        }

        const finalPrompt = `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label ?? ''}\n\nStyle rules:\n- original ninja RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;

        const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: finalPrompt,
                size: '1024x1024',
                quality: 'standard',
                n: 1,
            }),
        });

        const data = await openaiRes.json() as {
            error?: { message?: string };
            data?: Array<{ b64_json?: string }>;
        };

        if (!openaiRes.ok) {
            return res.status(502).json({ error: data?.error?.message ?? `OpenAI error ${openaiRes.status}` });
        }

        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) {
            return res.status(502).json({ error: 'OpenAI did not return image data.' });
        }

        return res.status(200).json({ image: `data:image/png;base64,${b64}` });
    } catch (err) {
        console.error('[generate-image]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
