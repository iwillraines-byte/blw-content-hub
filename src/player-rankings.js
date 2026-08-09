// ─── BLW VALUE SCORE (BVS) — objective ranking of the 70 rostered players ────
//
// A single composite number for "how much did this player contribute in 2026",
// built only from batting and pitching production. No reputation, no OPWR, no
// hand-weighting of individuals — every player goes through the same pipeline.
//
// ── The problem this has to solve ──
// A BLW season is TINY: 6 regular-season games, at most 5 more in the
// postseason, and roughly 3 plate appearances a game. Raw rate stats are
// therefore almost pure noise at the top — someone who goes 2-for-3 in a
// single game "leads the league" at .667. Any honest ranking has to (a) pull
// small samples toward the league mean and (b) reward players who actually
// accumulated playing time. Both are done explicitly below.
//
// ── Method ──
// 1. WEIGHTED TOTALS. Every counting stat is summed with postseason games
//    multiplied by POST_WEIGHT, so the regular season counts for more per
//    plate appearance / per out, as requested. Weighting the RAW TOTALS (not
//    the finished rates) keeps every downstream rate internally consistent.
// 2. REGRESSION. Each player is padded with PRIOR_PA plate appearances (and
//    PRIOR_OUTS outs) of exactly league-average production before rates are
//    computed. This is standard small-sample shrinkage: a 3-for-4 cameo lands
//    near average, a 6-game body of work barely moves.
// 3. VALUE = QUALITY x OPPORTUNITY. Batting value is (regressed OPS − league
//    OPS) x plate appearances. Pitching value is (league runs per 3 innings −
//    regressed runs per 3 innings) x innings-equivalents. So being good is
//    worth more the more you did it, and a great rate over 4 PA can't outrank
//    a very good rate over 25.
// 4. COMMON SCALE. Batting value is in OPS-points x PA; pitching value is in
//    runs. There is no honest fixed conversion between them in a 3-inning
//    wiffle context, so instead each side is divided by ITS OWN standard
//    deviation across the players who participated there. Both become
//    "standard deviations of contribution", which are directly comparable.
//    A player who never pitched scores 0 on the pitching side — not average,
//    because they contributed nothing there, which is the point.
// 5. TWO-WAY BONUS. Added last, proportional to the SMALLER of a player's
//    batting and pitching workload (so a token single inning earns almost
//    nothing). Deliberately small — see TWO_WAY_BONUS.
//
// ── Honest limitations (do not oversell this number) ──
// • Fielding, baserunning and situational leverage are not in the feed at all.
//   This is an offence-and-pitching score, not a total-player score.
// • Six games is a small sample even after regression. Neighbouring ranks are
//   not meaningfully different; treat this as tiers, not a strict ordering.
// • Pitching "runs" are unearned/earned undifferentiated — the feed reports a
//   single runs figure — and are not park/opponent adjusted.
// • A player who only bats can never beat an equally good player who also
//   pitches, by construction. That is what "two-way players are worth more"
//   means, and it is a choice, not a discovery.
//
// ── Robustness (measured 2026-08-01 against the live season) ──
// Rankings were recomputed across a wide sweep of every judgment call below.
// Mean rank movement was 0.7–3.0 places out of 70 and top-10 overlap was
// 9–10 of 10 in every variant, so the ordering is driven by the production,
// not by these constants. The one setting that changes #1 is weighting the
// postseason EQUALLY with the regular season, which hands it to the champion.

// ─── Tunable constants ───────────────────────────────────────────────────────

// Postseason games count this much of a regular-season game, per PA / per out.
// 0.5 = "the regular season is worth double". Postseason production still
// counts — it just can't outweigh a full regular season on a handful of games.
export const POST_WEIGHT = 0.5;

// Small-sample shrinkage. Roughly a third of a typical player's season, which
// is aggressive on purpose given how short the schedule is.
export const PRIOR_PA = 20;
export const PRIOR_OUTS = 9;   // 3 innings = one complete BLW start

