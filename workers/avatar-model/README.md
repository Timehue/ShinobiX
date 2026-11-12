# Portrait-to-overworld sprite worker

This worker produces versioned sprite packages for the existing DOM overworld.
The private fitted descriptor, painted sheet and frozen movement release are
the rerender sources. The game client does not load a 3D character.

**Status:** the owner approved all 51 NPCs and both starters. Generation
defaults off. The hosted fresh-avatar trial still needs to verify recognition,
storage, job timing, billing and cleanup. The deployment commands below require
authorized provider access and spending.

## Sources and versions

- `sprite-worker-painted-review.json` pins the exact intake and movement ZIP
  hashes for the painted human templates. `sprite-worker-release.json` pins the
  earlier reader release. Deployment chooses the painted release with
  `SPRITE_PAINTED_COSTUMES=1`.
- `install_sprite_worker.py` checks both archives before installing them.
  A mismatched movement release cannot resume or complete another release's work.
- The image pins CPython 3.12.14 by its registry digest. The dispatcher SDK pins
  are in `requirements-dispatch.txt`; paint/reader/recognition dependencies have
  separate requirement files. Recognition's overlapping pins are tested against
  the existing paint and dispatcher pins.
- Large archives, kit sources and review evidence stay outside Git. Keep the
  exact inputs and their hashes for rollback. Do not replace an archive under an
  existing hash or rewrite a published character revision.

## Local tests

Use Python 3.12.14 and an isolated environment. Install
`requirements-dispatch.txt` and `requirements-recognition.txt` for the standalone
recognition, dispatch and publication tests. Tests use storage/provider doubles;
leave provider keys unset.

```sh
python -m unittest discover -s workers/avatar-model/tests -p 'test_recognition_*.py' -v
python -m unittest discover -s workers/avatar-model/tests -p 'test_dispatch*.py' -v
```

Some movement tests import `avatar_worker` from the installed, hash-verified
movement archive. They need that private release in their Python import path.
Passing the standalone tests does not establish the frozen movement release's
visual quality or a successful hosted generation.

## One-time hosted setup

Use `shinobix-avatar-staging` for the staged trial. The staging game server's
`AVATAR_MODEL_MODAL_ENVIRONMENT` must select the same environment. Authenticate
through the provider's normal local setup; never paste credentials into chat or
commit them.

Supply `SPRITE_INTAKE_ZIP` and `SPRITE_MOVEMENT_ZIP` as paths to the verified
deployment inputs. The image builds and installs these inputs; a player's job
does not read files from the owner's PC. `SPRITE_BLENDER_ARCHIVE` can supply the
existing pinned Blender tarball. Without it, the image build fetches that exact
tarball and verifies its checksum.

The local painted release archives are `portable-fit-worker/painted-sleeves.zip`
and `portable-motion-worker/painted-sleeves.zip` under the avatar-model evidence
folder. Their hashes match `sprite-worker-painted-review.json`. For the earlier
reader release the matching files are `portable-fit-worker/profile-intake.zip`
and `portable-motion-worker/browser-motion.zip`. Use the two inputs from the
same release.

For painted costumes, the dedicated secret `shinobix-avatar-costume-paint`
contains that feature's OpenAI key as `OPENAI_API_KEY`. For recognition, follow
[RECOGNITION.md](RECOGNITION.md): deploy the owner-approved pool ZIP, its complete
hash and a pinned vision model. The separate `shinobix-avatar-recognition`
secret supplies the feature key and scoped private R2 credentials. No session,
admin or database credentials belong in the worker. No production decoy pool is
approved yet.

After authorization and configuration, the installed Modal 1.6.3 CLI accepts:

```sh
python -m modal deploy --env shinobix-avatar-staging workers/avatar-model/modal_sprite_worker.py
```

This command builds/deploys the application and can incur provider costs. It was
not executed during local qualification. Record the deployed source commit,
environment, kit/movement hashes and pool/model pins before enabling admission.

The server needs the scoped private/public R2 configuration, moderation key,
Modal interpreter/environment and a server-owned reservation policy. The policy
must cover every paid stage and retry, with separate provider billing cycles.
Display, creation and dispatch are independent flags. Missing configuration must
be handled without preventing login, travel or NPC display.

### Standalone online portrait trial

Run the standalone trial in `shinobix-avatar-staging` to exercise portrait intake, the image provider, all three movement styles and final game packaging in Modal. It uses the same worker functions and requires the `shinobix-avatar-costume-paint` secret described above. It returns an audited game package privately through Modal. The game server, moderation, recognition, R2 publication and equip belong to the full staging test below.

