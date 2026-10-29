import { redirect } from "next/navigation";
import { sessionOwner } from "../../lib/session.mjs";

export const dynamic = "force-dynamic";
export default async function Login({ searchParams }) {
  if (await sessionOwner()) redirect("/");
  const params = await searchParams;
  const next = params?.next === "/capture" ? "/capture" : "/";
  return <main className="shell narrow">
    <header className="masthead"><span className="wordmark">topo<span className="topo-dot">.</span></span></header>
    <div className="eyebrow">PRIVATE ALPHA</div>
    <h1>Your context, your choice.</h1>
    <p className="lead">TOPO Cloud is currently a one-person development alpha. Sign in to submit or review captured sources.</p>
    <form action="/api/login" method="post" className="form">
      <input type="hidden" name="next" value={next}/>
      <label htmlFor="password">Alpha access password</label>
      <input id="password" type="password" name="password" autoComplete="current-password" required minLength={16}/>
      {params?.error === "1" && <p role="alert" className="error">That password wasn't accepted.</p>}
      <button className="primary-button" type="submit">Sign in</button>
    </form>
    <p className="helper">Nothing you share becomes an approved memory without a separate review step.</p>
  </main>;
}
