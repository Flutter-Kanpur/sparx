import React, { useState, useEffect, useMemo } from "react";
import { Loader2, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { fetchGlobalLeaderboard } from "../lib/db.js";
import { Flag, countryName } from "../lib/country.jsx";

const PAGE_SIZE = 15;

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

export default function GlobalLeaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(0);
  const [country, setCountry] = useState("");

  useEffect(() => {
    fetchGlobalLeaderboard().then(setRows).catch(() => setRows([]));
  }, []);

  const countries = useMemo(() => {
    const set = new Set((rows || []).map((r) => r.countryCode).filter(Boolean));
    return [...set].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  }, [rows]);

  const filtered = useMemo(() => (rows || []).filter((r) => !country || r.countryCode === country), [rows, country]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const topScore = Math.max(1, ...filtered.map((r) => r.score));

  const myRow = rows?.find((r) => r.userId === user?.id);
  const totalSolved = (rows || []).reduce((sum, r) => sum + r.solvedCount, 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Leaderboard</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            Ranked by score: problem difficulty, attempts taken, and topics covered.
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

      {rows === null ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          No one has solved a problem yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Stat label="Participants" value={rows.length} />
            <Stat label="Problems solved" value={totalSolved} />
            <Stat label="Your rank" value={myRow ? `#${myRow.rank}` : "—"} />
          </div>

          <details className="card px-5 py-3 mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
            <summary className="cursor-pointer font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Info size={15} style={{ color: "var(--accent)" }} /> How scoring works
            </summary>
            <ul className="mt-3 space-y-1.5 list-disc pl-5">
              <li><b>Difficulty:</b> each solved problem earns 5 (starter), 10 (easy), 25 (medium) or 50 (hard) points.</li>
              <li><b>Attempts:</b> a first-try Accepted earns +10%. Each wrong Submit (wrong answer, time limit, runtime error) before your first Accepted costs 10%, down to a floor of 50%. Runs and compile errors never count.</li>
              <li><b>Topics:</b> +5 points for every distinct topic you've solved a problem in (arrays, strings, graphs, DP…), up to 15 topics.</li>
              <li>Ties are broken by problems solved.</li>
            </ul>
          </details>

          <div className="card overflow-hidden">
            <div
              className="flex items-center gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider border-b"
              style={{ color: "var(--text-muted)", borderColor: "var(--border)", background: "#fafafa" }}
            >
              <div className="w-10 text-center">Rank</div>
              <div className="flex-1">Participant</div>
              <div className="hidden md:block w-40">Country</div>
              <div className="hidden sm:block w-28" />
              <div className="hidden sm:block w-14 text-right">Solved</div>
              <div className="w-16 text-right">Score</div>
            </div>

            {pageRows.length === 0 ? (
              <div className="p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                No one from this country has solved a problem yet.
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {pageRows.map((r) => {
                  const isMe = r.userId === user?.id;
                  return (
                    <div
                      key={r.userId}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50 transition-colors"
                      style={{
                        background: isMe ? "var(--accent-soft)" : undefined,
                        boxShadow: isMe ? "inset 3px 0 0 var(--accent)" : undefined,
                      }}
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
                      <div className="hidden md:flex items-center gap-2 w-40 text-sm truncate" style={{ color: "var(--text-secondary)" }}>
                        {r.countryCode ? (
                          <>
                            <Flag code={r.countryCode} />
                            <span className="truncate">{countryName(r.countryCode)}</span>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </div>
                      <div className="hidden sm:block w-28 flex-shrink-0">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.max(4, (r.score / topScore) * 100)}%`, background: "var(--accent)" }}
                          />
                        </div>
                      </div>
                      <div className="hidden sm:block w-14 text-right text-sm" style={{ color: "var(--text-secondary)" }} title={`${r.firstTryCount} first-try · ${r.topicCount} topics`}>
                        {r.solvedCount}
                      </div>
                      <div className="w-16 text-right text-base font-bold" style={{ color: "var(--text-primary)" }}>
                        {r.score}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                  style={{
                    background: i === page ? "var(--accent)" : "transparent",
                    color: i === page ? "white" : "var(--text-secondary)",
                  }}
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
