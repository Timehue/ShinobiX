# Audit remediation release to Main

Lifecycle: review. Publication and live verification are pending.

Goal: publish the authorized full-game audit fixes while preserving newer Main changes. Independent backup setup is outside this release.

Implemented: database-clock lock fencing and expiry-safe caches; account/Google/guest authentication ownership and hashed guest resume credentials; verified-account rate-limit attribution; server-owned Hollow Gate attunement; retryable account cleanup; tracked background work and graceful shutdown; committed combat-close navigation; session-scoped late narrative artwork; save-field ownership; mobile landing/creator corrections, pack disclosure placement and smaller landing artwork; production runtime-script minification and service-worker failure recovery.

Integration preserves Main's current Rally runtime, retired adapter removals, existing backup jobs, balance rules, prices, probabilities and build budgets. The approved service-role locking RPC is prepared in supabase-lock-fencing.sql; production SQL has not been applied. Direct PostgreSQL performs fencing without that RPC. Production readiness must verify lockFencing after deployment.

Local evidence before publication: complete unit suite 13,413 passed, zero failures/skips; full lint zero errors (15 existing warnings); server/client build, distribution and unchanged size gates passed; initial JS/CSS 394,208 gzip bytes against 394,500; product JS/CSS 9,057,085 raw bytes against 9,130,000. Seven isolated SQL checks passed against Main's schema without connecting to production. Final CI must certify the actual combined commit, including all responsive and strict combat projects.

Open work: reconcile the latest Main; run focused browser checks and inspect captures; publish the release PR; require all protected checks; merge; verify Railway's exact live revision and authenticated deep readiness. Historical local audit evidence is retained in the shared checkout and is not a certification of newer Main.