Use the matching intake and motion archives. When testing a candidate pair, set `SPRITE_WORKER_RELEASE_MANIFEST` to its verified manifest. If the staging OpenAI template was saved as `openai-secret`, set `SPRITE_TRIAL_PAINT_SECRET=openai-secret` for this trial. From the project root with the Modal client authenticated:

```sh
export SPRITE_INTAKE_ZIP=/path/to/intake.zip
export SPRITE_MOVEMENT_ZIP=/path/to/motion.zip
export SPRITE_WORKER_RELEASE_MANIFEST=/path/to/matching-worker-pins.json
python workers/avatar-model/modal_portrait_trial.py submit /path/to/portrait.png /path/to/new-trial-directory
```

Submission records the hosted call ID in `submission.json`. The Modal job is detached and continues when the submitting computer disconnects. Image and rendering charges are incurred by the hosted stages. After the job finishes, retrieve and verify the exact returned objects with:

```sh
python workers/avatar-model/modal_portrait_trial.py collect /path/to/trial-directory
```

### Fresh-avatar acceptance in staging

1. Confirm the staging database, both buckets, art origin and Modal environment
   belong to the same isolated deployment. Keep creation disabled while checking
   private object access, public art and CDN purge. Record the source revision and
   worker, template, movement and recognition pins.
2. Set the approved trial reservations and enable creation for the staging
   Supporter. Use the owner's fresh portrait and submit through Profile. Confirm
   the request creates one monthly slot and one job. Close the client after
   submission and stop any local render workers for the unattended portion.
3. Reopen the account from a second browser. Verify the original job reaches
   the library and that the model can be equipped, seen by a nearby player and
   moved through all three run styles. Record elapsed time, recognition outcome,
   the equipped manifest hash and delivery checks on desktop and mobile.
4. Settle the provider statements against that job. Revoke the staging model
   after priming its public URLs, confirm the starter returns, and verify the
   public files, CDN variants and retained private fit have been erased. Keep
   the receipts and stage timings with the release evidence.

## Job execution and recovery

The server owns entitlement, monthly slots, job IDs and reservations. The worker
must not select a new design or change a source portrait on retry. Each style
and assembly call acknowledges its reserved identity before work. Final assembly
validates all three run styles and the complete delivery graph. Recognition uses
the delivered pixels and a persistent private R2 journal before a single paid
request. A matching passed receipt is required before public publication.

The portrait reader, style renderer and assemblers need outbound HTTPS for
Modal's private blob transport. A background `spawn()` call can use blob
storage for its portrait or fitted sheet on input and for its art on output.
Assembly also downloads the three finished style results. These functions
have no mounted application credentials. The game dispatcher verifies result
bindings before moving a job forward.

Unknown submissions retain their original operation. Do not manually resubmit a
paint or recognition operation because a response was lost. Reconcile it from
its journal, provider call and billing records. Token usage is not a billing
statement. See the private accounting CLI and recovery rules in
`docs/sector-model-delivery.md`.

The monthly slot returns on a system failure; incurred costs stay reserved.
Player cancellation and moderator removal keep the slot used. Moderation fences
late completion by incrementing the account's authority revision. File cleanup
has its own durable pending record and must finish before reporting deletion as
complete.

## Private-file lifecycle

The server allocates an opaque, server-owned model identity in the character
save. Read tokens, jobs, finished assets and a durable private-file index bind
to that identity. Re-registering a deleted name cannot use the previous
account's tokens, jobs or equipment. Normal character saves cannot choose or
erase this identity; it is omitted from public and combat projections.

File references are recorded before uploads. A failed upload leaves its erasure
anchor intact. Shared content-addressed files remain available while any other
reference needs them. Erasure replaces unreferenced private bytes with a fresh
32-byte random marker and verifies the marker. Immutable uploads and marker
restoration use signed R2 preconditions; a delayed earlier upload or restoration
cannot overwrite a later marker. A new authorized upload can reuse the artwork.

`AVATAR_MODEL_CLEANUP_ENABLED=1` enables the independent minute scheduler. Each
tick holds a distributed lease, checks at most 100 rotating references and
attempts at most four erasures. It expires unused reads and handles cancelled,
failed, revoked and deleting-account references. Failures retain the index for
retry. Creation, dispatch and their kill switch do not disable this cleanup.
The last batch counters are in `avatar-model:private-cleanup-last`.