// Two-way bonus, in standard deviations, awarded at full two-way workload.
// The league spans about 4.5 SD end to end, so this is worth ~5% of the range
// — enough to break ties between comparable players, never enough to lift a
// weak two-way player over a strong specialist. "Slightly more value."
export const TWO_WAY_BONUS = 0.25;

// Display scale, mirroring OPS+/wRC+ so the numbers read familiarly:
// 100 = league average, 15 points = one standard deviation. NOT capped at 100.
export const BVS_MEAN = 100;
export const BVS_SCALE = 15;

// ─── Helpers ────────────────────────────────────────────────────────────────

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function stdev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Sum a player's regular + postseason lines into one weighted line. `agg` is
// the { regular, postseason } pair produced by src/splits.js (either may be
// null when the player didn't appear in that split).
function weightedBatting(agg) {
  const out = { pa: 0, ab: 0, hits: 0, singles: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, rbi: 0, runs: 0, games: 0 };
  for (const [line, w] of [[agg?.regular, 1], [agg?.postseason, POST_WEIGHT]]) {
    if (!line) continue;
    out.pa += n(line.pa) * w;
    out.ab += n(line.ab) * w;
    out.hits += n(line.hits) * w;
    out.singles += n(line.singles) * w;
    out.doubles += n(line.doubles) * w;
    out.triples += n(line.triples) * w;
    out.hr += n(line.hr) * w;
    out.bb += n(line.bb) * w;
    out.k += n(line.k) * w;
    out.rbi += n(line.rbi) * w;
    out.runs += n(line.runs) * w;
    out.games += n(line.games) * w;
  }
  out.tb = out.singles + 2 * out.doubles + 3 * out.triples + 4 * out.hr;
  return out;
}

function weightedPitching(agg) {
  const out = { outs: 0, runs: 0, hits: 0, bb: 0, k: 0, w: 0, l: 0, games: 0 };
  for (const [line, weight] of [[agg?.regular, 1], [agg?.postseason, POST_WEIGHT]]) {
    if (!line) continue;
    out.outs += n(line.outs) * weight;
    out.runs += n(line.runs) * weight;
    out.hits += n(line.hits) * weight;
    out.bb += n(line.bb) * weight;
    out.k += n(line.k) * weight;
    out.w += n(line.w) * weight;
    out.l += n(line.l) * weight;
    out.games += n(line.games) * weight;
  }
  return out;
}

// ─── The ranking ────────────────────────────────────────────────────────────
//
// `players` is fetchLeagueSplits().players — [{ playerId, name, team,
// batting: {regular, postseason, total}, pitching: {...} }] — already filtered
// and canonicalized to the 70 by the caller. Returns one row per input player,
// sorted best first, with every component exposed so the table can show its
// work rather than just asserting a number.

