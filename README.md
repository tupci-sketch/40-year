# The 40Yr Virgil — Club Website

*One Club. One Squad. One Dream. Est. 2024 · EA Sports FC 26 Pro Clubs.*

A mobile-first, broadcast-styled single-page site for the club. Vanilla
HTML/CSS/JS — no build step, no framework. It talks to **one** Google Apps
Script backend that pulls the EA Pro Clubs API every hour and saves a
permanent archive to a Google Sheet.

The backend is **already deployed** and its `/exec` URL is wired into
`js/config.js`. To put the site live you only need to host these files.

---

## What's in here

```
index.html              the whole app shell (11 screens)
.nojekyll               tells GitHub Pages to serve js/ + assets/ untouched
favicon.ico             generated from the crest
apple-touch-icon.png    180×180 home-screen icon
css/styles.css          the full stylesheet
js/config.js            ← the one setting: your backend URL (already filled in)
js/data.js              squad, roles, formations (identity only — no stats)
js/net.js               backend client (sessions, fail-soft transport)
js/ui.js                shared render helpers + EA-persona matcher
js/tactics.js           the interactive drag-and-drop tactics board
js/admin.js             the Housekeeping console
js/app.js               router + every public screen
assets/img/             the crest + 15 player cards
backend.gs              the Apps Script source (already deployed — kept for reference)
```

> `backend.gs` lives here only as the source of record. It runs on Google's
> servers, **not** on GitHub Pages. You don't upload it anywhere else.

---

## Deploy the site (GitHub Pages)

1. Create a new GitHub repository and push **everything except `backend.gs`**
   (it's harmless if you include it — Pages just ignores it — but it doesn't
   need to be there).
2. Repo **Settings → Pages**.
3. **Source:** *Deploy from a branch* → branch `main`, folder `/ (root)` → **Save**.
4. Wait ~1 minute. Your site is at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

That's it. The site is already pointed at your live backend.

### One optional polish — social link previews

In `index.html` the two Open Graph `og:image`/`og:url` tags use a relative
path. If you want the crest to show when the link is shared on WhatsApp /
Discord / etc., swap that one line for your full URL, e.g.

```html
<meta property="og:image" content="https://YOUR-USERNAME.github.io/REPO-NAME/assets/img/crest.png">
```

Everything else works fine without touching it.

---

## First run — claim the admin account

1. Open the live site, open the menu, **Sign in · Register**.
2. Register the **first** account — it automatically becomes the **level-9
   admin**. (Choose the password carefully; the first one through the door
   gets the keys.)
3. A new **Housekeeping** tab appears in your menu. From there you can:
   - post the announcement banner
   - write the club lore (shows on the About page once it's non-empty)
   - add manual results for games the API missed
   - hit **Pull from EA now** and view the raw snapshot to confirm the feed
   - manage users (promote to mod = level 5, ban/unban)
   - set per-player flavour lines and add honours milestones

Promote a friend to **level 5** to give them chat-moderation powers (a small
**×** appears on every chat message for mods).

---

## How the data works (the house rules, in code)

- **EA is the only source of stats.** Nothing numeric is typed into the site.
  Goals, results, division, ratings — all of it comes from the saved archive.
- **The archive is permanent.** The backend pulls hourly and *saves* to the
  Sheet. Matches are upserted by match ID and never deleted, so even after EA
  forgets an old game, your record keeps it. Club stats are stored as a time
  series — that's what powers the auto-charting honours timeline (promotions
  and relegations appear on their own as your division changes).
- **In-game names only.** No real names anywhere, by design.
- **Manual results lose to the API.** If you hand-enter a game and EA later
  reports the same fixture (same date + opponent), the real one wins
  automatically.

### Where the Google Sheet is

The backend created a spreadsheet called **"The 40Yr Virgil — Club Data"** in
the Google account that owns the Apps Script. Open the Apps Script project →
run `setup` again any time to see its URL logged, or find it in that account's
Google Drive. You normally never need to touch it — it's the archive.

---

## If live data ever looks empty

The site degrades gracefully and tells you which case you're in:

- **"Waiting on the league"** — the backend answered but EA hasn't returned
  data yet. Hit **Pull from EA now** in Housekeeping, or wait for the hourly
  sync. Check the **raw snapshot** to see exactly what EA sent.
- **"Can't reach the clubhouse"** — the backend itself didn't answer. Confirm
  the Apps Script web app is still deployed as *Execute as: Me / Anyone*.

The hourly pull runs on its own via a time trigger created during `setup`.
You don't have to do anything to keep the archive growing.

---

## Player ↔ EA matching

Each squad member in `js/data.js` has an `eaPersona` field, currently blank.
The site fuzzy-matches your in-game names to EA personas automatically, but if
a particular player isn't picking up their stats, open their profile, note the
EA persona shown at the bottom of any matched player, and paste the exact
persona string into that player's `eaPersona` in `js/data.js`. Re-push and the
match is locked in.

---

*Loyalty · Heart · Glory.*
