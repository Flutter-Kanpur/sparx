import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Trophy, Loader2, ArrowLeft, Bug, ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { useAuth } from "../../lib/auth.jsx";
import { fetchContestStandings, contestStatus, contestUrl } from "../../lib/contestsApi.js";
import { StatusPill } from "../admin/Contests.jsx";
import { useCountdown } from "../../hooks/useCountdown.js";
import { Flag } from "../../lib/country.jsx";
import ShareResultModal from "./ShareResultModal.jsx";

const PAGE_SIZE = 25;

function formatTime(seconds) {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Cell({ cell }) {
  if (!cell) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
      {cell.solved ? (
        <span style={{ color: "var(--text-primary)" }}>{formatTime(cell.solveSeconds)}</span>
      ) : (
        <span style={{ color: "var(--text-muted)" }}>—</span>
      )}
      {cell.wrongCount > 0 && (
        <span className="inline-flex items-center gap-0.5 font-sans text-xs font-semibold" style={{ color: "#dc2626" }} title={`${cell.wrongCount} wrong attempt${cell.wrongCount > 1 ? "s" : ""}`}>
          <Bug size={12} />{cell.wrongCount}
        </span>
      )}
    </span>
  );
}

export default function ContestLeaderboard({ contest, onBack }) {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(0);
  const [sharing, setSharing] = useState(false);
  const status = contestStatus(contest);
  const { formatted } = useCountdown(contest.endsAt);

  const refresh = useCallback(() => {
    fetchContestStandings(contest.id).then(setRows).catch(() => setRows([]));
  }, [contest.id]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const columns = useMemo(() => {
    const byPos = new Map();
    for (const r of rows || []) for (const c of r.cells) byPos.set(c.position, c);
    return [...byPos.values()].sort((a, b) => a.position - b.position);
  }, [rows]);

  const me = rows?.find((r) => r.userId === user.id);
  const shareUrl = contestUrl(contest.id);
  const shareData = me && {
    title: contest.title,
    name: me.name || me.username || "Participant",
    rank: me.rank,
    participants: rows.length,
    score: me.score,
    solved: me.cells.filter((c) => c.solved).length,
    total: me.cells.length,
    totalSeconds: me.finishSeconds,
    cells: me.cells.map((c) => ({ label: `Q${c.position + 1}`, solved: c.solved, seconds: c.solveSeconds })),
    url: shareUrl,
  };
  const caption = me
    ? `I ranked #${me.rank} of ${rows.length} in ${contest.title} on Sparx by Flutter Kanpur — solved ${shareData.solved}/${shareData.total} problems${me.finishSeconds != null ? ` with a finish time of ${formatTime(me.finishSeconds)}` : ""}. Join the next contest: ${shareUrl} #FlutterKanpur #CodingContest #Sparx`
    : "";
  const totalPages = rows ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
  const pageRows = rows ? rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : [];

  function renderRow(r, { pinned = false } = {}) {
    const isMe = r.userId === user.id;
    const cellFor = (pos) => r.cells.find((c) => c.position === pos);
    return (
      <tr
        key={pinned ? `pinned-${r.userId}` : r.userId}
        style={{
          borderBottom: "1px solid var(--border)",
          background: pinned ? "#dcfce7" : isMe ? "var(--accent-soft)" : "transparent",
        }}
      >
        <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
          {pinned ? `${r.rank} / ${rows.length}` : r.rank}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-2 font-medium" style={{ color: isMe ? "var(--text-primary)" : "var(--accent)" }}>
            {r.name || r.username || "someone"}
            <Flag code={r.countryCode} height={12} />
          </span>
        </td>
        <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>{r.score}</td>
        <td className="px-4 py-3 font-mono text-[13px]" style={{ color: "var(--text-primary)" }}>
          {r.finishSeconds != null ? formatTime(r.finishSeconds) : "—"}
        </td>
        {columns.map((col) => (
          <td key={col.position} className="px-4 py-3 whitespace-nowrap">
            <Cell cell={cellFor(col.position)} />
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <button onClick={onBack} className="btn-ghost mb-4"><ArrowLeft size={14} /> Back to contest</button>

      <div className="flex items-center gap-2 mb-1">
        <Trophy size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{contest.title}</h1>
        <StatusPill status={status} />
        {me && (
          <button className="btn-secondary !px-3 !py-1.5 text-xs ml-auto" onClick={() => setSharing(true)}>
            <Share2 size={13} /> Share my result
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        {status === "live" ? `Standings update live · locks in ${formatted}` : status === "ended" ? "Final standings" : "Not started yet"}
        {" · "}Finish time = last accepted solve + 5 min per wrong attempt.
      </p>

      {rows === null ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          No one has submitted here yet.
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#fafafa", borderBottom: "1px solid var(--border)" }}>
                  <Th>Rank</Th>
                  <Th>Name</Th>
                  <Th>Score</Th>
                  <Th>Finish Time</Th>
                  {columns.map((col) => (
                    <Th key={col.position} accent>Q{col.position + 1} ({col.points})</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {me && !pageRows.some((r) => r.userId === me.userId) && renderRow(me, { pinned: true })}
                {pageRows.map((r) => renderRow(r))}
              </tbody>
            </table>
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
      {sharing && shareData && <ShareResultModal data={shareData} caption={caption} shareUrl={shareUrl} onClose={() => setSharing(false)} />}
    </div>
  );
}

function Th({ children, accent }) {
  return (
    <th
      className="px-4 py-3 text-left text-[13px] font-bold whitespace-nowrap"
      style={{ color: accent ? "var(--accent)" : "var(--text-primary)" }}
    >
      {children}
    </th>
  );
}
