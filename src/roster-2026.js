// Canonical 2026 BLW roster and player-name aliases.
//
// Lives in its own dependency-free module so both the BLW Studio app
// (src/data.js re-exports it) and the Command Center server
// (api/_cc-players.js) read the same list. Edit players here.

export const CANONICAL_ROSTER_2026 = [
  // Arizona Saguaros
  { team: 'AZS', name: 'Andrew Ledet', num: '34' },
  { team: 'AZS', name: 'Paul Marshall', num: '02' },
  { team: 'AZS', name: 'Will Marshall', num: '22' },
  { team: 'AZS', name: 'Nick Martinez', num: '10' },
  { team: 'AZS', name: 'Brice Clark', num: '06' },
  { team: 'AZS', name: 'Cooper Ruckel', num: '01' },
  { team: 'AZS', name: 'Jackson Richardson', num: '19' },
  // Boston Harbor Hawks
  { team: 'BOS', name: 'Randy Dalbey' },
  { team: 'BOS', name: 'Jake Sullivan', num: '16' },
  { team: 'BOS', name: 'Ethan Winer', num: '24' },
  { team: 'BOS', name: 'Jonathan Dalbey', num: '52' },
  { team: 'BOS', name: 'Jim Balian' },
  { team: 'BOS', name: 'Tom Gannon', num: '12' },
  { team: 'BOS', name: 'Kyle VonSchleusingen', num: '23' },
  // Chicago Bats
  { team: 'CHI', name: 'Keaton Kimmel' },
  { team: 'CHI', name: 'Justin Hall', num: '99' },
  { team: 'CHI', name: 'Bryson Livingston', num: '74' },
  { team: 'CHI', name: "Ryan O'Rear", num: '03' },
  { team: 'CHI', name: 'Drew Baalman', num: '77' },
  { team: 'CHI', name: 'Jeff Lopes', num: '07' },
  { team: 'CHI', name: 'Grant Miller', num: '00' },
  // Dallas Pandas
  { team: 'DAL', name: 'Jaxson Blum' },
  // The Rose cousins on DAL share both team and (for Logan/Luke) the
  // first initial "L". Carrying explicit jersey numbers on the
  // canonical entry lets findPlayerMedia disambiguate their assets,
  // since the API never carries jersey numbers and stat rows alone
  // can't tell us which "L. Rose" is which. Same idea applies to the
  // Lee cousins on LV and any future same-FI-lastname collisions.
  { team: 'DAL', name: 'Carson Rose', num: '06' },
  { team: 'DAL', name: 'Logan Rose', num: '08' },
  { team: 'DAL', name: 'Luke Rose',  num: '05' },
  { team: 'DAL', name: 'Joey Jankowski' },
  { team: 'DAL', name: 'Caleb Jeter', num: '01' },
  { team: 'DAL', name: 'Ben Dulin', num: '09' },
  // Las Vegas Scorpions (id LV)
  { team: 'LV',  name: 'Dustin Staggs', num: '28' },
  { team: 'LV',  name: 'Jaxen Pearson' },
  { team: 'LV',  name: 'Konnor Jaso' },         // traded from LAN
  { team: 'LV',  name: 'Steven Hayden', num: '07' },
  { team: 'LV',  name: 'Sawyer Behen', num: '16' },
  { team: 'LV',  name: 'James Lee',  num: '05' },
  { team: 'LV',  name: 'Justin Lee', num: '18' },
  // Los Angeles Naturals
  { team: 'LAN', name: 'Jordan Robles', num: '01' },
  { team: 'LAN', name: 'Preston Kolm', num: '02' },         // traded from LV
  { team: 'LAN', name: 'Vin Lea' },
  { team: 'LAN', name: 'Myc Witty', num: '16' },            // CSV says "Mychal Witty Jr." — alias below
  { team: 'LAN', name: 'Joaquin Jimenez', num: '22' },
  { team: 'LAN', name: 'Bryan Owens', num: '10' },
  { team: 'LAN', name: 'Dallas Allen', num: '13' },
  // Miami Mirage
  { team: 'MIA', name: 'Tommy Hernandez', num: '27' },
  { team: 'MIA', name: 'Cam Smith', num: '03' },
  { team: 'MIA', name: 'Jeremy Adams', num: '05' },
  { team: 'MIA', name: 'Jackson Albers', num: '04' },
  { team: 'MIA', name: 'Johnny Gunn' },
  { team: 'MIA', name: 'Michael Stiles', num: '07' },
  { team: 'MIA', name: 'Sean Hornberger', num: '11' },
  // New York Green Apples
  { team: 'NYG', name: 'Will Smithey', num: '08' },
  { team: 'NYG', name: 'Gus Skibbe', num: '18' },
  { team: 'NYG', name: 'Brendan Dudas' },
  { team: 'NYG', name: 'Reid Werner', num: '03' },
  { team: 'NYG', name: 'Tyler Flakne', num: '23' },
  { team: 'NYG', name: 'Sam Skibbe', num: '11' },
  { team: 'NYG', name: 'James Kline', num: '05' },
  // Philadelphia Wiffle Club
  { team: 'PHI', name: 'Josh Wheeler', num: '33' },
  { team: 'PHI', name: 'Dominic Citrowske', num: '77' },
  { team: 'PHI', name: 'Chandler Melton', num: '23' },
  { team: 'PHI', name: 'Kaiden Rice', num: '24' },
  { team: 'PHI', name: 'Spencer Foss', num: '32' },
  { team: 'PHI', name: 'Brody Livingston', num: '22' },
  { team: 'PHI', name: 'Jimmy Cole', num: '06' },
  // Atlanta Ballers (rebranded from San Diego Orcas — v4.8.3; internal
  // v4.17.0: ids migrated SDO → ATL)
  { team: 'ATL', name: 'Brett Caladie', num: '28' },
  { team: 'ATL', name: 'Torin Roth', num: '87' },
  { team: 'ATL', name: 'Jack Roth', num: '27' },
  { team: 'ATL', name: 'Brandon Crone', num: '08' },
  { team: 'ATL', name: 'Trevor Bauer' },
  { team: 'ATL', name: 'Cael Foreman', num: '00' },
  { team: 'ATL', name: 'Connor Smith', num: '02' },
];

