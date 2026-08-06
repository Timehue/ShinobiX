# Clan Boss Operation Disposable-Staging Certification

Use this runbook only against a disposable deployment and a disposable Postgres database. It is a human, low-volume release certification, not a load test. Never point `DATABASE_URL`, browser sessions, the fault proxy, or the SQL checks below at production.

## 1. Release identity and safety boundary

Record these values before testing:

| Field | Required evidence |
| --- | --- |
| Candidate | Full commit SHA returned by `/health`; it must equal the intended release SHA. |
| Deployment | Disposable URL, provider deployment ID, UTC deploy time, and replica count. Keep the normal one-replica topology; do not combine this certification with a scaling change. |
| Storage | Disposable Postgres project/cluster ID and region. Do not record credentials. |
| Operators | Four named human testers, four distinct accounts, four independent browser profiles/devices, and one separate full-admin account. |
| Clan Boss state | Week ID, boss ID, starting clan pool, sector pressure, and each test member's attempts remaining. |
| Evidence | Party IDs, run IDs, request IDs, UTC timestamps, redacted response bodies, admin screenshots, viewport screenshots, and pass/fail notes. Never capture tokens or passwords. |

Required staging configuration:

- Set `DATABASE_URL` to the disposable Postgres/Supabase Session Pooler URL. Leave `DISK_KV_DIR`, `FORCE_PG_KV`, and production database credentials unset.
- Set unique staging values for `SESSION_SECRET`, `ADMIN_PASSWORD`, and `HEALTH_DEEP_TOKEN`.
- Leave `DISABLE_CLAN_BOSS` unset so the weekly boss and scheduler run.
- Start the rollout with `DISABLE_CLAN_BOSS_PARTIES=1`.
- Do not enable production analytics, import production saves, change balance constants, run unrestricted soaks, or change the replica count during this certification.

From the release checkout, verify the deployed identity and storage path:

```bash
export STAGING_URL='https://disposable-staging.example'
export RELEASE_SHA='<full-release-sha>'
export HEALTH_DEEP_TOKEN='<from-secret-manager>'
export EXPECTED_COMMIT="$RELEASE_SHA"
export EXPECTED_SAVE_STORE='base-store'
export REQUIRE_KNOWN_COMMIT=1
npm run release:health -- "$STAGING_URL"
```

Pass only when shallow and deep health are green, the commit matches, `saveStore=base-store`, and the deployment is confirmed to have `DATABASE_URL` set to the disposable database. Create one uniquely prefixed test account, save once, relogin, and use a read-only database session to prove the row landed in Postgres:

```sql
select key, updated_at
from public.kv_store
where key like 'save:closeout-%'
order by updated_at desc
limit 10;
```

## 2. Flag-off compatibility gate

With `DISABLE_CLAN_BOSS_PARTIES=1` still set:

1. Sign in as a clan member and open Clan Hall → Clan Boss. Confirm the party/finder controls are unavailable, the weekly boss remains visible, and the client shows `Solo Compatibility` rather than reporting the intentionally disabled party route as an outage.
2. Start one legacy-compatible solo assault. Record attempts before start, the run ID, terminal result, settlement response, and attempts after settlement. Exactly one attempt may be consumed.
3. Refresh during the solo fight and confirm the same run resumes and settles once.
4. Open Admin Diagnostics → Clan Boss Operations. It must report `Boss enabled; parties solo compatibility`, return bounded totals, and show no false missing-session/stale-member alarm for the solo run.
5. Confirm `GET /api/clan-boss/party` returns the disabled behavior while `/api/clan-boss/get` and the solo start path remain operational.

Any failure blocks rollout. Keep the party-only kill switch set while investigating; use `DISABLE_CLAN_BOSS=1` only if the weekly boss or settlement authority itself is unsafe.

## 3. Enable parties on disposable staging

Remove `DISABLE_CLAN_BOSS_PARTIES` and redeploy the same candidate SHA. Do not change any other variable. Repeat the health command, then verify Admin Diagnostics reports `parties enabled` and the party/finder UI is visible.

Prepare four distinct clan members with legal saved loadouts. At least one member must have usable heal/shield/cleanse support actions. Record each save version and attempts remaining. Use separate browser profiles; one person controlling four tabs does not satisfy the human-party check.

## 4. Human party matrix

Run separate 1-, 2-, and 4-player operations. For each row, record party ID, run ID, start/terminal/settlement UTC timestamps, result, rounds, attempts delta, pool delta, and sector-pressure delta.