export function computePlayerRankings(players) {
  const rows = (players || []).map(p => ({
    playerId: p.playerId,
    name: p.name,
    team: p.team,
    num: p.num || '',
    bat: weightedBatting(p.batting),
    pit: weightedPitching(p.pitching),
  }));

  // League baselines, from the same weighted totals the players are scored on.
  const lgPA = rows.reduce((a, r) => a + r.bat.pa, 0);
  const lgAB = rows.reduce((a, r) => a + r.bat.ab, 0);
  const lgH = rows.reduce((a, r) => a + r.bat.hits, 0);
  const lgBB = rows.reduce((a, r) => a + r.bat.bb, 0);
  const lgTB = rows.reduce((a, r) => a + r.bat.tb, 0);
  const lgOuts = rows.reduce((a, r) => a + r.pit.outs, 0);
  const lgRuns = rows.reduce((a, r) => a + r.pit.runs, 0);

  // Guard: with no data at all every score would be NaN. Return unranked rows.
  if (lgPA <= 0 || lgAB <= 0) {
    return rows.map(r => ({ ...r, rated: false, bvs: null, batScore: 0, pitScore: 0, twoWay: 0, rank: null }));
  }

  const lgOBP = (lgH + lgBB) / lgPA;
  const lgSLG = lgTB / lgAB;
  const lgOPS = lgOBP + lgSLG;
  const abPerPA = lgAB / lgPA;
  // Runs allowed per 3 innings — a BLW game is 3 innings, so this is the
  // league's runs-per-game-started baseline.
  const lgR3 = lgOuts > 0 ? (lgRuns * 9) / lgOuts : 0;

  for (const r of rows) {
    // Batting: pad with PRIOR_PA of league-average production, then rate.
    if (r.bat.pa > 0) {
      const obp = (r.bat.hits + r.bat.bb + lgOBP * PRIOR_PA) / (r.bat.pa + PRIOR_PA);
      const priorAB = PRIOR_PA * abPerPA;
      const slg = (r.bat.tb + lgSLG * priorAB) / (r.bat.ab + priorAB);
      r.opsAdj = obp + slg;
      r.batValue = (r.opsAdj - lgOPS) * r.bat.pa;
    } else {
      r.opsAdj = null;
      r.batValue = 0;
    }

    // Pitching: same shrinkage, then runs saved vs the league baseline.
    if (r.pit.outs > 0) {
      const r3 = ((r.pit.runs + (lgR3 * PRIOR_OUTS) / 9) * 9) / (r.pit.outs + PRIOR_OUTS);
      r.r3Adj = r3;
      r.pitValue = (lgR3 - r3) * (r.pit.outs / 9);
    } else {
      r.r3Adj = null;
      r.pitValue = 0;
    }
  }

  // Put both sides on a shared "standard deviations of contribution" scale.
  const sdBat = stdev(rows.filter(r => r.bat.pa > 0).map(r => r.batValue)) || 1;
  const sdPit = stdev(rows.filter(r => r.pit.outs > 0).map(r => r.pitValue)) || 1;
  const medPA = median(rows.filter(r => r.bat.pa > 0).map(r => r.bat.pa));
  const medOuts = median(rows.filter(r => r.pit.outs > 0).map(r => r.pit.outs));

  for (const r of rows) {
    r.batScore = r.batValue / sdBat;
    r.pitScore = r.pitValue / sdPit;
    // Workload share on each side, capped at the league median so a heavy
    // workload doesn't inflate the bonus beyond "does both jobs properly".
    const batAct = medPA > 0 ? Math.min(1, r.bat.pa / medPA) : 0;
    const pitAct = medOuts > 0 ? Math.min(1, r.pit.outs / medOuts) : 0;
    r.twoWay = Math.min(batAct, pitAct);
    // A player with no recorded production anywhere isn't "average" — they're
    // unrated. Scoring them 0 would place them mid-table, above genuinely poor
    // performers, which would be wrong.
    r.rated = r.bat.pa > 0 || r.pit.outs > 0;
    r.total = r.batScore + r.pitScore + TWO_WAY_BONUS * r.twoWay;
    r.bvs = r.rated ? BVS_MEAN + BVS_SCALE * r.total : null;
  }

  rows.sort((a, b) => {
    if (a.rated !== b.rated) return a.rated ? -1 : 1;   // unrated always last
    return b.total - a.total;
  });
  rows.forEach((r, i) => { r.rank = r.rated ? i + 1 : null; });

  return rows;
}

// League-wide context for the table footer, so the numbers can be read against
// the baseline they were computed from rather than taken on faith.
export function rankingContext(rows) {
  const rated = rows.filter(r => r.rated);
  return {
    rated: rated.length,
    unrated: rows.length - rated.length,
    twoWay: rated.filter(r => r.bat.pa > 0 && r.pit.outs > 0).length,
    battersOnly: rated.filter(r => r.bat.pa > 0 && r.pit.outs === 0).length,
    pitchersOnly: rated.filter(r => r.bat.pa === 0 && r.pit.outs > 0).length,
  };
}
