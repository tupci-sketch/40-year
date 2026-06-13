# The 40Yr Virgil — club website

*One Club. One Squad. One Dream. Est. 2024 · EA Sports FC 26 Pro Clubs.*

A static single-page site (GitHub Pages) backed by ONE Google Apps
Script web app and ONE Google Sheet. EA's API stopped answering, so
the club keeps its own books now: every match, scorer and stat is
managed game-by-game from the Housekeeping console and stored in the
Sheet. The backend ships pre-loaded with the recovered archive — 37
logged matches, per-player stats for the detailed games, the three
humans' career snapshots and the all-time club record.

## Layout

```
index.html              the whole app shell (one page, hash routing)
css/styles.css          all styling, mobile-first
js/config.js            window.APP_URL → your Apps Script /exec URL
js/data.js              squad & formations — identity only, no stats
js/ui.js                shared render helpers
js/net.js               transport — every call POSTs {game:"v40", kind}
js/app.js               router + pages (archive maths lives here)
js/tactics.js           the tactics board
js/admin.js             Housekeeping console ("The Ledger")
backend.gs              the Apps Script backend ("The Archivist")
assets/img/             crest + player cards
```

## Deploying the backend (upgrade over the old one)

1. Open the existing Apps Script project.
2. Select everything in the editor, paste in `backend.gs`, **Save**.
3. **Deploy → Manage deployments → ✏ edit → New version → Deploy.**
   The `/exec` URL does not change; the site keeps working.
4. Load the site once. The first request creates the new tabs and
   seeds the full archive automatically. Existing accounts, chat and
   config are untouched. The old `ea_*` tabs stay as curios; the old
   hourly trigger deletes itself the next time it fires.

Fresh install instead: paste `backend.gs` into a new Apps Script
project, run `setup()` once (grant permissions), then Deploy → Web
app (Execute as **Me**, access **Anyone**) and put the `/exec` URL in
`js/config.js`.

## How the numbers work

- **The match ledger is the source of truth.** Every game is a row;
  scorers and optional per-player stats hang off it. Mods (level 5+)
  add and edit matches; only the admin (level 9) can delete one.
- **Careers = baseline + everything after it.** The EA career
  snapshot is stored "as of match #37". Matches logged after the
  baseline top it up automatically — goals from the scorer list
  always; appearances/assists/ratings only when a detailed stat line
  is entered for that player. Same idea for the club record.
- **Identity lives in `js/data.js`,** numbers never do.

## Accounts & levels

First account to register becomes level 9 (the keys). Levels: 1 fan ·
5+ steward/mod · 9 admin. The server re-checks the level on every
action — the client only decides what to draw.

## Troubleshooting

- **"Backend not connected"** — `js/config.js` has no `/exec` URL.
- **"The ledger is warming up"** — first request after deploy is
  still seeding; give it a few seconds and refresh.
- **"Can't reach the clubhouse"** — Apps Script hiccup; try again.

## v3 update — what's new

- **Faster:** player cards cropped + converted to WebP (18.45 MB → 1.19 MB), scripts deferred, crest preloaded.
- **Stats:** Goals Against on the home record; a "biggest contributors" board (goals + assists per game); the wide career/opposition tables now scroll on mobile instead of overflowing.
- **Squad voice:** Donovan is she/her throughout; Tupci carries a "THE SYSTEM" badge.
- **Match types:** League / Playoff / Cup / Friendly / International / Other, each with an optional competition name (e.g. "England v Germany").
- **Upcoming fixtures:** managed in Housekeeping, shown atop Results.
- **New pages:** News (The Gazette), Socials (a self-updating TikTok creator embed), the members-only Forum (The Dressing Room), and a gag Tickets page.
- **Security:** Content-Security-Policy + referrer policy; Cloudflare Turnstile on register/login.
- **Squad management (admin):** add, edit, or hide players from Housekeeping → "Squad · players" — identity only; stats and match history are never touched. Hidden players drop off the squad and team-sheet pickers but stay attached to past results.
- **Easter eggs:** Konami code, five taps on the crest, and a few club in-jokes.

### Cloudflare Turnstile (bot check)

The public **site key** is already in `js/config.js`. Add the **secret key** to the Apps Script project so it stays private:

> Apps Script → ⚙ **Project Settings** → **Script Properties** → **Add script property** → name `TURNSTILE_SECRET`, value = your secret → **Save**.

If the secret is not set, the check is skipped and the site still works. To hide the widget entirely, blank out `window.TURNSTILE_SITEKEY` in `js/config.js`.

Other edge headers (`frame-ancestors` / `X-Frame-Options` / HSTS) can't be set from a `<meta>` tag — add them at the Cloudflare edge if you want them.

### ⚠ Keep `backend.gs` private

`backend.gs` now seeds personal data (names, birthdays, partners) that is **off by default** and only sent to browsers when a level-9 toggle is switched on. That privacy only holds if the file itself stays private:

- Paste `backend.gs` **only** into the Apps Script editor.
- **Do not** commit `backend.gs` to the public GitHub Pages repo. If it's already there from before, delete it from the repo.

The personal toggles live in Housekeeping → "Personal · birthdays & better halves" (admin only). Birthdays and partner cameos each have their own switch; both start off.
