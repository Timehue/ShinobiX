# Sprite recognition validation

Status: recognition is connected to durable dispatch, admission reservations,
publication and system-failure refunds. Offline tests cover the real worker body,
lost acknowledgements, duplicate execution, response recovery, refusal, mismatch,
cancellation, stale receipts and billing identity. No provider-backed verdict or
hosted round trip has been obtained. No production pool has owner approval.
Generation remains disabled pending those checks.

`recognition_lineup.py` validates a delivered package and decodes its actual idle
pixels in all eight directions. Transparent padding can be cropped, with the
origin adjusted by exactly the same amount. Visible pixels are never rescaled.
All four candidates share equal cells and ground registration; cells expand for
wide tails. The challenge binds the original portrait, target asset/revision,
three distinct decoys, decoded pixels, both review images and a private nonce.
The answer key and asset metadata stay out of the provider request.

The Responses request has two image inputs and a strict schema. Eight picks are
required; seven correct picks pass the 80% threshold. A no-match pick is allowed.
Unreadable images, refusals, incomplete responses, malformed answers, changed
inputs and the wrong configured model cannot approve a character. Usage is
retained as evidence; token usage is not an actual billing statement.

The request shape follows the official [image-input guide](https://developers.openai.com/api/docs/guides/images-vision)
and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
The challenge module makes no network calls and chooses no default paid model.
`recognition_worker.py` supplies a single bounded HTTPS request when explicitly
invoked by the reserved worker. It has no SDK retries or alternate endpoint.

Run the local tests from the project root in an environment with the pinned
recognition and dispatch requirements installed:

```sh
python -m unittest discover -s workers/avatar-model/tests -p 'test_recognition_*.py' -v
```

CI runs these tests in `avatar_recognition`, using the NumPy and Pillow versions
from the existing pinned paint requirements. The final `test_build` aggregate
requires that job to succeed. CI has no provider key for this job.

The server seals `recognition: {model, poolSha256, nonce}` on each admitted job.
The server-owned admission policy supplies `model` and `poolSha256`; admission
generates the nonce. It requires a positive OpenAI reservation for every job,
including jobs that do not repaint a costume. The operator must budget the
worst-case total painting and review cost within that reservation.

After assembly, a `recognize` stage uses the existing finished call, original
portrait and fitted master. The worker acknowledges its reserved operation before
starting. The private R2 journal at
`avatar-model/private/recognition/<assetId>/<masterSha256>/<nonce>.json` stores
the operation, exact challenge (including its private answer), provider request
and submitted state **before** sending. Its initial write uses atomic
`If-None-Match: *` and exact read-back verification. It stores the raw response and request ID
before parsing a verdict. A restart after that save can finish without another
request. A submission with no saved response remains ambiguous and is never
reissued automatically. Provider and Modal billing records must resolve that
exposure before its reservation is released. Do not expire an unresolved operation
claim. The private journal supports redacting image/request content into a small
deletion tombstone. Updates use the last observed R2 ETag with `If-Match`, so an
older worker cannot overwrite that tombstone with portrait data. A redacted
operation cannot run again. The account-cleanup consumer is still being built;
this primitive alone does not establish account deletion.

A separate immutable record at
`avatar-model/private/recognition-billing/<assetId>/<masterSha256>/<nonce>.json`
keeps only operation identifiers, provider request/response IDs, model and token
counts. It contains no portrait, challenge, request body or answer text. It is
saved before the full response journal update, including when erasure wins that
update. Its retention must follow the approved accounting policy. Token counts
remain evidence rather than an actual billing statement.

Modal Dict entries are not used for this journal because they expire
after inactivity; the short-lived dispatch acknowledgement still uses the
existing Modal Dict. See the official [Modal Dict lifetime documentation](https://modal.com/docs/sdk/py/latest/Dict)
and [R2 conditional-write semantics](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject).

The server keeps the finished job on the dispatch queue until recognition passes.
It rejects a mismatched, unreadable, malformed or stale verdict. Publication
checks the receipt a second time. Recognition failures return the monthly slot
and keep incurred costs reserved for reconciliation; they do not start another
paid attempt. Automatic repair/rerender is not implemented. A new player request
after a system refund has its own reservation and operation. The existing
three-failures-per-source hold still applies.

Worker deployment needs `SPRITE_RECOGNITION_POOL_ZIP`, its exact
`SPRITE_RECOGNITION_POOL_SHA256`, and `SPRITE_RECOGNITION_MODEL` (an explicit pinned
vision model). The dedicated Modal secret `shinobix-avatar-recognition` supplies
the private R2 credentials (`AVATAR_MODEL_R2_ACCOUNT_ID`,
`AVATAR_MODEL_R2_PRIVATE_BUCKET`, `AVATAR_MODEL_R2_ACCESS_KEY_ID`,
`AVATAR_MODEL_R2_SECRET_ACCESS_KEY`). Include the `AVATAR_MODEL_R2_PUBLIC_BUCKET`
name so the worker can reject a journal destination equal to the public sprite
bucket. By default the recognition secret also supplies `OPENAI_API_KEY`.
Set `SPRITE_OPENAI_SECRET` at deployment to load that key from an existing
Modal secret in the same environment, for example `openai-secret`.
Verify public access is
disabled on the private bucket. The server's `AVATAR_MODEL_RESERVATIONS_JSON.recognition` must
match the deployed pool hash and model. Deploy the worker before enabling
dispatch. Missing configuration fails closed.

The pool is a private operator-supplied ZIP, pinned by its complete SHA-256.
The locally prepared staging candidate uses 12 exact owner-approved roster
revisions, four for each of the three supported portrait templates. Its receipt
is in the release checkout at `.ci-evidence/recognition-pool-approved-roster/receipt.json`.
The preparation decoded all 96 idle views and exercised the worker's
three-distinct-decoy selection with a matching portrait excluded for each
template. The staging candidate still needs a provider-backed verdict.
`pool.json` has this schema (example values are placeholders, not approvals):

```json
{
  "version": 1,
  "entries": [{
    "assetId": "<32 lowercase hex>",
    "version": "<64 lowercase hex revision>",
    "sourceSha256": "<64 lowercase hex portrait>",
    "templates": ["male-coat-template.json"],
    "approved": true,
    "ownerApprovedAt": "2026-11-10T00:00:00Z"
  }]
}
```

Every entry's complete immutable delivery lives at
`<assetId>/<version>/<content-addressed filename>`. The operator includes an entry
only after the owner approves that exact visual revision; writing `approved`
is not itself evidence of approval. The server's pinned archive hash establishes
the trusted pool. Entries list the supported templates for which they are
reasonably similar decoys. Selection is deterministic, excludes the target's
portrait, requires three distinct source portraits and validates each selected
object graph before decoding it. A pool with too few approved matches cannot
submit a paid recognition request.

Still required before unattended release: a selected deployment pool, a configured
review model/cost allowance, semantic accuracy checks with real provider replies,
complete hosted submission/publication, actual billing reconciliation and private
retention verification. Automatic import of provider billing remains unqualified.

Passing local contract tests or drawing a lineup does not establish semantic
recognition accuracy or hosted readiness.
