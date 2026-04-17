// ─── TEAM DATA — Logo-accurate hex colors ──────────────────────────────────
export const TEAMS = [
  { id:"LAN", slug:"la-naturals", name:"Los Angeles Naturals", city:"Los Angeles", color:"#0972CE", accent:"#C1CFD4", dark:"#054A8A", record:"17-1", rank:1, owner:"Kevin Costner", pct:".944", diff:"+49" },
  { id:"AZS", slug:"az-saguaros", name:"Arizona Saguaros", city:"Arizona", color:"#163E35", accent:"#6AA338", dark:"#0D2820", record:"11-5", rank:2, owner:"", pct:".688", diff:"+44" },
  { id:"LVS", slug:"lv-scorpions", name:"Las Vegas Scorpions", city:"Las Vegas", color:"#1A1A1A", accent:"#A3ABB1", dark:"#0D0D0D", record:"7-4", rank:3, owner:"Marc Lasry", pct:".636", diff:"+11" },
  { id:"NYG", slug:"ny-greenapples", name:"New York Green Apples", city:"New York", color:"#538D41", accent:"#F5B8C5", dark:"#3A6A2D", record:"7-5", rank:4, owner:"Gary Vaynerchuk", pct:".583", diff:"-4" },
  { id:"DAL", slug:"dal-pandas", name:"Dallas Pandas", city:"Dallas", color:"#1A1A1A", accent:"#A37812", dark:"#0D0D0D", record:"6-6", rank:5, owner:"Dude Perfect", pct:".500", diff:"0" },
  { id:"BOS", slug:"bos-harborhawks", name:"Boston Harbor Hawks", city:"Boston", color:"#06205B", accent:"#F9F2D8", dark:"#041640", record:"5-6", rank:6, owner:"", pct:".455", diff:"-4" },
  { id:"PHI", slug:"phi-wiffleclub", name:"Philadelphia Wiffle Club", city:"Philadelphia", color:"#0D223F", accent:"#A8B8C8", dark:"#08162A", record:"4-5", rank:7, owner:"David Adelman", pct:".444", diff:"+16" },
  { id:"CHI", slug:"chi-bats", name:"Chicago Bats", city:"Chicago", color:"#EC1C2C", accent:"#FFFFFF", dark:"#B5151F", record:"4-6", rank:8, owner:"", pct:".400", diff:"-7" },
  { id:"MIA", slug:"mia-mirage", name:"Miami Mirage", city:"Miami", color:"#144734", accent:"#7EC6BB", dark:"#0D3024", record:"4-6", rank:9, owner:"", pct:".400", diff:"-1" },
  { id:"SDO", slug:"sd-orcas", name:"San Diego Orcas", city:"San Diego", color:"#0B3146", accent:"#4BCED8", dark:"#072230", record:"2-7", rank:10, owner:"", pct:".222", diff:"-6" },
];

export const getTeam = (id) => TEAMS.find(t => t.id === id || t.slug === id);

// ─── REAL DATA FROM PROWIFFLEBALL.COM (scraped April 15, 2026) ─────────────
export const BATTING_LEADERS = [
  { rank:1, name:"Torin Roth", num:"16", team:"SDO", ops_plus:247, avg:".417", obp:".521", slg:".812", hr:0 },
  { rank:2, name:"Tommy Hernandez", num:"18", team:"MIA", ops_plus:236, avg:".435", obp:".488", slg:".756", hr:0 },
  { rank:3, name:"Andrew Ledet", num:"2", team:"AZS", ops_plus:200, avg:".462", obp:".521", slg:".812", hr:7 },
  { rank:4, name:"Josh Wheeler", num:"40", team:"PHI", ops_plus:194, avg:".310", obp:".465", slg:".692", hr:0 },
  { rank:5, name:"Logan Rose", num:"26", team:"DAL", ops_plus:192, avg:".357", obp:".438", slg:".654", hr:0 },
  { rank:6, name:"Dustin Staggs", num:"28", team:"LVS", ops_plus:192, avg:".294", obp:".421", slg:".628", hr:0 },
  { rank:7, name:"Brice Clark", num:"22", team:"AZS", ops_plus:177, avg:".292", obp:".452", slg:".681", hr:0 },
  { rank:8, name:"Nick Martinez", num:"10", team:"AZS", ops_plus:174, avg:".292", obp:".412", slg:".602", hr:2 },
  { rank:9, name:"Konnor Jaso", num:"3", team:"LAN", ops_plus:171, avg:".194", obp:".398", slg:".585", hr:2 },
  { rank:10, name:"Brody Livingston", num:"19", team:"DAL", ops_plus:159, avg:".227", obp:".398", slg:".585", hr:1 },
];

