import React, { useEffect, useRef, useState } from "react";
import { X, Download, Copy, Share2, Linkedin, Check } from "lucide-react";
import { drawResultCard } from "./shareCard.js";

export default function ShareResultModal({ data, caption, shareUrl, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (canvasRef.current) drawResultCard(canvasRef.current, data).then(() => setReady(true)).catch(() => {});
  }, [data]);

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
    a.download = "sparx-contest-result.png";
    a.click();
    URL.revokeObjectURL(url);
  }

  // LinkedIn's share dialog only accepts a link, not text or an image, so the
  // caption is copied and the image downloaded for the user to attach.
  async function shareLinkedIn() {
    await copyCaption();
    await download();
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
  }

  async function nativeShare() {
    const blob = await toBlob();
    const file = new File([blob], "sparx-contest-result.png", { type: "image/png" });
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
          LinkedIn can't be pre-filled by apps: "Share on LinkedIn" downloads the image, copies the caption, and opens LinkedIn — paste the caption and attach the image to your post.
        </p>
      </div>
    </div>
  );
}
