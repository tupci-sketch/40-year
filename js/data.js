/* ============================================================
   The 40Yr Virgil — squad & formations (identity only)
   ------------------------------------------------------------
   HARD RULE: no stats, no scorelines, no tallies live in this
   file. Numbers shown on the site come from the club's own
   archive (the backend), kept match by match via Housekeeping.
   This file is who we are, not how we're doing.
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
  season: "Season 2"
};

/* ------------------------------------------------------------
   Squad — 15 names. Three humans, the rest AI.
   `eaPersona` stays "" until the first live pull tells you the
   exact persona string; the site also fuzzy-matches by name.
   `flavour` is words only — never numbers.
   ------------------------------------------------------------ */
window.SQUAD = [
  {
    id: "yeyu", number: 1, name: "Ye Yu II", position: "GK",
    card: "gk_yeyu.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "The last line. Calm as still water, gloves like tide walls.",
    roles: {
      "4-2-1-3":   { start: true, pos: "GK" },
      "4-4-1-1":   { start: true, pos: "GK" },
      "4-1-2-1-2": { start: true, pos: "GK" }
    }
  },
  {
    id: "kubikova", number: 2, name: "Kubikova", position: "RB",
    card: "kubikova.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Right back. Right answers. Rarely consulted, always correct.",
    roles: {
      "4-2-1-3":   { start: true, pos: "RB" },
      "4-4-1-1":   { start: true, pos: "RB" },
      "4-1-2-1-2": { start: true, pos: "RB" }
    }
  },
  {
    id: "alghamdi", number: 3, name: "Al Ghamdi", position: "LB",
    card: "alghamdi.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Owns the left touchline and pays no rent on it.",
    roles: {
      "4-2-1-3":   { start: true, pos: "LB" },
      "4-4-1-1":   { start: true, pos: "LB" },
      "4-1-2-1-2": { start: true, pos: "LB" }
    }
  },
  {
    id: "ferry", number: 4, name: "Ferry", position: "CB",
    card: "ferry.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Carries the back line across, week after week. The name is the job.",
    roles: {
      "4-2-1-3":   { start: true, pos: "CB" },
      "4-4-1-1":   { start: true, pos: "CB" },
      "4-1-2-1-2": { start: true, pos: "CB" }
    }
  },
  {
    id: "moulin", number: 5, name: "Moulin", position: "CM",
    card: "moulin.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Keeps the midfield turning. Grinds everything that comes through.",
    roles: {
      "4-2-1-3":   { start: false },
      "4-4-1-1":   { start: true, pos: "CM" },
      "4-1-2-1-2": { start: true, pos: "CM" }
    }
  },
  {
    id: "pereira", number: 6, name: "Pereira", position: "CB",
    card: "pereira.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Reads the game like a bedtime story. Strikers fall asleep in his pocket.",
    roles: {
      "4-2-1-3":   { start: true, pos: "CB" },
      "4-4-1-1":   { start: true, pos: "CB" },
      "4-1-2-1-2": { start: true, pos: "CB" }
    }
  },
  {
    id: "tupci", number: 7, name: "Tupci", position: "CAM",
    card: "tupci.png", controlledBy: "human", eaPersona: "",
    isCaptain: true, permaBench: false, isSystem: true, pronouns: "he/him",
    flavour: "Captain. Always CAM. Non-negotiable. In footballing terms: the system. The whole side runs through him.",
    roles: {
      "4-2-1-3":   { start: true, pos: "CAM" },
      "4-4-1-1":   { start: true, pos: "CAM" },
      "4-1-2-1-2": { start: true, pos: "CAM" }
    }
  },
  {
    id: "donovan", number: 8, name: "Donovan", position: "CM",
    card: "donovan.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false, pronouns: "she/her",
    flavour: "The engine room. AI-cooled, never overheats, never asks for water breaks.",
    roles: {
      "4-2-1-3":   { start: true, pos: "LW" },
      "4-4-1-1":   { start: true, pos: "CM" },
      "4-1-2-1-2": { start: true, pos: "CM" }
    }
  },
  {
    id: "walker", number: 9, name: "Flake Walker", position: "RM",
    card: "walker.png", controlledBy: "human", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "The other end of the human trio. Owns the right flank — and shifts up to striker when we go two up top.",
    roles: {
      "4-2-1-3":   { start: true, pos: "RW" },
      "4-4-1-1":   { start: true, pos: "RM" },
      "4-1-2-1-2": { start: true, pos: "RST" }
    }
  },
  {
    id: "danwhizzy", number: 17, name: "Danwhizzy", position: "ST",
    card: "danwhizzy.png", controlledBy: "human", eaPersona: "",
    isCaptain: false, permaBench: false, goldenBoot: true,
    flavour: "The talisman. The tally below does the talking.",
    roles: {
      "4-2-1-3":   { start: true, pos: "ST" },
      "4-4-1-1":   { start: true, pos: "ST" },
      "4-1-2-1-2": { start: true, pos: "LST" }
    }
  },
  {
    id: "lejeune", number: 18, name: "Dave Le Jeune", position: "RW",
    card: "lejeune.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Chalk on his boots, fire in the channels, patience on the bench.",
    roles: {
      "4-2-1-3":   { start: false },
      "4-4-1-1":   { start: false },
      "4-1-2-1-2": { start: false }
    }
  },
  {
    id: "zilkov", number: 27, name: "Anton Zilkov Sandomierski", position: "LM",
    card: "zilkov.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Three names. One job. The entire left flank.",
    roles: {
      "4-2-1-3":   { start: false },
      "4-4-1-1":   { start: true, pos: "LM" },
      "4-1-2-1-2": { start: false }
    }
  },
  {
    id: "tmidi", number: 32, name: "Timidi", position: "CDM",
    card: "tmidi.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "Wins the ball first. Asks the questions later. Files no paperwork.",
    roles: {
      "4-2-1-3":   { start: true, pos: "DM" },
      "4-4-1-1":   { start: false },
      "4-1-2-1-2": { start: true, pos: "DM" }
    }
  },
  {
    id: "moreira", number: 43, name: "Moreira", position: "CDM",
    card: "moreira.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: false,
    flavour: "The shield in front of the back four. Through traffic does not pass.",
    roles: {
      "4-2-1-3":   { start: true, pos: "DM" },
      "4-4-1-1":   { start: false },
      "4-1-2-1-2": { start: false }
    }
  },
  {
    id: "rizzydave", number: 69, name: "Rizzy Dave", position: "Sub ST",
    card: "rizzydave.png", controlledBy: "bot", eaPersona: "",
    isCaptain: false, permaBench: true,
    flavour: "Not starting. Still dangerous.",
    roles: {
      "4-2-1-3":   { start: false },
      "4-4-1-1":   { start: false },
      "4-1-2-1-2": { start: false }
    }
  }
];

