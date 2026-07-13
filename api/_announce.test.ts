import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validatedDiscordWebhookUrl } from './_announce.js';

describe('Discord announcement webhook destination', () => {
    const id = '123456789012345678';
    const token = 'A'.repeat(68);

    it('accepts only the canonical HTTPS Discord webhook shape', () => {
        assert.equal(
            validatedDiscordWebhookUrl(`https://discord.com/api/webhooks/${id}/${token}`),
            `https://discord.com/api/webhooks/${id}/${token}`,
        );
    });

    it('rejects SSRF, credential, port, query, and path variants', () => {
        for (const url of [
            `http://discord.com/api/webhooks/${id}/${token}`,
            `https://evil.example/api/webhooks/${id}/${token}`,
            `https://discord.com.evil.example/api/webhooks/${id}/${token}`,
            `https://user:pass@discord.com/api/webhooks/${id}/${token}`,
            `https://discord.com:444/api/webhooks/${id}/${token}`,
            `https://discord.com/api/webhooks/${id}/${token}?next=evil`,
            'https://discord.com/api/webhooks/not-an-id/not-a-token',
            'file:///etc/passwd',
        ]) {
            assert.equal(validatedDiscordWebhookUrl(url), null, url);
        }
    });
});
