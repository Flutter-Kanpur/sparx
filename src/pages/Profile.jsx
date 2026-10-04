import React, { useState, useEffect, useRef } from "react";
import {
  MapPin, Calendar, Code2, Mail, Flame, Trophy, TrendingUp, Check, X,
  Clock, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import { fetchUserStats } from "../lib/db.js";
import { formatRelativeTime } from "../utils/time.js";
import pkg from "../../package.json";

function Avatar({ name, size = 32 }) {
  const initials = (name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
      }}
    >
      {initials}
    </div>
  );
}

export default function Profile({ user, userId, onOpenProblem, problems }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUserStats(userId)
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading your stats…</div>
      </div>
    );
  }

  const { stats, recentSubmissions, heatmap } = data;
  const lastSubmission = recentSubmissions[0] || null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-start gap-5">
          <Avatar name={user.name} size={80} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{user.name}</h1>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>@{user.username}</span>
            </div>
            {user.bio && (
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>{user.bio}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              {user.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} style={{ color: "var(--text-muted)" }} /> {user.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} style={{ color: "var(--text-muted)" }} /> Joined {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} style={{ color: "var(--text-muted)" }} /> {user.email}
              </span>
              {user.github && (
                <span className="inline-flex items-center gap-1.5">
                  <Code2 size={14} style={{ color: "var(--text-muted)" }} /> github.com/{user.github}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 px-5 py-3 rounded-lg flex-shrink-0"
               style={{ background: "var(--accent-soft)", border: "1px solid #9cd8fc" }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>Rank</div>
            <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
              {stats.rank ? `#${stats.rank.toLocaleString()}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Trophy size={18} />}
          color="#0553B1"
          label="Solved"
          value={stats.solved.total}
          sub={`of ${problems.length}`}
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          color="#059669"
          label="Acceptance"
          value={`${Math.round(stats.acceptanceRate * 100)}%`}
          sub={`${stats.totalSubmissions} subs`}
        />
        <StatCard
          icon={<Flame size={18} />}
          color="#ea580c"
          label="Current streak"
          value={`${stats.currentStreak}d`}
          sub={`max ${stats.maxStreak}d`}
        />
        <StatCard
          icon={<Clock size={18} />}
          color="#6366f1"
          label="Last submission"
          value={lastSubmission ? formatRelativeTime(lastSubmission.submittedAt) : "—"}
          sub={lastSubmission ? lastSubmission.problemTitle : "no submissions yet"}
        />
      </div>

      {/* Streak badges */}
      <StreakBadges maxStreak={stats.maxStreak} />

      {/* Difficulty breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 items-stretch">
        <div className="lg:col-span-1">
          <div className="card p-5 h-full">
            <div className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>By difficulty</div>
            <DifficultyBar label="Easy" solved={stats.solved.starter + stats.solved.easy} total={stats.solvedTotals.starter + stats.solvedTotals.easy} color="#10b981" />
            <DifficultyBar label="Medium" solved={stats.solved.medium} total={stats.solvedTotals.medium} color="#f59e0b" />
            <DifficultyBar label="Hard" solved={stats.solved.hard} total={stats.solvedTotals.hard} color="#ef4444" />
          </div>
        </div>

        {/* Heatmap */}
        <div className="lg:col-span-2">
          <div className="card p-5 h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Submission activity</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Last 12 months</div>
            </div>
            <Heatmap data={heatmap} />
            <div className="flex items-center justify-end gap-2 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <div
                  key={l}
                  className="w-3 h-3 rounded-sm"
                  style={{ background: heatColor(l) }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent submissions */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent submissions</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>{recentSubmissions.length} recent</div>
        </div>
        {recentSubmissions.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No submissions yet — solve a problem to see it here.
          </div>
        ) : (
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {recentSubmissions.map((s) => {
            const found = problems.find((p) => p.id === s.problemId);
            return (
              <button
                key={s.id}
                onClick={() => found && onOpenProblem(found)}
                className="w-full text-left px-5 py-3 flex items-center justify-between gap-3 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <VerdictBadge verdict={s.verdict} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize truncate" style={{ color: "var(--text-primary)" }}>
                      {s.problemTitle}
                    </div>
                    <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: "var(--text-muted)" }}>
                      <span className="font-mono">{s.language}</span>
                      <span>·</span>
                      <span>{s.runtime}ms · {(s.memory / 1024).toFixed(1)}MB</span>
                      <span>·</span>
                      <span>{formatRelativeTime(s.submittedAt)}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            );
          })}
        </div>
        )}
      </div>

      <div className="text-center text-xs mt-6" style={{ color: "var(--text-muted)" }}>
        Sparx v{pkg.version}
      </div>
    </div>
  );
}

function StatCard({ icon, color, label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: `${color}15`, color }}
        >
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
        {label} · <span>{sub}</span>
      </div>
    </div>
  );
}

const STREAK_MILESTONES = [
  { days: 7, label: "7 Day", color: "#f59e0b" },
  { days: 30, label: "30 Day", color: "#ea580c" },
  { days: 100, label: "100 Day", color: "#dc2626" },
  { days: 365, label: "365 Day", color: "#7c3aed" },
];

function StreakBadges({ maxStreak }) {
  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Streak badges</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Best streak: {maxStreak}d</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STREAK_MILESTONES.map((m) => {
          const unlocked = maxStreak >= m.days;
          return (
            <div
              key={m.days}
              className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all"
              style={{
                background: unlocked ? `${m.color}14` : "#fafafa",
                border: `1px solid ${unlocked ? `${m.color}40` : "var(--border)"}`,
                opacity: unlocked ? 1 : 0.55,
              }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: unlocked ? m.color : "#e4e4e7" }}
              >
                <Flame size={22} color="white" strokeWidth={2} />
              </div>
              <div
                className="text-xs font-semibold text-center"
                style={{ color: unlocked ? "var(--text-primary)" : "var(--text-muted)" }}
              >
                {m.label} Streak
              </div>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {unlocked ? "Unlocked" : `${m.days - maxStreak}d to go`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DifficultyBar({ label, solved, total, color }) {
  const pct = total > 0 ? Math.min(100, (solved / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>
          <span className="font-semibold" style={{ color }}>{solved}</span>
          <span> / {total}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#f4f4f5" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// GitHub-style calendar: one column per week (Sunday on top), month labels above,
// scrolled so the current week is the one in view.
function Heatmap({ data }) {
  const scrollRef = useRef(null);
  const first = data.length ? new Date(`${data[0].date}T00:00:00Z`).getUTCDay() : 0;
  const cells = [...Array(first).fill(null), ...data];
  while (cells.length % 7 !== 0) cells.push(null);
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));

  const labels = [];
  let lastMonth = -1;
  cols.forEach((col, ci) => {
    const real = col.find(Boolean);
    if (!real) return;
    const m = new Date(`${real.date}T00:00:00Z`).getUTCMonth();
    if (m !== lastMonth && (lastMonth !== -1 || ci < 3)) labels.push({ ci, text: MONTHS[m] });
    lastMonth = m;
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [data]);

  return (
    <div ref={scrollRef} className="overflow-x-auto pb-1">
      <div style={{ minWidth: cols.length * 14 }}>
        <div className="grid mb-1 text-[10px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`, color: "var(--text-muted)", height: 14 }}>
          {labels.map((l) => (
            <span key={l.ci} className="whitespace-nowrap" style={{ gridColumn: l.ci + 1 }}>{l.text}</span>
          ))}
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((col, ci) => (
            <div key={ci} className="grid gap-[3px]">
              {col.map((cell, ri) =>
                cell ? (
                  <div
                    key={ri}
                    className="rounded-sm cursor-pointer transition-transform hover:scale-125"
                    style={{ background: heatColor(cell.level), aspectRatio: "1 / 1" }}
                    title={`${cell.count || 0} submission${cell.count === 1 ? "" : "s"} on ${cell.date}`}
                  />
                ) : (
                  <div key={ri} style={{ aspectRatio: "1 / 1" }} />
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function heatColor(level) {
  return ["#f4f4f5", "#bfe4fe", "#7ecbfb", "#33a8f5", "#0553B1"][level] || "#f4f4f5";
}

function VerdictBadge({ verdict }) {
  const config = {
    AC: { bg: "#d1fae5", text: "#047857", icon: <Check size={11} strokeWidth={3} />, label: "Accepted" },
    WA: { bg: "#fee2e2", text: "#b91c1c", icon: <X size={11} strokeWidth={3} />, label: "Wrong" },
    TLE: { bg: "#fef3c7", text: "#b45309", icon: <Clock size={11} strokeWidth={2.5} />, label: "TLE" },
    RE: { bg: "#fee2e2", text: "#b91c1c", icon: <AlertCircle size={11} strokeWidth={2.5} />, label: "RE" },
    CE: { bg: "#fee2e2", text: "#b91c1c", icon: <AlertCircle size={11} strokeWidth={2.5} />, label: "CE" },
  };
  const c = config[verdict] || config.WA;
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold flex-shrink-0"
      style={{ background: c.bg, color: c.text }}
    >
      {c.icon}
      {c.label}
    </div>
  );
}