/* ------------------------------------------------------------
   Formations — slot coordinates per the build brief.
   x: 8 = left touchline, 50 = centre, 92 = right touchline.
   y: measured from OUR goal — GK ≈ 6, attack ≈ 90.
   Each slot carries its default occupant; the board can shuffle
   them, Reset brings these back.
   ------------------------------------------------------------ */
window.FORMATIONS = {
  "4-2-1-3": {
    label: "4-2-1-3",
    note: "The double-DM pivot. Width up top, steel underneath.",
    slots: [
      { pos: "GK",  x: 50, y: 6,  player: "yeyu" },
      { pos: "LB",  x: 16, y: 26, player: "alghamdi" },
      { pos: "CB",  x: 38, y: 22, player: "pereira" },
      { pos: "CB",  x: 62, y: 22, player: "ferry" },
      { pos: "RB",  x: 84, y: 26, player: "kubikova" },
      { pos: "DM",  x: 38, y: 45, player: "moreira" },
      { pos: "DM",  x: 62, y: 45, player: "tmidi" },
      { pos: "CAM", x: 50, y: 62, player: "tupci" },
      { pos: "LW",  x: 18, y: 82, player: "donovan" },
      { pos: "ST",  x: 50, y: 86, player: "danwhizzy" },
      { pos: "RW",  x: 82, y: 82, player: "walker" }
    ],
    bench: ["moulin", "zilkov", "lejeune", "rizzydave"]
  },
  "4-4-1-1": {
    label: "4-4-1-1",
    note: "The creative central two. The DMs sit this one out.",
    slots: [
      { pos: "GK",  x: 50, y: 6,  player: "yeyu" },
      { pos: "LB",  x: 16, y: 26, player: "alghamdi" },
      { pos: "CB",  x: 38, y: 22, player: "pereira" },
      { pos: "CB",  x: 62, y: 22, player: "ferry" },
      { pos: "RB",  x: 84, y: 26, player: "kubikova" },
      { pos: "LM",  x: 16, y: 52, player: "zilkov" },
      { pos: "CM",  x: 38, y: 50, player: "donovan" },
      { pos: "CM",  x: 62, y: 50, player: "moulin" },
      { pos: "RM",  x: 84, y: 52, player: "walker" },
      { pos: "CAM", x: 50, y: 68, player: "tupci" },
      { pos: "ST",  x: 50, y: 88, player: "danwhizzy" }
    ],
    bench: ["tmidi", "moreira", "lejeune", "rizzydave"]
  },
  "4-1-2-1-2": {
    label: "4-1-2-1-2",
    note: "The narrow diamond. Newest page in the playbook — everyone else plays where they usually play.",
    slots: [
      { pos: "GK",  x: 50, y: 6,  player: "yeyu" },
      { pos: "LB",  x: 16, y: 26, player: "alghamdi" },
      { pos: "CB",  x: 38, y: 22, player: "pereira" },
      { pos: "CB",  x: 62, y: 22, player: "ferry" },
      { pos: "RB",  x: 84, y: 26, player: "kubikova" },
      { pos: "DM",  x: 50, y: 42, player: "tmidi" },
      { pos: "CM",  x: 36, y: 56, player: "donovan" },
      { pos: "CM",  x: 64, y: 56, player: "moulin" },
      { pos: "CAM", x: 50, y: 70, player: "tupci" },
      { pos: "LST", x: 40, y: 88, player: "danwhizzy" },
      { pos: "RST", x: 60, y: 88, player: "walker" }
    ],
    bench: ["moreira", "zilkov", "lejeune", "rizzydave"]
  }
};

window.DEFAULT_FORMATION = "4-2-1-3";

/* ------------------------------------------------------------
   The Gaffer — joke candidates for the random-manager shuffle.
   Invented names only; squad members get mixed in at runtime.
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
  "\u201CWe go again.\u201D",
  "\u201CThe lads were magnificent. The router was not.\u201D",
  "\u201CTactics are temporary. The Virgil is forever.\u201D",
  "\u201CI told them at half time: pass it to the purple shirts.\u201D",
  "\u201CFootball is simple. Our lobby connection is not.\u201D",
  "\u201CWe respect every opponent. We fear no algorithm.\u201D",
  "\u201CAsk the data. The data says we believe.\u201D"
];
