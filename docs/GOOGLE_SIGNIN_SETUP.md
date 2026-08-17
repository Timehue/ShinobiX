# Google sign-in — operator setup

Everything in this file happens in Google's consoles, signed in as the account
that owns the project. None of it can be done from the repo. The code side is
finished and inert until the three env vars in step 5 are set.

The good news first: Shinobi Journey requests only `openid`, `email`, and
`profile`. Those are **non-sensitive scopes**, so there is no security review, no
third-party audit, no cost, and no 100-user cap once the app is published. What
follows is mostly form-filling.

> **Console note.** Google replaced the single "OAuth consent screen" page with
> the **Google Auth Platform**, which splits the same settings across
> Branding / Audience / Clients / Data Access / Verification Center. If a guide
> tells you to pick "User type: External" on the consent screen, that choice now
> lives under **Audience**. Names below match the current UI.

---

## 1. Select or create the project

The Google Auth Platform pages are empty until a project is selected — an
"Overview / To view this page, select a project" screen means no project is
active yet, not that anything is misconfigured.

Use the project picker in the top bar, or **Create project**. One project holds
the whole configuration.

---

## 2. Google Auth Platform → Get started

With the project selected, **Overview → Get started** walks through four steps in
this order:

1. **App information**
   - App name: `Shinobi Journey`
   - User support email: your contact address
2. **Audience** — choose **External**. This is where the old "User type" lives.
   External means any Google Account can sign in, which is what a public game
   needs. (Internal is Workspace-organisation only and does not apply here.)
3. **Contact information** — an address for Google's project notifications.
4. **Agree to the user data policy**, then **Create**.

---

## 3. Fill in Branding and Data Access

**Branding** — these are the links Google shows on the consent screen and checks
during verification, so they must resolve and be accurate:

| Field | Value |
|---|---|
| App name | `Shinobi Journey` |
| Application home page | `https://shinobijourney.com` |
| Privacy policy link | `https://shinobijourney.com/privacy` |
| Terms of service link | `https://shinobijourney.com/terms` |
| Authorized domain | `shinobijourney.com` |
| App logo | Optional — see step 6 |

**Data Access → Add or remove scopes** — select exactly:

- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

**Add nothing else.** Any sensitive or restricted scope moves the app into the
review-and-audit track, which is the single thing worth avoiding here.

---

## 4. Clients → Create client

**Clients → Create client → Application type: Web application.**

- **Authorized redirect URIs** — exactly one entry:
  `https://shinobijourney.com/api/auth/google/callback`
- **Authorized JavaScript origins** — leave empty. The flow is a server-side
  redirect and loads no Google script in the browser.

Copy the client ID and client secret for step 5.

### The redirect URI is exact-match — the two ways it goes wrong

Google compares the string, not the destination.

- **Use the apex, not `www`.** `api/_canonical-domain.ts` deliberately does not
  redirect `/api` paths to the canonical host, so a `www` callback is served
  rather than normalised, and Google rejects it as unregistered.
- **No trailing slash, no query string.** `…/callback/` is a different URI.

The server validates the shape of `GOOGLE_REDIRECT_URI` at boot
(`googleRedirectUriProblem`) and refuses to offer Google sign-in if it is wrong,
logging `[startup] Google sign-in is CONFIGURED BUT DISABLED: …`. That turns a
`redirect_uri_mismatch` the player would have hit on Google's own page into a
line in your Railway logs. Check for it after the first deploy.

---

## 5. Railway environment

```
GOOGLE_CLIENT_ID=<from step 4>
GOOGLE_CLIENT_SECRET=<from step 4>
GOOGLE_REDIRECT_URI=https://shinobijourney.com/api/auth/google/callback
```

`SESSION_SECRET` must already be set. A Google account has no password to fall
back on, so the server refuses to create one when session tokens are unavailable
rather than minting an account nobody could ever sign into again.

Optional switches: `GOOGLE_APP_RETURN_URL` (defaults to `/`),
`DISABLE_GOOGLE_AUTH=1`, `DISABLE_GUEST_PLAY=1`.

---

## 6. Audience → Publish app — do not leave it in Testing

**This is the step with a trap.** While publishing status is **Testing**, the app
is capped at 100 users, that cap counts over the project's whole lifetime, and it
**cannot be reset**. Burning it would mean starting a new Cloud project.

**Audience → Publishing status → Publish app.**

Because the app requests only non-sensitive scopes, publishing does **not**
require Google to review anything. There is no queue and no waiting: the status
flips to *In production* and the cap is gone.

---

## 7. Verification Center → brand verification (optional)

Without it, the consent screen identifies the app by **its domain** instead of
its name and logo. Nothing breaks; it just looks unfinished at the exact moment
you are asking someone to trust you with their Google account.

To get the name and logo shown:

1. Verify ownership of `shinobijourney.com` in **Google Search Console**, using
   the same Google account that owns the Cloud project. Every domain used in the
   home page, privacy policy, terms, and redirect URI must be verified — here
   they are all the one apex domain.
2. **Verification Center** → submit for brand verification.

Two things to know afterwards: changing the name, logo, home page, privacy link,
or authorized domains later drops branding back to Draft and needs re-publishing;
and the "Sign in with Google" button styling is itself part of what verification
checks. The button in `screens/start/LoginGate.tsx` follows Google's light-theme
custom-button spec (fill `#FFFFFF`, 1px `#747775` stroke, `#1F1F1F` text, 12px
edge padding, 10px after the logo, unmodified four-colour mark). It is a custom
button because the site's CSP blocks Google's hosted script.

**One known deviation, and how to close it if verification ever objects.** Google
specifies Google Sans Medium for the label. It is not bundled here, and
`font-src 'self' data:` blocks fetching it from Google Fonts — deliberately,
since the privacy policy states there are no third-party requests. The stack
falls back to the nearest face each platform already ships (Roboto, SF, Segoe
UI, Noto). Everything else about the button — fill, stroke, text colour,
padding, logo geometry — matches exactly. To close the gap: drop a `woff2` into
`shinobij.client/public/fonts/`, add a `@font-face` in `landing-skin.css`, and
put the family first in `.gate-google-btn`. Do **not** add an external
`<link>` — the CSP blocks it, and it would falsify the privacy policy.

---

## 8. After the first deploy

- Read the Railway boot log for `[startup] Google sign-in is CONFIGURED BUT
  DISABLED`. Silence means it is either fully configured or deliberately off.
- `GET /api/player/capabilities` should report `googleSignIn: available`. The
  login screen hides the button on anything else, so a hidden button is the
  symptom to check this against.
- Walk the four paths once against production: sign up fresh with Google; sign
  out and back in and land on the same character; link Google to an existing
  password account from Profile; play as a guest and then claim it with Google,
  confirming the save survives.

## 9. Guest sweep

Guest characters are reclaimed after 14 days of inactivity by the daily cron.
It ships in **dry-run**: it logs what it would delete and deletes nothing until
`GUEST_SWEEP_ENABLED=1`. Read a night or two of
`[cron-scheduler] guest sweep (DRY RUN …)` before switching it on.
