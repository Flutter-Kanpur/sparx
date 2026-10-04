// Draws the shareable result card on top of the designed template
// (public/share/card-template.webp — the artwork with its {placeholders}
// removed). All coordinates below are in that image's 1672x941 pixel space.

export const CARD_W = 1672;
export const CARD_H = 941;

// 604 -> "10m 4s", 5542 -> "1h 32m 22s"
function compact(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  return [h && `${h}h`, (m || h) && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

const FONT = `"Poppins", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const font = (weight, size) => `${weight} ${size}px ${FONT}`;

let templatePromise;
function loadTemplate() {
  templatePromise ||= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "/share/card-template.webp";
  });
  return templatePromise;
}

function fitText(ctx, text, maxW, startSize, weight, minSize = 24) {
  let size = startSize;
  ctx.font = font(weight, size);
  while (size > minSize && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = font(weight, size);
  }
  if (ctx.measureText(text).width > maxW) {
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }
  return text;
}

function initials(name) {
  return (name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * data: { title, name, handle, countryCode, rank, participants, score, solved, total,
 *         finishSeconds, cells: [{ solved, seconds }], message }
 */
export async function drawResultCard(canvas, data) {
  const template = await loadTemplate();
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // contest name
  ctx.fillStyle = "#0b1030";
  ctx.fillText(fitText(ctx, data.title, 640, 66, "800", 38), 96, 306);

  // rank (blue gradient, like the template)
  const rankText = `#${data.rank}`;
  const rankFont = rankText.length > 4 ? 116 : rankText.length > 3 ? 146 : 168;
  ctx.font = font("900", rankFont);
  const grad = ctx.createLinearGradient(0, 372, 0, 512);
  grad.addColorStop(0, "#3b82f6");
  grad.addColorStop(1, "#0b2a8f");
  ctx.fillStyle = grad;
  ctx.fillText(rankText, 92, 502);

  ctx.font = font("500", 31);
  ctx.fillStyle = "#475569";
  ctx.fillText(`of ${data.participants} participants`, 244, 536);

  // solved-at rows (up to 3, like the template)
  const rowY = [283, 356, 429];
  data.cells.slice(0, 3).forEach((c, i) => {
    const y = rowY[i];
    if (!c.solved) {
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath(); ctx.arc(830, y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(821, y); ctx.lineTo(839, y); ctx.stroke();
    }
    ctx.font = font("700", 27);
    ctx.fillStyle = "#0b1030";
    ctx.fillText(`Q${i + 1}`, 874, y + 10);
    ctx.font = font("600", 26);
    ctx.fillStyle = c.solved ? "#334155" : "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(c.solved ? compact(c.seconds) : "not solved", 1096, y + 10);
    ctx.textAlign = "left";
  });

  // stat tiles
  ctx.fillStyle = "#0b1030";
  ctx.fillText(fitText(ctx, `${data.score}`, 140, 46, "800", 28), 208, 664);
  ctx.fillStyle = "#0b1030";
  ctx.fillText(fitText(ctx, `${data.solved}/${data.total}`, 140, 46, "800", 28), 562, 664);
  ctx.fillStyle = "#0b1030";
  ctx.fillText(fitText(ctx, data.finishSeconds != null ? compact(data.finishSeconds) : "—", 215, 46, "800", 26), 890, 664);

  // person
  ctx.fillStyle = "#ffffff";
  ctx.font = font("800", 32);
  ctx.textAlign = "center";
  ctx.fillText((data.countryCode || initials(data.name)).slice(0, 3), 119, 764);
  ctx.textAlign = "left";
  ctx.fillStyle = "#0b1030";
  ctx.fillText(fitText(ctx, data.name, 340, 38, "800", 24), 190, 752);
  ctx.fillStyle = "#64748b";
  ctx.fillText(fitText(ctx, data.handle, 340, 25, "500", 18), 190, 786);

  // share message in the footer bar
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fitText(ctx, data.message, 1000, 31, "600", 20), 62, 879);
}
