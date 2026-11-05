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
   operational prerequisite, not implemented by this code.
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
6. Set `enforce` only after all issuers have left `prepare`. During propagation,
   remaining `issue` instances still return the explicit temporary pause. Once
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
compatibility, not packaging, load-balancer behavior, or a real rolling deploy.

Before release an operator must confirm the maintenance/routing choice, phase
propagation and traffic inventory, exact qualified image and rollback baseline,
and clock/drain bounds if a later old-verifier rollback is desired. No phase
activation, production configuration change or secret change is part of this
patch. World-boss changes are outside its scope.
