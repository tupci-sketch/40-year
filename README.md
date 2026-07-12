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

## Deploying the backend (a rebuilt, drop-in-compatible `backend.gs`)

The backend source was rebuilt from the site's own client contract and the
live Sheet's exact layout. It is **drop-in compatible**: same tabs, same
password/session hashing (same `PEPPER` script property), so every existing
login and all archived data keep working.

1. **Back up first.** Copy the current Apps Script editor code somewhere safe —
   that text *is* your live backend and your only rollback.
2. Open the existing Apps Script project, select everything, paste in
   `backend.gs`, **Save**.
3. **Run `healthCheck()` from the editor** (Run ▸ `healthCheck`) and read the
   Execution log. It must show each tab's row count and `schema OK`. This is
   read-only apart from appending any missing header columns — it changes no
   data.
4. Only then **Deploy → Manage deployments → ✏ edit → New version → Deploy.**
   The `/exec` URL does not change; the site keeps working.
5. Load the site once and confirm an existing user (e.g. `tupci`) is still
   signed in / can sign in, and the record, careers and results read as before.

Fresh install instead: paste `backend.gs` into a new Apps Script project, run
`setup()` once (grant permissions), then Deploy → Web app (Execute as **Me**,
access **Anyone**) and put the `/exec` URL in `js/config.js`. Seeding is guarded
by the `archive_seeded` config flag, so it never overwrites an existing archive.

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

**What each level can do in Housekeeping:**

- **L5+ (mods):** log/edit matches, fixtures, squad identity, socials
  (TikTok + Twitch), player flavour, milestones, the announcement banner,
  and Fun & Games — plus chat and forum moderation.
- **L9 (admin only):** the things that could rewrite history or break trust —
  deleting matches, career + club-record baselines, the lore, user levels and
  bans, personal data (birthdays/partners), and archiving a season.

## Troubleshooting

- **"Backend not connected"** — `js/config.js` has no `/exec` URL.
- **"The ledger is warming up"** — first request after deploy is
  still seeding; give it a few seconds and refresh.
- **"Can't reach the clubhouse"** — Apps Script hiccup; try again.

## v3 update — what's new

- **Faster:** player cards cropped (black borders removed) and resized/optimised as PNGs (~18 MB → ~12 MB, same filenames), scripts deferred, crest preloaded.
- **Stats:** Goals Against on the home record; a "biggest contributors" board (goals + assists per game); the wide career/opposition tables now scroll on mobile instead of overflowing.
- **Squad voice:** Donovan is she/her throughout; Tupci carries a "THE SYSTEM" badge.
- **Match types:** League / Playoff / Cup / Friendly / International / Other, each with an optional competition name (e.g. "England v Germany").
- **Upcoming fixtures:** managed in Housekeeping, shown atop Results.
- **New pages:** News (The Gazette), Socials (a self-updating TikTok creator embed), the members-only Forum (The Dressing Room), and a gag Tickets page.
- **Security:** Content-Security-Policy + referrer policy; Cloudflare Turnstile on register/login.
- **Squad management (admin):** add, edit, or hide players from Housekeeping → "Squad · players" — identity only; stats and match history are never touched. Hidden players drop off the squad and team-sheet pickers but stay attached to past results.
- **Easter eggs:** Konami code, five taps on the crest, and a few club in-jokes.

## v4 update — what's new

- **One stat entry, not two.** The match editor merged the old *Scorers* and
  *Per-player stats* sections into a single **Players** list — enter each
  player's line once and the scoresheet is derived from the Goals field.
  Legacy scorer-only matches fold in automatically when you open them.
- **Squad moves:** SWAY removed everywhere. **Amy Whimsy** joins as the human
  **#8** (she takes the shirt in every formation); **Donovan** is retained as a
  separate **RETIRED · AI** #8 — the EA-AI original, cross-linked to Amy, stats
  never merged. New signing **Funky Cool Medina (#21)**, an AI central mid.
- **Socials:** Twitch (`40yrvirgil`) added beside TikTok; both handles editable
  in Housekeeping → "Socials".
- **The Funhouse** (new page): the manager wheel plus a Random XI generator,
  chant machine, squad superlatives, an Oracle, a transfer-rumour mill and
  Player of the Matchday. Every word-list is editable in Housekeeping →
  "Fun & Games". The tactics board gained a **🎲 Gaffer's XI** shuffle.
- **Access levels rebalanced** so mods (L5) can run the day-to-day club; only
  history/trust-critical actions stay admin-only (see *Accounts & levels*).
- **Season archiving groundwork:** the backend now tracks seasons and can
  archive one (snapshotting its record + careers read-only) and start a fresh
  season under the same club — ready for FC26 → FC27 in September.
- **Backend rebuilt:** `backend.gs` was re-authored from the client contract and
  the live Sheet schema, drop-in compatible with all existing data, and ships
  with a `healthCheck()` you run before redeploying.

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