export const NAME_ALIASES_RAW = {
  // Mychal Witty Jr. is referred to as "Myc Witty" in the API + UI.
  // (Most Jr.-style variants are caught by _normName's suffix stripping
  // — Mychal vs Myc is a true short-name swap so we still need the alias.)
  'mychal witty':     'Myc Witty',
  // AZS's Nick Martinez also appears in some sources as Edward / Eddie / Ed.
  // Per the user, all his BLW media + stats live under "Nick" so that's
  // the canonical display name; the rest are reverse-aliases.
  'edward martinez':  'Nick Martinez',
  'eddie martinez':   'Nick Martinez',
  'ed martinez':      'Nick Martinez',
  // v4.17.0: the CSV/import form 'Eddie "Nick" Martinez' normalizes to
  // three words — _normName only strips single-letter middle initials,
  // so the nickname needs its own alias entry.
  'eddie nick martinez': 'Nick Martinez',
  // LAN's outfielder is "Vin Lea" in BLW — old roster CSV had Vincent.
  'vincent lea':      'Vin Lea',
  // MIA's "Johnny Gunn" appears as "John Paul Gunn" in some sources.
  'john paul gunn':   'Johnny Gunn',
  'john gunn':        'Johnny Gunn',
  // CHI's Drew Baalman: per the player's self-reported spelling. Older
  // imports / stat rows had "Balmaan" as a typo — alias preserves
  // matches against any media or generate-log entries tagged that way.
  'drew balmaan':     'Drew Baalman',
  // MIA's Michael Stiles: player goes by Michael, not Mike. Some legacy
  // stat rows + media files use "Mike Stiles" — alias keeps them
  // resolving to the same canonical record.
  'mike stiles':      'Michael Stiles',
};
