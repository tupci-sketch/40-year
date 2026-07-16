/* ============================================================
   The 40Yr Virgil — static reference data (v3)
   ------------------------------------------------------------
   HARD RULE: no player identity, no stats, no scorelines live in
   this file any more — those come from the API (window.SQUAD is
   populated at runtime from GET /api/squad). This file holds only
   things with no database row: formation shapes, the position
   whitelist, and the Funhouse's client-only joke content.
   ============================================================ */

window.CLUB = {
  name: "The 40Yr Virgil",
  est: "2024",
  tagline: "One Club. One Squad. One Dream.",
  values: [
    { key: "loyalty", label: "LOYALTY", icon: "shield",
      blurb: "You don't leave. You can't leave. The group chat would notice." },
    { key: "heart",   label: "HEART",   icon: "heart",
      blurb: "Full commitment to every tackle the game engine allows us to make." },
    { key: "glory",   label: "GLORY",   icon: "star",
      blurb: "Promotion, silverware, or at minimum a very dramatic screenshot." }
  ],
  game: "EA Sports FC 26 · Pro Clubs",
  season: "Season 3"
};

/* Populated at runtime from GET /api/squad — see applySquad() in app.js. */
window.SQUAD = [];

/* ------------------------------------------------------------
   Formations — slot shapes only (pos + pitch coordinates). The
   tactics board auto-fills every slot from the live roster; there
   is no fixed "default occupant" any more.
   x: 8 = left touchline, 50 = centre, 92 = right touchline.
   y: measured from OUR goal — GK ≈ 6, attack ≈ 90.
   ------------------------------------------------------------ */
window.FORMATIONS = {
  "4-2-1-3": {
    label: "4-2-1-3",
    note: "The double-DM pivot. Width up top, steel underneath.",
    slots: [
      { pos: "GK",  x: 50, y: 6 },
      { pos: "LB",  x: 16, y: 26 },
      { pos: "CB",  x: 38, y: 22 },
      { pos: "CB",  x: 62, y: 22 },
      { pos: "RB",  x: 84, y: 26 },
      { pos: "DM",  x: 38, y: 45 },
      { pos: "DM",  x: 62, y: 45 },
      { pos: "CAM", x: 50, y: 62 },
      { pos: "LW",  x: 18, y: 82 },
      { pos: "ST",  x: 50, y: 86 },
      { pos: "RW",  x: 82, y: 82 }
    ]
  },
  "4-4-1-1": {
    label: "4-4-1-1",
    note: "The creative central two. The DMs sit this one out.",
    slots: [
      { pos: "GK",  x: 50, y: 6 },
      { pos: "LB",  x: 16, y: 26 },
      { pos: "CB",  x: 38, y: 22 },
      { pos: "CB",  x: 62, y: 22 },
      { pos: "RB",  x: 84, y: 26 },
      { pos: "LM",  x: 16, y: 52 },
      { pos: "CM",  x: 38, y: 50 },
      { pos: "CM",  x: 62, y: 50 },
      { pos: "RM",  x: 84, y: 52 },
      { pos: "CAM", x: 50, y: 68 },
      { pos: "ST",  x: 50, y: 88 }
    ]
  },
  "4-1-2-1-2": {
    label: "4-1-2-1-2",
    note: "The narrow diamond. Everyone else plays where they usually play.",
    slots: [
      { pos: "GK",  x: 50, y: 6 },
      { pos: "LB",  x: 16, y: 26 },
      { pos: "CB",  x: 38, y: 22 },
      { pos: "CB",  x: 62, y: 22 },
      { pos: "RB",  x: 84, y: 26 },
      { pos: "DM",  x: 50, y: 42 },
      { pos: "CM",  x: 36, y: 56 },
      { pos: "CM",  x: 64, y: 56 },
      { pos: "CAM", x: 50, y: 70 },
      { pos: "LST", x: 40, y: 88 },
      { pos: "RST", x: 60, y: 88 }
    ]
  }
};

window.DEFAULT_FORMATION = "4-2-1-3";

/* Whitelist for player.positions[] (up to 3, primary first). Editable per
   player in Housekeeping → Squad; enforced again server-side. */
