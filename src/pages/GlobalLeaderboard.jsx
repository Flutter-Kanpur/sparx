import React, { useState, useEffect, useMemo } from "react";
import { Loader2, ChevronLeft, ChevronRight, Info, TrendingUp, TrendingDown } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { fetchGlobalLeaderboard } from "../lib/db.js";
import { Flag, countryName } from "../lib/country.jsx";

const PAGE_SIZE = 15;
const PROVISIONAL_BELOW = 3; // contests played before a rating is considered settled

// Duplicated locally (like Profile.jsx) — App.jsx imports this page, so
// importing Avatar back from App.jsx would be circular.
function Avatar({ name, size = 36 }) {
  const initials = (name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: "var(--accent-soft)", color: "var(--accent)" }}
    >
      {initials}
    </div>
  );
}

const TOP_COLORS = { 1: "#b45309", 2: "#64748b", 3: "#c2410c" };

function Stat({ label, value }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// Standard competition ranking (ties share a rank, the next rank skips).
function rankBy(list, valueOf) {
  const sorted = [...list].sort((a, b) => valueOf(b) - valueOf(a) || b.solvedCount - a.solvedCount);
  const out = [];
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    const rank = prev && valueOf(prev) === valueOf(row) && prev.solvedCount === row.solvedCount ? out[i - 1].rank : i + 1;
    out.push({ ...row, rank });
  });
  return out;
}

function Delta({ value }) {
  if (value == null || value === 0) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: up ? "#047857" : "#b91c1c" }}>
      <Icon size={12} /> {up ? "+" : ""}{value}
    </span>
  );
}

const TABS = [
  { id: "overall", label: "Overall", sub: "Practice score + contest rating" },
  { id: "practice", label: "Practice", sub: "Problems solved" },
  { id: "contests", label: "Contests", sub: "Contest rating" },
];