| Party | Required execution | Pass criteria |
| --- | --- | --- |
| 1 player | Create a private party, ready, start, complete with human inputs, refresh/reconnect, and settle. Separately queue a solo public party for at least 120 seconds and verify the truthful solo-fallback offer. | No fabricated members; the accepted party and active run survive refresh; one attempt and one result are recorded. |
| 2 players | Create/invite or finder-join, ready both members, exercise the loadout-change rejection and leader-loss recovery below, start, refresh both members, complete with human inputs, and settle. | Both members see the same version/run and only their own actor is controllable; recovery does not duplicate or unlock the party incorrectly. |
| 4 players | Fill the party with four humans, ready all four, use tactical pings, exercise support and AFK cases, interrupt a connection, refresh every member, complete with human inputs, and run the concurrent/lost settlement checks. | Four real member actors are sealed; authoritative actions advance one shared run; active contributors are credited and the AFK member is excluded. |

Actual encounter duration is measured from the first successful `assault-start` server timestamp to the first authoritative terminal Tower state. Also record active play time separately from deliberate 45/75/120-second fault waits. Record all three observed durations; flag any ordinary-play duration outside the player-facing 10–20 minute commitment for product review. Do not tune balance as part of this closeout without a separately proven defect.

## 5. Recovery and idempotency cases

### Every-member refresh and packet interruption

For every party size, refresh every accepted member once while forming and once while the run is active. Each member must rediscover the same party/run without rejoining or losing its actor. During the four-player run, put the active member offline for 15–30 seconds, restore connectivity, fetch state, and retry only if the UI still offers the action. The session must converge without a double action, duplicate attempt, or settlement.

For a response-loss test, use a staging-only reverse proxy that forwards the request upstream and then closes the downstream response. Cancelling before dispatch does not count. Install `mitmproxy`, save this temporary hook outside the repository as `/tmp/shinobix_drop_response.py`, and delete it when certification ends:

```python
from mitmproxy import http

MARKER = "x-shinobix-cert-drop-after-upstream"

def request(flow: http.HTTPFlow) -> None:
    if flow.request.headers.pop(MARKER, None) == "1":
        flow.metadata[MARKER] = True

def response(flow: http.HTTPFlow) -> None:
    if flow.metadata.get(MARKER):
        print(f"dropped after upstream response: {flow.request.method} {flow.request.path} upstream={flow.response.status_code}")
        flow.kill()
```

Run it only on loopback and point it only at disposable staging:

```bash
test -n "$STAGING_URL"
mitmdump \
  --mode "reverse:$STAGING_URL" \
  --listen-host 127.0.0.1 \
  --listen-port 4179 \
  --set block_global=true \
  -s /tmp/shinobix_drop_response.py
```

Copy the real browser request as cURL, change only its origin to `http://127.0.0.1:4179`, add `x-shinobix-cert-drop-after-upstream: 1`, and retain the original body and `requestId`. The proxy log must show the upstream response status while the client receives a closed/empty response. Stop the proxy before the identical direct retry. Keep cookies and tokens out of captured evidence; never bind the proxy to a non-loopback address.

### Lost start response

1. Record party version and all members' attempts.
2. Send one valid `POST /api/clan-boss/assault-start` through the forward-then-drop proxy. Confirm server logs/database show the request committed although the caller received no body.
3. Replay the identical request body with the identical `requestId` after removing the drop rule.
4. Require HTTP 200, the original run ID, one party binding, and exactly one attempt reservation. A new run ID or second attempt is a release blocker.

### Lost settlement response

1. After a terminal run, record clan pool, sector pressure, consumables, profession XP, save versions, and relevant receipt counts.
2. Send one valid `POST /api/clan-boss/assault-settle` through the forward-then-drop proxy and prove the upstream committed.
3. Retry settlement for the same run after removing the drop rule.
4. Require HTTP 200 with `alreadySettled: true`; pool damage, pressure, consumables, profession XP, clan points, announcements, and save versions may each advance at most once.

### Concurrent settlement

At terminal state, have two accepted members submit settlement for the same run at the same time. Preserve both redacted responses. Both must succeed, at least one must report `alreadySettled: true`, and every durable delta must equal a single settlement. Follow with one more retry to prove stable replay.

### Loadout mutation after ready

1. Ready every member and record party version plus the affected member's sealed snapshot.
2. In a second session for one member, change equipped jutsu or equipment and save.
3. Attempt to start from the leader.
4. Require `loadout-changed`; the party returns to a safe forming state, the changed member becomes unready, no run is created, and no attempt is consumed. Ready again and start only after the current save is sealed.

