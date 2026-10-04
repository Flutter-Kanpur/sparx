import { TEMPLATES, DEFAULT_TEMPLATE, CARD_W, CARD_H } from "./shareTemplates.js";

export { CARD_W, CARD_H };

// 604 -> "10m 4s", 5542 -> "1h 32m 22s"
function compact(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  return [h && `${h}h`, (m || h) && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

const FONT = `"Poppins", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const font = (weight, size) => `${weight} ${size}px ${FONT}`;
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const images = {};
function loadTemplate(id) {
  images[id] ||= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = TEMPLATES[id].file;
  });
  return images[id];
}

function fitText(ctx, text, maxW, startSize, weight, minSize = 18) {
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
 * Draws the result card on one of the designed templates.
 * data: { title, name, handle, countryCode, rank, participants, score, solved, total,
 *         finishSeconds, cells: [{ solved, seconds }], message }
 */
export async function drawResultCard(canvas, data, templateId = DEFAULT_TEMPLATE) {
  const tpl = TEMPLATES[templateId] || TEMPLATES[DEFAULT_TEMPLATE];
  const L = tpl.layout;
  const img = await loadTemplate(templateId in TEMPLATES ? templateId : DEFAULT_TEMPLATE);
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // contest name
  ctx.fillStyle = rgb(L.name.color);
  ctx.fillText(fitText(ctx, data.title, L.name.maxw, L.name.size, "800", 34), L.name.pos[0], L.name.pos[1]);

  // rank (the "#" is part of the artwork)
  const rankText = `${data.rank}`;
  ctx.font = font("900", L.rank.size);
  const rankSize = ctx.measureText(rankText).width > L.rank.maxw ? L.rank.size * (L.rank.maxw / ctx.measureText(rankText).width) : L.rank.size;
  ctx.font = font("900", rankSize);
  const g = ctx.createLinearGradient(0, L.rank.pos[1] - rankSize * 0.75, 0, L.rank.pos[1]);
  g.addColorStop(0, rgb(L.rank.top));
  g.addColorStop(1, rgb(L.rank.bot));
  ctx.fillStyle = g;
  ctx.fillText(rankText, L.rank.pos[0], L.rank.pos[1]);

  ctx.font = font("500", L.of.size);
  ctx.fillStyle = rgb(L.of.color);
  ctx.fillText(`of ${data.participants} participants`, L.of.pos[0], L.of.pos[1]);

  // solved-at rows (the Q labels and green ticks are part of the artwork)
  data.cells.slice(0, 3).forEach((c, i) => {
    const y = L.rows[i].y;
    if (!c.solved) {
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath(); ctx.arc(L.check.x, y, L.check.r * 1.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = L.check.r * 0.28; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(L.check.x - L.check.r * 0.45, y); ctx.lineTo(L.check.x + L.check.r * 0.45, y); ctx.stroke();
    }
    ctx.font = font("600", L.time.size);
    ctx.fillStyle = c.solved ? rgb(L.time.color) : "rgba(120,130,150,0.8)";
    ctx.textAlign = "right";
    ctx.fillText(c.solved ? compact(c.seconds) : "—", L.time.right, y + L.time.dy);
    ctx.textAlign = "left";
  });

  // stat tiles
  const values = [`${data.score}`, `${data.solved}/${data.total}`, data.finishSeconds != null ? compact(data.finishSeconds) : "—"];
  ctx.fillStyle = rgb(L.tiles.color);
  values.forEach((v, i) => {
    ctx.fillText(fitText(ctx, v, L.tiles.maxw, L.tiles.size, "800", 22), L.tiles.x[i], L.tiles.base);
  });

  // person
  ctx.fillStyle = "#ffffff";
  ctx.font = font("800", L.circle.size);
  ctx.textAlign = "center";
  ctx.fillText((data.countryCode || initials(data.name)).slice(0, 3), L.circle.c[0], L.circle.c[1] + L.circle.size * 0.36);
  ctx.textAlign = "left";
  ctx.fillStyle = rgb(L.pname.color);
  ctx.fillText(fitText(ctx, data.name, L.pname.maxw, L.pname.size, "800", 20), L.pname.pos[0], L.pname.pos[1]);
  ctx.fillStyle = rgb(L.phandle.color);
  ctx.fillText(fitText(ctx, data.handle, L.phandle.maxw, L.phandle.size, "500", 16), L.phandle.pos[0], L.phandle.pos[1]);

  // share message in the bar
  ctx.fillStyle = rgb(L.cap.color);
  ctx.fillText(fitText(ctx, data.message, L.cap.maxw, L.cap.size, "600", 18), L.cap.pos[0], L.cap.pos[1]);
}
