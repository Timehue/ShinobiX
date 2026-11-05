# Google session proof rollout

This runbook is a proposed release procedure, not evidence of a deployment.
The compatibility release accepts v1/v2/v3 in every phase. Its ordinary token
issuer and ordinary sliding refresh still produce v2. No secret rotation or
storage migration is needed. Keep the existing session secret and epoch store
shared across all instances.

## Controls and user impact

`GOOGLE_SESSION_PROOF_PHASE` is a nonsecret server configuration value:

| Value | Google claim/signup token | Google first-password setup | Existing v3 sessions |
| --- | --- | --- | --- |
| unset, unknown, `prepare` | v2 | Paused, HTTP 503 | Accepted |
| `issue` | v3 | Paused, HTTP 503 | Accepted |
| `enforce` | v3 | Requires recent proof in that exact credential | Accepted |
| `drain` | v2 | Paused, HTTP 503 | Accepted; eligible HTTP refresh immediately returns v2 |

Only exact lowercase values activate a phase. Unset/invalid values resolve to
`prepare`; they cannot accidentally activate v3 or weaken proof enforcement.
The pause response is `google-password-setup-paused`, with a message to continue
using Google sign-in. Normal play, Google login/signup, existing password login
and changes, and first-password setup for guests without Google continue.
There is deliberately no fallback to account-wide `google.lastAuthAt`.

The phase is process configuration, not a distributed coordinator. Changing a
host's variable does not prove that every running process has received it.
Record the exact image, effective phase, and drain completion of every instance,
including old replicas, background jobs, preview traffic routes and rollback
targets that can serve production authentication. Do not log session tokens.

## Coexistence requirements beyond token format

Token compatibility does not qualify concurrent execution of the full binaries.
The phase flag controls neither older handlers nor Exchange workers.

- Older Google callback handlers may retain the original Google-link CSRF path.
  In reviewed main `99b49d3c`, `api/auth/google/callback.ts` calls `linkToAccount`
  and writes the link before the initiating browser redeems the nonce-bound
  claim ticket. Original #60 head `3b8501b9` moves that mutation to claim; the
  callback only prechecks. A secure new claim handler does not undo a link
  already written by an old callback. Routing only the player-auth aliases is
  insufficient: route the entire Google start/callback/claim flow, including
  both bare and `/api` aliases, to the corrected image, or quiesce those flows
  during cutover. Drain old in-flight callbacks before reopening the flow, and
  do not restore an old callback handler as part of rollback.
- Original #60 Exchange creation at `3b8501b9` takes the outbound budget gate
  before the global create lock and listing lock. The correction takes the
  create/listing locks before the outbound gate, then the player-save lock;
  recovery likewise takes the listing lock before the outbound gate. Mixed
  workers can therefore invert lock order: an old creator holding the budget
  gate can wait for a create/listing lock held by a new worker waiting for that
  same budget gate. Do not run those Exchange implementations concurrently.
- The original Exchange implementation also charges the budget separately
  after escrow/recovery, only when the request created the listing. Old workers
  retain non-atomic accounting and missed-charge recovery paths regardless of
  the token phase. Route all Exchange mutation/recovery entrypoints to one
  qualified implementation and stop/drain the old workers before admitting new
  work. Include background jobs and read handlers that invoke recovery; routing
  only listing-creation POSTs is insufficient. Existing escrow receipts from
  old code are not retroactively budget-charged by the correction. Any affected
  accounting needs a separately reviewed reconciliation plan.

## Preparation and activation

1. Identify the production traffic topology and every session issuer/verifier.
   Inspect the actual deployment image and rollback image. Do not infer these
   from a branch name or a single-instance architecture description. Qualify the
   exact combined image separately; this patch does not reconcile other PRs.
2. Choose a short first-password setup pause. The old binary has the account-wide
   proof weakness; the new pause cannot control requests sent to that binary.
   Before claiming that first-password setup is protected during overlap, route
   both `/player-auth` and `/api/player-auth` exclusively to the compatibility
   image, or quiesce the old instances' credential-mutation traffic. If this
   cannot be enforced, use a coordinated cutover with a maintenance window.
   Do not assume sticky sessions solve this. This routing/quiescence is an
   operational prerequisite, not implemented by this code. Also satisfy the
   callback and Exchange coexistence requirements above; the first-password
   pause alone does not establish a safe full-binary rollout.