Interactive account deletion and guest reclamation fence the model identity,
cancel pending jobs, revoke assets, remove name-scoped slots/read receipts and
queue public erasure before account teardown. Definitely unclaimed jobs release
unused reservations atomically; dispatched jobs keep their billing evidence.
A failed fencing transaction retains account teardown's retry anchor.

After verified publication, the sweep retains only the final private fitted
descriptor and sheet for maintenance and releases the generation portrait copy
and superseded fits. Revocation or account deletion releases the final fit.

Full server reset fences avatar writes before it deletes player saves and
preserves the cleanup queues, account references and billing evidence. It also
erases private profile detail for removed accounts. A failed reset retains the
fence until an administrator retries and completes the reset.

These paths have local in-memory and mocked-R2 tests. Hosted bucket erasure
and retention of settled billing records remain part of release qualification.

## Revoked and discarded sprite cleanup

The same independent cleanup scheduler consumes `avatar-model:cleanup` after
moderator removal, dispatched-job failure/cancellation or account deletion.
Each queue entry binds the opaque account identity, exact asset and terminal
jobs. A late billing update does not discard the cleanup operation or its
provider receipts. Definitely unclaimed jobs have no worker journal to erase.

The game-side `cleanup_sprite.py` control script makes storage/cache requests,
not Modal function submissions. It creates and verifies an immutable revocation
marker in the player's public folder. Publishing and publication recovery
refuse that marker; publishing checks it before and after writes. Cleanup
enumerates the complete bounded folder, refuses foreign/unexpected keys,
checks every bulk-delete result, and verifies the folder is empty except for
the minimal marker. It never enumerates or deletes NPC/built-in art.

Cleanup redacts each bound private recognition journal with its conditional
write protocol. The image/challenge/provider-body content goes; the separate
minimal billing receipt remains for reconciliation. It then purges only the
avatar's directory from the CDN and verifies that public files have not
reappeared. Before the database operation can become complete, its private-file
references must also finish erasure (or release shared files still owned by
another reference). Any storage, authority, receipt or purge failure retains
the pending queue row and schedules a bounded exponential backoff. A publishing
operation gets a 15-minute settling window. The public pass advances one due
entry per leased tick and rotates past delayed entries. Private erasure has
its own bounded rotating pass.

The script uses Cloudflare's [prefix purge API](https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/)
so the same directory is purged across cached query-string variants. Configure
the exact art origin without path transforms or custom routing aliases; verify
this against the real zone during the hosted trial.

Required server configuration for this control path:

- `AVATAR_MODEL_CLEANUP_ENABLED=1` enables the minute scheduler independently
  of generation and dispatch.
- `AVATAR_MODEL_CLEANUP_PYTHON` optionally selects the SDK-only Python
  interpreter; otherwise it uses `AVATAR_MODEL_MODAL_PYTHON`.
- The existing separately scoped public/private R2 credentials need the
  corresponding read, list, write and delete permissions. Buckets stay distinct.
- `AVATAR_MODEL_CDN_ZONE_ID` names the art domain's Cloudflare zone.
- `AVATAR_MODEL_CDN_PURGE_TOKEN` is server-only, scoped to that zone's cache
  purge operation; it must never enter the client bundle or logs.
- `R2_PUBLIC_BASE` is the HTTPS art origin used by the game.

No real bucket or CDN erasure has been claimed from the offline tests. The
hosted acceptance must prime cached files, revoke the model, verify the fallback
for self/peers and confirm that old object URLs no longer deliver the removed
files. Permanent-marker and billing-record retention still needs the policy
and pruning work listed in the implementation handoff.

## Rollback

Stop admission first. For an emergency, set the kill switch. It pauses the
queue: no new paid stage starts and nothing publishes, and every pending job
keeps its monthly slot, reservations and provider call ID. Clearing the switch
resumes each job where it stopped. A paused job is not ended or refunded, so a
player can still cancel it, and an operator who wants the queue emptied must
end those jobs deliberately. Work already accepted by a provider can still be
billed. Preserve its job records and unresolved private journals.

After the queues are settled, disable dispatch if needed and redeploy the exact
previous source plus its verified archives and recognition pins. Never mix
movement releases or overwrite an existing public revision. Display can be
disabled independently to restore the existing portrait fallback. Confirm normal
login/travel and the expected library/job state before reopening generation.

Full release qualification still requires the hosted fresh-avatar test and the
requirements tracked in the implementation handoff; a local preview is not that
test. The old 808-pose runtime does not estimate the current complete package.
