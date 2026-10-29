"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getDraft, saveDraft, clearDraft } from "../../lib/share-draft.mjs";

export default function Capture() {
  const [source, setSource] = useState("manual");
  const [product, setProduct] = useState("chatgpt");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDraft().then((draft) => {
      if (!draft) return;
      setTitle(draft.title || "");
      setText(draft.text || "");
      setSourceUrl(draft.sourceUrl || "");
      setSource(draft.source || "mobile-share");
      setProduct(draft.product || "chatgpt");
      setIdempotencyKey(draft.idempotencyKey || crypto.randomUUID());
      if (!draft.text && draft.sourceUrl) setStatus("Only a link was shared; paste the relevant conversation text before submitting.");
    }).catch(() => setStatus("Unable to load local share. Paste the content manually."));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!text.trim()) { setStatus("Please paste the relevant text. A link alone cannot establish memory."); return; }
    setBusy(true); setStatus("");
    const key = idempotencyKey || crypto.randomUUID();
    const draft = { source, product, title, text, sourceUrl, idempotencyKey: key, consent: true };
    try {
      await saveDraft(draft);
      const response = await fetch("/api/captures", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (response.status === 401) {
        window.location.assign("/login?next=%2Fcapture");
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Capture failed");
      await clearDraft();
      setText(""); setTitle(""); setSourceUrl(""); setIdempotencyKey("");
      setStatus(result.deduplicated ? "This source was already captured." : "Saved to your pending source inbox. No memory has been approved.");
    } catch (error) { setStatus(error.message || "Something went wrong. Your draft is retained locally."); }
    finally { setBusy(false); }
  }

  return <main className="shell narrow">
    <header className="masthead"><Link href="/" className="wordmark">topo<span className="topo-dot">.</span></Link><Link href="/" className="text-button">Inbox</Link></header>
    <div className="eyebrow">CAPTURE · SOURCE ONLY</div>
    <h1>Bring something with you.</h1>
    <p className="lead">Share something worth considering later. TOPO doesn't assume that a conversation excerpt is an authoritative statement about you.</p>
    <form className="form" onSubmit={submit}>
      <label htmlFor="product">Where did this come from?</label>
      <select id="product" value={product} onChange={(e) => setProduct(e.target.value)}>
        <option value="chatgpt">ChatGPT</option><option value="claude">Claude</option>
        <option value="gemini">Gemini</option><option value="copilot">Copilot</option>
        <option value="whatsapp-agent">WhatsApp agent</option><option value="other">Other</option>
      </select>
      <label htmlFor="title">Title (optional)</label>
      <input id="title" value={title} maxLength={180} onChange={(e) => setTitle(e.target.value)} placeholder="A useful decision or conversation"/>
      <label htmlFor="text">Shared excerpt</label>
      <textarea id="text" required rows={9} maxLength={24000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text here, or share from another app…" />
      <div className="helper">{text.length.toLocaleString("en-GB")} / 24,000 characters</div>
      <label htmlFor="url">Original link (optional)</label>
      <input id="url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://"/>
      <label className="checkline"><input type="checkbox" required/> I choose to send this excerpt to my private TOPO Cloud inbox.</label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save to pending inbox"}</button>
      {status && <p role="status" className="notice">{status}</p>}
    </form>
    <p className="helper">A captured source expires after seven days. This alpha does not yet extract or confirm Memory Pages automatically.</p>
  </main>;
}