export const PITCHING_LEADERS = [
  { rank:1, name:"Myc Witty", num:"1", team:"LAN", fip:-1.85, era:"0.00", ip:"25.0", k4:"11.68", w:4, l:0 },
  { rank:2, name:"Will Smithey", num:"5", team:"NYG", fip:-1.79, era:"0.00", ip:"19.0", k4:"10.74", w:3, l:1 },
  { rank:3, name:"Jordan Robles", num:"8", team:"LAN", fip:-1.41, era:"0.00", ip:"30.0", k4:"9.87", w:7, l:1 },
  { rank:4, name:"Jordan Bohnet", num:"6", team:"LAN", fip:-1.07, era:"0.00", ip:"14.0", k4:"9.43", w:2, l:1 },
  { rank:5, name:"Konnor Jaso", num:"3", team:"LAN", fip:-0.31, era:"0.00", ip:"31.0", k4:"9.81", w:5, l:1 },
  { rank:6, name:"Randy Dalbey", num:"13", team:"BOS", fip:-0.18, era:"0.00", ip:"36.0", k4:"9.44", w:5, l:4 },
  { rank:7, name:"Steve Trzpis", num:"4", team:"LAN", fip:-0.02, era:"0.00", ip:"36.0", k4:"9.22", w:8, l:0 },
  { rank:8, name:"Preston Kolm", num:"21", team:"LVS", fip:0.26, era:"0.00", ip:"17.0", k4:"10.82", w:3, l:0 },
];

export const TEMPLATES = [
  { id: "gameday", name: "Game Day Graphic", icon: "🏟️", desc: "Pre-game matchup hype", fields: ["opponent","date","time","venue"] },
  { id: "score", name: "Final Score", icon: "📊", desc: "Post-game score card", fields: ["opponent","teamScore","oppScore","mvp"] },
  { id: "player-stat", name: "Player Stat Card", icon: "⭐", desc: "Individual stat spotlight", fields: ["playerName","number","statLine"] },
  { id: "batting-leaders", name: "Batting Leaders", icon: "🏏", desc: "Top hitters by OPS+", fields: [] },
  { id: "pitching-leaders", name: "Pitching Leaders", icon: "💨", desc: "Top pitchers by FIP", fields: [] },
  { id: "standings", name: "Standings", icon: "📈", desc: "Current league standings", fields: [] },
];

export const PLATFORMS = {
  "feed": { w: 1080, h: 1080, label: "1080×1080 Feed" },
  "portrait": { w: 1080, h: 1350, label: "1080×1350 Portrait" },
  "story": { w: 1080, h: 1920, label: "1080×1920 Story" },
  "landscape": { w: 1200, h: 675, label: "1200×675 Landscape" },
};

// ─── API CONFIG ─────────────────────────────────────────────────────────────
// When you get your prowiffleball.com API key, set it in your Vercel env vars
// as VITE_PWB_API_KEY. The tool will automatically use live data instead of
// the snapshot above.
export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_PWB_API_URL || "https://prowiffleball.com/api",
  apiKey: import.meta.env.VITE_PWB_API_KEY || null,
  isLive: !!import.meta.env.VITE_PWB_API_KEY,
};

export async function fetchBattingLeaders() {
  if (!API_CONFIG.isLive) return BATTING_LEADERS;
  try {
    const res = await fetch(`${API_CONFIG.baseUrl}/stats/batting?sort=ops_plus&desc=true`, {
      headers: { "Authorization": `Bearer ${API_CONFIG.apiKey}` }
    });
    if (!res.ok) throw new Error("API request failed");
    return await res.json();
  } catch (e) {
    console.warn("Falling back to cached data:", e);
    return BATTING_LEADERS;
  }
}

export async function fetchPitchingLeaders() {
  if (!API_CONFIG.isLive) return PITCHING_LEADERS;
  try {
    const res = await fetch(`${API_CONFIG.baseUrl}/stats/pitching?sort=fip`, {
      headers: { "Authorization": `Bearer ${API_CONFIG.apiKey}` }
    });
    if (!res.ok) throw new Error("API request failed");
    return await res.json();
  } catch (e) {
    console.warn("Falling back to cached data:", e);
    return PITCHING_LEADERS;
  }
}
