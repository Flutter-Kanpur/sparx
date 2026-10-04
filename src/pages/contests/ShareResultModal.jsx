import React, { useEffect, useRef, useState } from "react";
import { X, Download, Copy, Share2, Linkedin, Check } from "lucide-react";
import { drawResultCard } from "./shareCard.js";
import { TEMPLATES, DEFAULT_TEMPLATE } from "./shareTemplates.js";

function savedTemplate() {
  try {
    const t = localStorage.getItem("sparx:share-template");
    return t && TEMPLATES[t] ? t : DEFAULT_TEMPLATE;
  } catch { return DEFAULT_TEMPLATE; }
}

export default function ShareResultModal({ data, caption, shareUrl, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const [ready, setReady] = useState(false);
  const [template, setTemplate] = useState(savedTemplate);
  useEffect(() => {
    setReady(false);
    if (canvasRef.current) drawResultCard(canvasRef.current, data, template).then(() => setReady(true)).catch(() => {});
  }, [data, template]);

  function pickTemplate(id) {
    setTemplate(id);
    try { localStorage.setItem("sparx:share-template", id); } catch { /* preference not saved */ }
  }

  function toBlob() {
    return new Promise((resolve) => canvasRef.current.toBlob(resolve, "image/png"));
  }

  async function copyCaption() {
    try { await navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
  }

  async function download() {
    const blob = await toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sparx-contest-result-${template}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Opens LinkedIn's post composer with the caption already typed. LinkedIn has
  // no way to pre-attach an image, so it is downloaded (and the caption also
  // copied, in case the composer opens empty) for the user to add to the post.
  async function shareLinkedIn() {
    await copyCaption();
    await download();
    window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(caption)}`, "_blank", "noopener");
  }

  async function nativeShare() {
    const blob = await toBlob();
    const file = new File([blob], `sparx-contest-result-${template}.png`, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: caption });
      else await navigator.share({ text: caption, url: shareUrl });
    } catch { /* user cancelled */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.6)" }} onClick={onClose}>
      <div className="card max-w-3xl w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Share your result</div>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose}><X size={16} /></button>
        </div>
        <canvas ref={canvasRef} className="w-full rounded-xl" style={{ aspectRatio: "1672 / 941", border: "1px solid var(--border)", opacity: ready ? 1 : 0.4 }} />
        <div className="grid grid-cols-4 gap-2 mt-3">
          {Object.entries(TEMPLATES).map(([id, t]) => (
            <button
              key={id}
              onClick={() => pickTemplate(id)}
              className="rounded-lg overflow-hidden text-left transition-all"
              style={{ border: `2px solid ${template === id ? "var(--accent)" : "var(--border)"}`, boxShadow: template === id ? "0 0 0 2px var(--accent-soft)" : "none" }}
              title={t.label}
            >
              <img src={t.file} alt={t.label} loading="lazy" className="w-full block" style={{ aspectRatio: "1672 / 941", objectFit: "cover" }} />
              <div className="text-[11px] font-semibold px-2 py-1" style={{ color: template === id ? "var(--accent)" : "var(--text-secondary)" }}>{t.label}</div>
            </button>
          ))}
        </div>
        <div className="text-xs mt-3 mb-3 p-3 rounded-lg" style={{ background: "#fafafa", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          {caption}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={shareLinkedIn}><Linkedin size={14} /> Share on LinkedIn</button>
          <button className="btn-secondary" onClick={download}><Download size={14} /> Download image</button>
          <button className="btn-secondary" onClick={copyCaption}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy caption"}</button>
          {canNativeShare && <button className="btn-secondary" onClick={nativeShare}><Share2 size={14} /> Share…</button>}
        </div>
        <p className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
          "Share on LinkedIn" opens a LinkedIn post with your caption already written and downloads the image. In the post, click the image icon and attach the downloaded file. If the caption box opens empty, paste it — it's already copied.
        </p>
      </div>
    </div>
  );
}