window.POSITIONS = ["GK", "RB", "RWB", "CB", "LB", "LWB", "CDM", "CM", "CAM", "RM", "LM", "RW", "LW", "CF", "ST"];

/* ------------------------------------------------------------
   The Gaffer — joke candidates for the random-manager wheel (a
   Funhouse toy; unrelated to Advanced Gaffer, the serious per-match
   manager record stored in the database). Squad members are mixed
   in at runtime; this is client-only content, no backend needed.
   ------------------------------------------------------------ */
window.GAFFER_NAMES = [
  "Big Hands Trev",
  "Don Tactico",
  "The Hairdryer",
  "Sir Clipboard OBE",
  "Coach Algorithm",
  "Gaffer.exe",
  "Uncle Pressing",
  "Professor Park-the-Bus",
  "Beans Marinara",
  "The Lad From Pub League",
  "Mister Second Ball",
  "Agent Whizzy Snr",
  "Wee Davie Whiteboard",
  "Il Maestro di FIFA Points",
  "Sensei Cross-It-In",
  "Barry Two-Banks-Of-Four"
];

window.GAFFER_QUOTES = [
  "“We go again.”",
  "“The lads were magnificent. The router was not.”",
  "“Tactics are temporary. The Virgil is forever.”",
  "“I told them at half time: pass it to the purple shirts.”",
  "“Football is simple. Our lobby connection is not.”",
  "“We respect every opponent. We fear no algorithm.”",
  "“Ask the data. The data says we believe.”"
];

/* ------------------------------------------------------------
   The Funhouse — defaults for every editable club toy. These are
   only fallbacks: the live lists come from GET /api/site-settings
   (fun) and are edited from Housekeeping → Fun & Games.
   Placeholders in chants/rumours: {name} = a random squad surname,
   {full} = full name, {opp} = a mystery opponent.
   ------------------------------------------------------------ */
window.FUN_DEFAULTS = {
  gaffer: {
    names: window.GAFFER_NAMES.slice(),
    quotes: window.GAFFER_QUOTES.slice(),
    pinned: ""
  },
  chants: [
    "Oh {name}, {name}, he/she gets the ball and then it's in the net!",
    "{full}! {full}! The purple army sings your name!",
    "We've got {name}, super {name}, we've only got the one — but that's enough for us!",
    "Sign him up, sign her up, {name}'s on the teamsheet — up the Virgil, we go marching in!",
    "From the sofa to the stands, forty years and one big dream — {name}'s the name we scream!",
    "{name} on the wing, {name} scores again, the router held, the lads went in — we go again!"
  ],
  superlatives: [
    "Player of the Season",
    "Most likely to argue with the ref",
    "Best in the group chat",
    "Worst FIFA points spender",
    "Most likely to blame the router",
    "Golden Boot of the sofa",
    "Most dramatic screenshot",
    "Captain's Player of the Year",
    "Most likely to score then refuse to celebrate",
    "The one the lobby connection loves to punish"
  ],
  oracle: [
    "The wheel says: 3–1. Comfortable.",
    "It is written. You win, but the router makes you sweat.",
    "Ask again after half time.",
    "The algorithm foresees a Rizzy Dave non-appearance.",
    "Signs point to a very dramatic screenshot.",
    "Draw. Nobody's happy. Everybody blames Dan.",
    "Tupci scores. Obviously. He's the system.",
    "The data is unclear — but the vibes are immaculate.",
    "Defeat. But a moral victory, which is the only kind that counts here.",
    "Clean sheet incoming. Donovan sends her regards."
  ],
  rumours: [
    "{full} 'has held talks' with {opp} — the group chat is in meltdown.",
    "BREAKING: {opp} table a shock bid for {name}. The board laughed, then blocked their number.",
    "{name} spotted liking a {opp} post. Loyalty committee convened at once.",
    "Sources close to {name} insist he/she is '100% committed to the sofa'.",
    "{opp} readying an audacious swoop for {full}. Fee: vibes and a firm handshake.",
    "{name} to {opp}? 'Absolutely not,' said a spokesperson who is also the captain."
  ],
  rumourClubs: [
    "a Championship mystery club", "Real Sofa CF", "Kitchen Athletic", "Dial-Up Rovers",
    "FC Router Disaster", "Pub League United", "the away end", "Betfred Arena's rivals"
  ]
};
