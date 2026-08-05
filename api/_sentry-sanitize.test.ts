import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    invokeSafeCapture,
    safeDiagnosticContext,
    sanitizeSentryEvent,
} from '../shared/observability-sanitize.js';

describe('Sentry privacy sanitization', () => {
    it('removes credentials, bodies, saves, chat/report/prompt content, and external keys recursively', () => {
        const event = sanitizeSentryEvent({
            request: {
                url: 'https://game.invalid/save/player?token=visible',
                headers: { authorization: 'Bearer top-secret', cookie: 'sid=secret' },
                data: { password: 'secret' },
            },
            response: { body: { playerSave: { inventory: ['secret-item'] } } },
            extra: {
                xPlayerToken: 'player-token',
                xPlayerPassword: 'player-password',
                xAdminPassword: 'admin-password',
                xAdminToken: 'admin-token',
                sessionSecret: 'session-secret',
                passwordConfirmation: 'password-confirm',
                rawRequestBody: 'raw-request',
                rawResponseBody: 'raw-response',
                playerSave: { ryo: 10 },
                chatContent: 'private chat',
                messageContent: 'private message',
                reportContent: 'private report',
                imagePrompt: 'private prompt',
                openAiApiKey: 'sk-super-secret-key',
                nested: { authorization: 'Bearer nested-secret', safe: 'battle' },
            },
            tags: { request_id: 'req123', gameplay_subsystem: 'missions' },
        });
        const serialized = JSON.stringify(event);
        for (const secret of [
            'top-secret', 'sid=secret', 'player-token', 'player-password', 'admin-password',
            'admin-token', 'session-secret', 'password-confirm', 'raw-request', 'raw-response',
            'secret-item', 'private chat', 'private message', 'private report', 'private prompt',
            'super-secret-key', 'nested-secret',
        ]) assert.equal(serialized.includes(secret), false, secret);
        assert.match(serialized, /req123/);
        assert.match(serialized, /missions/);
        assert.match(serialized, /battle/);
    });

    it('allowlists caught-error context and scrubs secret-like string fragments', () => {
        assert.deepEqual(safeDiagnosticContext({
            screen: 'missions',
            battleMode: 'solo-pve',
            password: 'do-not-send',
            arbitrary: 'do-not-send-either',
            errorCategory: 'authorization=secret-token',
        }), {
            screen: 'missions',
            battleMode: 'solo-pve',
            errorCategory: 'authorization=[REDACTED]',
        });
    });

    it('safe capture invocation never throws into the caller', () => {
        let received: unknown;
        assert.equal(invokeSafeCapture((error, hint) => { received = { error, hint }; }, new Error('safe'), {
            screen: 'village', password: 'secret',
        }), true);
        assert.match(JSON.stringify(received), /village/);
        assert.doesNotMatch(JSON.stringify(received), /secret/);
        assert.equal(invokeSafeCapture(() => { throw new Error('provider down'); }, new Error('game')), false);
    });
});
