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

The local painted release archives are `portable-fit-worker/painted-sleeves-tail.zip`
and `portable-motion-worker/painted-sleeves-tail.zip` under the avatar-model
evidence folder. Their hashes match `sprite-worker-painted-review.json`. Each is
the matching `painted-sleeves.zip` with one file changed, and its index carries
the new file hash (`intake.json` also a recomputed `paintingRevision`); every
other entry is byte-identical. The release before them, and the rollback, is
`painted-sleeves-fit.zip` (intake `88b82b0d…`) with
`painted-sleeves-wide-torso.zip` (movement `6fc5ea69…`).

- `register_painted_kit.py` (intake) checks each painted torso's width-to-height
  ratio against its guide at paint time. Every view outside 0.6–1.75 is named in
  one `PaintingGeometryError` that says how much narrower or wider to paint it.
  A costume gets one painting and up to two repairs (`PAINT_ATTEMPTS`), each shown
  the sheet just rejected. On the last one, a torso up to 30% past the range is
  drawn at the nearest bound; further out, the job fails and the slot is refunded.
  Before this, the sheet was accepted and `render_fitted_roster.py` refused it on
  every render retry ("Invalid painted body proportions").
- `render_fitted_roster.py` (movement) accepts the same 0.6–1.75 range, up from
  0.72–1.45, so bulky armor keeps its painted breadth. The renderer widens the
  torso about the hip axis and moves the sleeve sockets with it; at 1.75 the
  figure stays well inside the 400 px render frame.

- A tail has no rig piece of its own, so the painter attaches it to the torso
  cutout. Counted as torso width it pushed the trunk off the hips and left the
  sleeve socket on the tail side out past the shoulder, with ground showing
  between arm and body. `register_painted_kit.py` now tells a part that trails
  off one side from the trunk (`trailing_part`): it compares the painted chest
  with the guide's chest, and only a one-sided excess of 0.2 chest widths or
  more counts, so a costume that is broader on both sides fits as before. The
  measure runs from the cutout's edges, so anything one-sided counts, not only a
  tail: a ponytail or a cape end streaming to one side is kept off the trunk the
  same way, which centres those characters better than before. The
  torso range is judged on the trunk alone, and the trailing part is recorded
  per view as `bodyOverhang` (trunk widths per side). `render_fitted_roster.py`
  places the trunk on the hips, keeps the sockets on the painted shoulders and
  lets the trailing part hang past the trunk. A fitted master with no trailing
  part has no `bodyOverhang` and renders byte-identical to before. A part that
  would leave the render frame is sent back for a repaint; on the last attempt
  it is trimmed.

`paint_portrait.py` adds the torso-fit rule to the first prompt for new jobs
(and, for an animal character, where its tail goes), and
`paint_admitted_costume.py` reserves three edits. The packer's source tree must
carry the same bundle edits, or a later repack drops them; the edited files sit
next to the archives with the archive's name as a prefix. For the earlier
reader release the matching files are `portable-fit-worker/profile-intake.zip`
and `portable-motion-worker/browser-motion.zip`. Use the two inputs from the
same release.

For painted costumes, the dedicated secret `shinobix-avatar-costume-paint`
contains that feature's OpenAI key as `OPENAI_API_KEY` by default.
Set `SPRITE_OPENAI_SECRET` at deployment to reuse an existing Modal secret
for painting and recognition. The portrait reader uses the same key for one
two-legged-character question (`upright_animal.py`, pinned model, no retries).
Every model is painted on the same human-shaped rig, so the question admits any
single illustrated character that walks on two legs: an animal becomes
`upright-animal` (painted with the species, muzzle, fur and tail prompt), anyone
else becomes `upright-character` (painted with the human close-up prompt), which
covers the bald, helmeted, masked, horned and animated humans, elves and robots
that the detector's strict human checks decline. It refuses photos, groups and
four-legged animals. The question is asked after any intake decline. If the
fallback fails on a decline that is not `*-uncertain` (the ones it reaches only
since every bipedal character is screened), the original decline stands, so the
player keeps the monthly model instead of seeing a failure. It is
never asked about a human close-up or an armored raccoon that the detector
already admits. A
provider error fails the read and never admits a portrait. The game server must
know both styles (`api/avatar-model/read.ts`) before a worker that emits them is
deployed.

Every painted sheet is checked for likeness before the rig accepts it
(`painted_likeness.py`, same key and pinned model). The head-and-torso row of
all eight directions goes to the vision model beside the portrait, which says
whether the species, the head and the main costume colors still match. A
mismatch is refused like a geometry failure, so `paint_screened_upload` repairs
the same sheet with the check's note, and a third refusal ends the job at once
(a system failure, so the creation is returned). This exists because a raccoon
was painted on 2026-11-19 as the black-haired human in a dark coat and red scarf
from `sector-costume-light.png`, and only the blind review an hour later noticed.
The check asks twice at most. A provider error or a malformed answer accepts the
painting, and the final review still decides.

