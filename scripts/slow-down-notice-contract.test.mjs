// Contract between the server's rate-limit wording and the client's matcher.
//
// GameAlert shows a rate-limit refusal as a quiet toast only because
// shinobij.client/src/lib/slow-down-notice.ts recognises its TEXT (the alert
// layer never sees the response body's `code`). If someone rewords
// api/_ratelimit.ts rateLimitBody without updating the matcher, every refusal
// silently goes back to a blocking modal — this test fails first instead.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rateLimitBody } from '../api/_ratelimit.ts';
import { isSlowDownNotice } from '../shinobij.client/src/lib/slow-down-notice.ts';

test('every rate-limit refusal the server writes is recognised as a slow-down notice', () => {
    for (const retryAfterMs of [0, 1, 999, 3_000, 60_000, 3_600_000]) {
        const body = rateLimitBody(retryAfterMs);
        assert.equal(body.code, 'RATE_LIMITED');
        assert.equal(isSlowDownNotice(body.error), true, body.error);
        // Screens often prefix the server text ("❌ …") before alerting it.
        assert.equal(isSlowDownNotice(`❌ ${body.error}`), true);
    }
});