### Leader loss and recovery

1. In a two-player forming party, close the leader session without leaving or transferring.
2. Keep the member connected. After more than 45 seconds, require the leader to display stale and the member to be offered leadership recovery.
3. Claim leadership once, then issue a concurrent/replayed claim from the old version.
4. Exactly one claim may win; the party version increments once, membership is unchanged, and the old leader may reconnect as a normal member. Repeat at queued state if the UI permits; never attempt admin disband of active combat.

## 6. Stale, expiry, admin, contribution, and AFK cases

### Stale and expired reconciliation

Create a disposable forming party, record all related IDs, then close every member session without leaving:

1. After more than 45 seconds, Admin Diagnostics must count the members as stale without inventing an active run.
2. Leave the party untouched for the two-hour party TTL, then allow at least one five-minute registry sweep interval.
3. Confirm the authoritative party row has expired, registry/invite/player indices no longer expose it, finder results omit it, diagnostics totals converge, and each former member can create or join a new party.
4. Use only read-only SQL to corroborate expiry/reconciliation:

```sql
select key, expires_at, updated_at
from public.kv_store
where key like 'clan-boss:party%'
order by updated_at desc
limit 100;
```

Do not shorten TTL constants, edit production rows, or run a bulk delete to make this test faster.

### Admin diagnostics and safe disband

1. Inspect first/next-page navigation, feature state, registry total, status counts, public queues, stale members, missing sessions, versions, ages, readiness, and session binding.
2. Create a throwaway forming or queued party. From Admin Diagnostics choose a canonical reason (`operator-request`, `session-missing`, or `stuck-starting`), explicitly confirm, and disband using the exact displayed version.
3. Verify member indices release, the party becomes terminal, and the combat audit log records `clan-boss.party-recover-disband` with the reason.
4. Replay with the stale version and require rejection. Confirm the UI does not offer recovery for active/completed combat; a direct attempt against active combat must fail without changing the session, contribution, currency, rewards, profession XP, pressure, or history.

### Support contribution

In the four-player run, have the prepared support member take accepted heal, shield, and cleanse actions when legal. Capture the first settlement response. Its `contributions` record must show accepted actions and the corresponding nonzero support fields; `active` must be true. The matching `professionAwards` entry must be receipt-protected, and a settlement replay must not add XP again.

### AFK exclusion

Designate one four-player member as AFK before combat and do not submit any action for that actor. When its turn begins, wait more than the 75-second human-turn deadline and have another member poll/reconnect so the server auto-passes it. At settlement require that member's contribution to show zero accepted actions, `active: false`, threshold `none`, zero operation profession award, and no personal contribution credit. Other active members and clan-wide boss damage must still settle normally. Do not end or rewrite the weekly campaign merely to accelerate its natural reward job; retain the contribution record as the staging evidence for weekly AFK exclusion.

## 7. Viewport and zoom evidence

Capture authenticated lobby, active encounter, reconnect state, result/contribution state, and Admin Diagnostics evidence at:

- 390×844 CSS pixels at 100% zoom;
- 1440×900 CSS pixels at 100% zoom;
- 150% browser zoom at 1440×900 (record the effective CSS viewport reported by DevTools).

At each state confirm there is no hidden primary action, clipped roster/result data, horizontal page overflow, overlapping modal, unreadable focus state, or color-only status. Keyboard access, focus visibility, labels, live-status announcements, and 44px operation touch targets must remain usable. A generic combat screenshot does not substitute for authenticated operation states.

## 8. Exit criteria and rollout decision

Certification passes only when every scenario above has evidence tied to the exact release SHA, real disposable Postgres storage, and human operators. Record every deviation; do not convert an unrun external check into a pass.

Rollout order:

1. Deploy the candidate with `DISABLE_CLAN_BOSS_PARTIES=1`.
2. Pass health, legacy-compatible solo, and admin-diagnostics checks.
3. Enable parties only on disposable staging and complete this runbook.
4. If all gates pass, enable parties in the intended staffed environment without removing the flag definition or operational documentation.
5. Retain `DISABLE_CLAN_BOSS_PARTIES=1` as the party-only rollback. Set it immediately for party/finder/reconnect risk while preserving the solo Clan Boss path. Use `DISABLE_CLAN_BOSS=1` only for weekly boss or settlement-authority risk.

After evidence is archived, decommission the disposable deployment and database through their provider controls. Do not copy its accounts, tokens, or test operation rows into production.
