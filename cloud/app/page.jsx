import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionOwner } from "../lib/session.mjs";
import { listCaptures } from "../lib/db.mjs";
import { CaptureCard } from "./source-card.jsx";

export const dynamic = "force-dynamic";

export default async function Home() {
  const owner = await sessionOwner();
  if (!owner) redirect("/login");
  let sources = [], error = null;
  try { sources = await listCaptures(owner); }
  catch { error = "The source inbox is unavailable. Check the cloud database configuration."; }
  return <main className="shell">
    <header className="masthead">
      <Link href="/" className="wordmark">topo<span className="topo-dot">.</span></Link>
      <form action="/api/logout" method="post"><button className="text-button" type="submit">Sign out</button></form>
    </header>
    <div className="eyebrow">PRIVATE ALPHA · CLOUD CAPTURE</div>
    <h1>Keep what matters.</h1>
    <p className="lead">Save useful conversation excerpts from your phone or a connected agent, then decide what is worth remembering.</p>
    <div className="action-row">
      <Link href="/capture" className="primary-button">Capture something</Link>
      <span className="helper">No source is automatically approved as a memory.</span>
    </div>
    <section className="section-head">
      <div><div className="eyebrow">INBOX</div><h2>Awaiting review <span className="count">{sources.length}</span></h2></div>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {!error && sources.length === 0 && <div className="empty">
      <div className="empty-icon">◎</div>
      <h3>Nothing in your inbox yet.</h3>
      <p>Share text to the installed TOPO app on Android, or capture it manually.</p>
      <Link href="/capture">Add your first source</Link>
    </div>}
    <div className="source-list">{sources.map((source) => <CaptureCard key={source.id} source={source} />)}</div>
    <footer>Sources expire after seven days. This cloud alpha stores unverified captures only; Memory Page extraction and confirmation are coming next.</footer>
  </main>;
}