export default function GlobalLeaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(0);
  const [country, setCountry] = useState("");
  const [tab, setTab] = useState("overall");

  useEffect(() => {
    fetchGlobalLeaderboard().then(setRows).catch(() => setRows([]));
  }, []);

  const countries = useMemo(() => {
    const set = new Set((rows || []).map((r) => r.countryCode).filter(Boolean));
    return [...set].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  }, [rows]);

  const ranked = useMemo(() => {
    const all = rows || [];
    if (tab === "practice") return rankBy(all.filter((r) => r.solvedCount > 0), (r) => r.practiceScore);
    if (tab === "contests") return rankBy(all.filter((r) => r.contestsPlayed > 0), (r) => r.contestRating);
    return all;
  }, [rows, tab]);

  const filtered = useMemo(() => ranked.filter((r) => !country || r.countryCode === country), [ranked, country]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const valueOf = (r) => (tab === "practice" ? r.practiceScore : tab === "contests" ? r.contestRating : r.score);
  const topValue = Math.max(1, ...filtered.map(valueOf));
  const barMin = tab === "contests" ? Math.min(...filtered.map(valueOf), 1000) - 20 : 0;

  const myRow = ranked.find((r) => r.userId === user?.id);
  const totalSolved = (rows || []).reduce((sum, r) => sum + r.solvedCount, 0);
  const ratedContests = (rows || []).some((r) => r.contestsPlayed > 0);

  function switchTab(id) {
    setTab(id);
    setPage(0);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Leaderboard</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            The Sparx Rating: how much you've practised, plus how you perform in contests.
          </p>
        </div>
        {countries.length > 0 && (
          <select
            value={country}
            onChange={(e) => { setCountry(e.target.value); setPage(0); }}
            className="input-field !w-auto text-sm"
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{countryName(c)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-1.5 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            title={t.sub}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: tab === t.id ? "var(--accent)" : "white",
              color: tab === t.id ? "white" : "var(--text-secondary)",
              border: "1px solid " + (tab === t.id ? "var(--accent)" : "var(--border)"),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          No one has solved a problem yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Stat label="Participants" value={ranked.length} />
            <Stat label="Problems solved" value={totalSolved} />
            <Stat label="Your rank" value={myRow ? `#${myRow.rank}` : "—"} />
          </div>

          <details className="card px-5 py-3 mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
            <summary className="cursor-pointer font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Info size={15} style={{ color: "var(--accent)" }} /> How the rating works
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <div className="font-semibold" style={{ color: "var(--text-primary)" }}>Practice score</div>
                <ul className="mt-1 space-y-1 list-disc pl-5">
                  <li><b>Difficulty:</b> 5 (starter), 10 (easy), 25 (medium) or 50 (hard) points per solved problem.</li>
                  <li><b>Attempts:</b> first-try Accepted +10%; each wrong Submit before your first Accepted −10%, down to −50%. Runs and compile errors never count.</li>
                  <li><b>Diminishing returns:</b> the more problems of one difficulty you've solved, the less each new one adds, so farming easy problems stops paying off.</li>
                  <li><b>Recency:</b> solves older than about 6 months fade to half value over the following year.</li>
                  <li><b>Topics:</b> +5 for every distinct topic you've solved (up to 15).</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold" style={{ color: "var(--text-primary)" }}>Contest rating (Elo)</div>
                <p className="mt-1">
                  Everyone starts at 1000. After each contest you're compared with every other participant on your final contest rank: beating someone
                  rated above you earns more than beating someone below you, and losing to a lower-rated player costs more. Ratings are provisional
                  (marked ~) for your first {PROVISIONAL_BELOW} contests, when they move faster.
                </p>
              </div>
              <p><b>Overall</b> = practice score + (contest rating − 1000, when positive). Ties are broken by problems solved.</p>
            </div>
          </details>

          {tab === "contests" && !ratedContests ? (
            <div className="card p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              No contest has been rated yet. Ratings appear after an admin runs <b>Update ratings</b> for a finished contest.
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Nobody here yet.</div>
          ) : (
            <div className="card overflow-hidden">
              <div
                className="flex items-center gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider border-b"
                style={{ color: "var(--text-muted)", borderColor: "var(--border)", background: "#fafafa" }}
              >
                <div className="w-10 text-center">Rank</div>
                <div className="flex-1">Participant</div>
                <div className="hidden md:block w-28">Country</div>
                <div className={`hidden w-24 ${tab === "overall" ? "xl:block" : "sm:block"}`} />
                {tab === "overall" && <><div className="hidden sm:block w-14 text-right">Solved</div><div className="hidden md:block w-20 text-right">Practice</div><div className="hidden md:block w-24 text-right">Contest</div></>}
                {tab === "practice" && <div className="hidden sm:block w-14 text-right">Solved</div>}
                {tab === "contests" && <><div className="hidden sm:block w-16 text-right">Played</div><div className="hidden sm:block w-16 text-right">Last</div></>}
                <div className="w-16 text-right">{tab === "contests" ? "Rating" : "Score"}</div>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {pageRows.map((r) => {
                  const isMe = r.userId === user?.id;
                  const v = valueOf(r);
                  const provisional = r.contestsPlayed > 0 && r.contestsPlayed < PROVISIONAL_BELOW;
                  return (
                    <div
                      key={r.userId}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50 transition-colors"
                      style={{ background: isMe ? "var(--accent-soft)" : undefined, boxShadow: isMe ? "inset 3px 0 0 var(--accent)" : undefined }}
                    >
                      <div className="w-10 flex justify-center flex-shrink-0">
                        <span className="font-mono font-bold text-sm" style={{ color: TOP_COLORS[r.rank] || "var(--text-muted)" }}>{r.rank}</span>
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-3">
                        <Avatar name={r.name || r.username} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                            {r.name || r.username || "someone"}
                            {isMe && <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--accent)" }}>you</span>}
                          </div>
                          {r.username && <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>@{r.username}</div>}
                        </div>
                      </div>
                      <div className="hidden md:flex items-center gap-2 w-28 text-sm truncate" style={{ color: "var(--text-secondary)" }}>
                        {r.countryCode ? (
                          <>
                            <Flag code={r.countryCode} />
                            <span className="truncate">{countryName(r.countryCode)}</span>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </div>
                      <div className={`hidden w-24 flex-shrink-0 ${tab === "overall" ? "xl:block" : "sm:block"}`}>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.max(4, ((v - barMin) / Math.max(1, topValue - barMin)) * 100)}%`, background: "var(--accent)" }}
                          />
                        </div>
                      </div>
                      {tab === "overall" && (
                        <>
                          <div className="hidden sm:block w-14 text-right text-sm" style={{ color: "var(--text-secondary)" }}>{r.solvedCount}</div>
                          <div className="hidden md:block w-20 text-right text-sm" style={{ color: "var(--text-secondary)" }}>{r.practiceScore}</div>
                          <div className="hidden md:block w-24 text-right text-sm" style={{ color: "var(--text-secondary)" }} title={r.contestRating != null ? `${r.contestsPlayed} contest${r.contestsPlayed === 1 ? "" : "s"}` : "no rated contest yet"}>
                            {r.contestRating != null ? `${provisional ? "~" : ""}${r.contestRating}` : "—"}
                          </div>
                        </>
                      )}
                      {tab === "practice" && <div className="hidden sm:block w-14 text-right text-sm" style={{ color: "var(--text-secondary)" }}>{r.solvedCount}</div>}
                      {tab === "contests" && (
                        <>
                          <div className="hidden sm:block w-16 text-right text-sm" style={{ color: "var(--text-secondary)" }}>{r.contestsPlayed}</div>
                          <div className="hidden sm:block w-16 text-right text-sm"><Delta value={r.contestLastDelta} /></div>
                        </>
                      )}
                      <div className="w-16 text-right text-base font-bold" style={{ color: "var(--text-primary)" }}>
                        {tab === "contests" && provisional ? <span title="Provisional rating">~{v}</span> : v}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-4">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-ghost !px-2 !py-1.5 disabled:opacity-40">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className="w-8 h-8 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: i === page ? "var(--accent)" : "transparent", color: i === page ? "white" : "var(--text-secondary)" }}
                >
                  {i + 1}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="btn-ghost !px-2 !py-1.5 disabled:opacity-40">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