Painted costumes keep the portrait's colors (`costume_palette.py`). The edit
prompt names the portrait's main colors. The returned sheet is then corrected
per hue family until, shrunk to world-sprite size, it carries the portrait's
saturation and brightness. A world sprite is about 36 pixels wide and its frames
are H.264 with half-resolution color, so an uncorrected sheet reads grey in the
world. The correction only adds color, it leaves fur, steel and outlines as
painted, and a failure keeps the paid painting unchanged. A job whose first edit
was billed before this step replays with its original prompt. For recognition, follow
[RECOGNITION.md](RECOGNITION.md): deploy the owner-approved pool ZIP, its complete
hash and a pinned vision model. The separate `shinobix-avatar-recognition`
secret supplies the scoped private R2 credentials. No session,
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
holds one job's Modal cost while it runs, in the current UTC month; OpenAI spend is
guarded by the OpenAI account's own limit, not by the policy. There is no daily cap.
Display, creation and dispatch are independent flags. Missing configuration must
be handled without preventing login, travel or NPC display.

Roll out the game server before updating the Modal worker. The updated dispatcher
can publish both existing motion-only revisions and new revisions with a combat
WebP. Use the existing dispatch pause if you need to hold new finishes between
the two deployments.

Style A binds the combat sprite's WebP checksum to its stage receipt. Assembly
includes that WebP in the new public revision. Previously completed stages and
published revisions retain their original art.

The combat sprite is its own painting (`paint_battle_sprite.py`). The world
model is drawn to read at 73 pixels, so posing it for the battle board gave a
soft, stiff fighter. After the costume sheet is accepted, the costume call sends
one more image edit: the portrait for identity, the accepted sheet for the rest
of the outfit, and `battle-stance-reference.png` (one of the bundled fighters)
for stance, camera and finish. The result is refused unless it is one whole
figure on a transparent ground; a refused painting gets one repair, shown the
refused art and told what was wrong. It is then framed like a bundled fighter (384 px
canvas, figure on the 368 px line), moderated with the same check the server
runs on the sheet, mirrored if a vision check says it faces right, and saved as
WebP. It waits in the Modal Dict `shinobix-avatar-battle-sprites`, keyed by
asset and bound to the painted master, until style A publishes it; assembly then
drops the waiting copy, and an entry that is never collected expires after
seven days. The edit shares the costume call's single execution, so it is never
sent twice, and each edit's billing record joins that call's `edits`. Any failure, a
flagged sprite, or too little time left in the call leaves the job on the posed
world model (`battle_pose.py`), framed on the same canvas; the combat painting never fails a job. Deploy
the worker before or after the game server; neither depends on the other.

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
   moved through all three run styles. Start a fight and verify the battle board
   loads the WebP named by the equipped manifest and shows the guard from the
   Combat row of the package preview. Record elapsed time, recognition
   outcome, the equipped manifest hash and delivery checks on desktop and mobile.
4. Settle the provider statements against that job. Revoke the staging model
   after priming its public URLs, confirm the starter returns, and verify the
   public files, including the combat WebP, CDN variants and retained private fit
   have been erased. Keep the receipts and stage timings with the release evidence.

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

The three run styles render side by side. The dispatcher still walks A, B, C,
finish in order. Once the current style's call is known, it also starts every
style that is neither finished nor running, records those calls in the job's
`running` map and `providerCalls`, and adopts each one when the walk reaches it.
A style that fails is retried alone, and the others keep their renders. An
early start whose reply was lost keeps its attempt in `startingAt` until its
call is known, so a later retry cannot orphan a call it started, and the walk
waits for it (with the usual six-hour grace) instead of starting a second
render. An early start that errors is logged and skipped, so it never holds up
the style being polled. An early start cannot know the first style's movement
revision, so polls leave that check to the dispatcher: a style that finishes on
another revision (a worker redeploy mid-job) is rendered again, bound to the
job's revision.
`render_style` runs the three in one container, three inputs at a time, not in
three containers. The styles share their walking and standing frames, assembly
requires those to match byte for byte, and the leg renderer's output differs by
a few edge pixels between machines: a 2026-11-18 trial on three containers
rendered every style and then failed assembly with "Incompatible movement
banks". Keep it at one container unless that check is first made tolerant, or a
job's three styles are rendered inside one call. Every other step runs up to
`PARALLEL_JOBS` (3) machines, so several players' checks, paintings,
recognitions and assemblies run side by side; renders still go one job at a time. Ending a job does not stop
style calls already running, so one cancelled early can still bill up to three
renders, all recorded on the job.

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
