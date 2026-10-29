"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CaptureCard({ source }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm("Delete this captured source permanently?")) return;
    setBusy(true); setError("");
    try {
      const result = await fetch("/api/captures/" + encodeURIComponent(source.id), {
        method: "DELETE", credentials: "same-origin", headers: { "Cache-Control": "no-store" },
      });
      if (!result.ok) throw new Error("Deletion failed");
      router.refresh();
    } catch { setError("Could not delete source. Try again."); }
    finally { setBusy(false); }
  }
  return <article className="source-card">
    <div className="source-meta">
      <span>{source.product} · {source.source}</span>
      <span className="pending">Unverified source</span>
    </div>
    <h3>{source.title || "Untitled capture"}</h3>
    <p className="excerpt">{source.text}</p>
    {source.sourceUrl && <p className="small">Source link recorded; TOPO has not fetched its contents.</p>}
    <div className="source-footer">
      <span>Captured {new Date(source.capturedAt).toLocaleString("en-GB", { dateStyle: "medium" })}</span>
      <button onClick={remove} disabled={busy} className="text-button danger">{busy ? "Deleting…" : "Delete source"}</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
  </article>;
}