3. Deploy the compatibility image with `prepare` everywhere. Old and new
   processes can exchange newly issued v2 sessions during this phase. Verify
   Google claim, Google signup, ordinary API authentication, socket handshakes,
   refresh, and the explicit first-password pause. Existing v1/v2 sessions stay
   usable. Allow all old processes and in-flight old requests to finish draining.
4. Retain and qualify this v3-capable image as the rollback baseline. Prove every
   traffic-serving verifier is v3-capable before any process enters `issue`.
   This includes processes which share the public origin and consume tokens.
5. Set `issue`. During propagation, `prepare` and `issue` instances accept each
   other's tokens, while first-password setup remains paused on both. Verify
   every Google issuer is issuing v3, and probe the same test account credential
   through every verifier. Do not expose full credentials in diagnostics.
6. Set `enforce` only after verifying that EVERY Google issuer actually emits
   v3 from both claim and signup paths. Leaving `prepare` or merely observing a
   configuration value is insufficient: `drain` also issues v2. Confirm issuance
   on every instance and traffic route before activating enforcement. During
   propagation, remaining `issue` instances still return the temporary pause. Once
   all are enforcing, a fresh Google sign-in enables first-password setup for
   30 minutes on that credential. Old v2 credentials still play normally and
   receive `google-reauth-required` when attempting first-password setup.
   Another device's login must never authorize their credential.

## Rollback and drain

- Preferred rollback after issuance is to the retained v3-capable compatibility
  image in `drain`. A mixed `enforce`/`drain` transition accepts both token
  versions. First-password setup may be temporarily paused, but there is no
  account-wide proof fallback and no session-format outage.
- In `drain`, Google claim/signup issue v2. A still-valid v3 on an HTTP endpoint
  that participates in token refresh is exchanged for v2 immediately, retaining
  its epoch. Forged, expired or revoked tokens cannot be exchanged. Socket-only
  and offline clients are not guaranteed to pick up a replacement; drain is an
  optimization, not proof that no v3 sessions remain.
  The current server emits refresh headers only on POST/PUT/PATCH/DELETE;
  GET-only traffic does not drain a token, and clients must adopt the header.
- To return to a binary that understands only v1/v2, first verify ALL v3 issuers
  have stopped, including draining/in-flight requests and rollback/preview
  instances. Record a conservative last-issuance upper bound. Wait at least the
  full 24-hour token TTL plus a verified bound on issuer/verifier clock skew and
  in-flight issuance time. A deployment timestamp alone is not that proof.
  Any reactivation of `issue`/`enforce` restarts the waiting period.
- If that bound cannot be established, retain v3-capable verification. An
  immediate rollback to an older verifier would force affected Google users
  to sign in again; it is not a seamless or safe compatibility rollback.
  Reverting to the older credential handler also restores its known proof
  weakness, independently of token expiry. Do not silently accept that security
  regression; preserve the fixed handler or keep its mutation path quiesced.
- A prepare-only rollout can revert without a format drain only if no v3 issuer
  has ever been activated and no earlier v3 issuance is outstanding.

## Validation and release dependencies

Persistent tests cover all phases, both Google issuance routes, refusal without
credential mutation, proof expiry/revocation, and drain authentication. A local
mixed-version probe can load the actual old `_auth.ts` blobs from the reviewed
main and PR commits against an isolated memory store. That establishes token
compatibility only: the historical auth modules use dependencies from the
current worktree and run behind a small local HTTP wrapper. The probe does not
qualify complete old/new binaries, callback or Exchange coexistence, production
routing/load-balancer behavior, packaging, or a real rolling deployment.

Before release an operator must confirm the maintenance/routing choice, phase
propagation and traffic inventory, exact qualified image and rollback baseline,
callback and Exchange worker quiescence, actual v3 issuance from every Google
issuer, and clock/drain bounds if a later old-verifier rollback is desired. No phase
activation, production configuration change or secret change is part of this
patch. World-boss changes are outside its scope.
