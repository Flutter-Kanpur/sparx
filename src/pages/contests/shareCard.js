// 604 -> "10m 4s", 5542 -> "1h 32m 22s" (compact, so it fits the card's tiles)
function compact(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  return [h && `${h}h`, (m || h) && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

export const CARD_W = 1200;
export const CARD_H = 627; // LinkedIn's recommended 1.91:1 link-image size

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function initials(name) {
  return (name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

/**
 * Draws the shareable result card.
 * data: { title, name, rank, participants, score, maxScore, solved, total, totalSeconds, cells: [{label, solved, seconds}], url }
 */
export function drawResultCard(canvas, data) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const font = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  // background
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, "#0b1f4d");
  bg.addColorStop(0.55, "#0553B1");
  bg.addColorStop(1, "#13B9FD");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath(); ctx.arc(1080, 90, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath(); ctx.arc(1150, 560, 200, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(251,191,36,0.10)";
  ctx.beginPath(); ctx.arc(60, 640, 220, 0, Math.PI * 2); ctx.fill();

  // brand
  ctx.fillStyle = "#ffffff";
  ctx.font = font("800", 40);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Sparx", 64, 92);
  const sparxW = ctx.measureText("Sparx").width;
  ctx.font = "italic 400 26px Georgia, 'Times New Roman', serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("by Flutter Kanpur", 64 + sparxW + 14, 92);

  // contest title + label
  ctx.font = font("600", 22);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("CONTEST RESULT", 64, 160);
  ctx.font = font("800", 46);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(ctx, data.title, 760), 64, 214);

  // rank hero
  const medal = data.rank === 1 ? "#fbbf24" : data.rank === 2 ? "#e2e8f0" : data.rank === 3 ? "#fdba74" : "#ffffff";
  ctx.font = font("900", 150);
  ctx.fillStyle = medal;
  const rankText = `#${data.rank}`;
  ctx.fillText(rankText, 64, 372);
  const rankW = ctx.measureText(rankText).width;
  ctx.font = font("600", 34);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(`of ${data.participants} participants`, 64 + rankW + 24, 372);

  // stat tiles
  const tiles = [
    ["SCORE", `${data.score}`],
    ["SOLVED", `${data.solved}/${data.total}`],
    ["FINISH TIME", data.totalSeconds != null ? compact(data.totalSeconds) : "—"],
  ];
  let tx = 64;
  const tileW = 270, tileH = 104, ty = 410;
  for (const [label, value] of tiles) {
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, tx, ty, tileW, tileH, 18); ctx.fill();
    ctx.font = font("600", 17);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(label, tx + 22, ty + 36);
    ctx.font = font("800", value.length > 12 ? 30 : 38);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fit(ctx, value, tileW - 44), tx + 22, ty + 82);
    tx += tileW + 18;
  }

  // per-question chips (right column)
  const cx = 930, cw = 214;
  ctx.font = font("600", 17);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("SOLVED AT", cx - 40, 160);
  let cy = 184;
  for (const c of data.cells.slice(0, 5)) {
    ctx.fillStyle = c.solved ? "rgba(16,185,129,0.28)" : "rgba(255,255,255,0.10)";
    roundRect(ctx, cx - 40, cy, cw + 40, 58, 14); ctx.fill();
    ctx.font = font("700", 20);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.label, cx - 22, cy + 36);
    ctx.font = font("600", 19);
    ctx.textAlign = "right";
    ctx.fillStyle = c.solved ? "#ffffff" : "rgba(255,255,255,0.55)";
    ctx.fillText(c.solved ? fit(ctx, compact(c.seconds), 130) : "not solved", cx + cw - 16, cy + 36);
    ctx.textAlign = "left";
    cy += 70;
  }

  // footer: user
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(96, 566, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0553B1";
  ctx.font = font("800", 24);
  ctx.textAlign = "center";
  ctx.fillText(initials(data.name), 96, 575);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = font("700", 28);
  ctx.fillText(fit(ctx, data.name, 520), 144, 563);
  ctx.font = font("500", 20);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(data.url.replace(/^https?:\/\//, "").split("/")[0], 144, 592);
}
