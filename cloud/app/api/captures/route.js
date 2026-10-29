import { NextResponse } from "next/server";
import { agentTokenMatches, ALPHA_OWNER, isSameOrigin } from "../../../lib/auth.mjs";
import { parseSourceSubmission } from "../../../lib/capture.mjs";
import { listCaptures, saveCapture } from "../../../lib/db.mjs";
import { sessionOwner } from "../../../lib/session.mjs";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const owner = await sessionOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorised" }, { status: 401, headers: HEADERS });
  try { return NextResponse.json({ sources: await listCaptures(owner) }, { headers: HEADERS }); }
  catch { return NextResponse.json({ error: "Source inbox unavailable" }, { status: 503, headers: HEADERS }); }
}

export async function POST(request) {
  const agent = agentTokenMatches(request.headers.get("authorization"), process.env.TOPO_AGENT_TOKEN_SHA256);
  const owner = agent ? ALPHA_OWNER : await sessionOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorised" }, { status: 401, headers: HEADERS });
  if (!agent && !isSameOrigin(request)) return NextResponse.json({ error: "Forbidden origin" }, { status: 403, headers: HEADERS });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415, headers: HEADERS });
  }
  if (Number(request.headers.get("content-length") || 0) > 35000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: HEADERS });
  }
  let capture;
  try {
    const raw = await request.text();
    if (raw.length > 35000) return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: HEADERS });
    capture = parseSourceSubmission(JSON.parse(raw), { agent });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Invalid input" }, { status: 400, headers: HEADERS });
  }
  try {
    const result = await saveCapture(owner, capture);
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201, headers: HEADERS });
  } catch (error) {
    if (error.status === 409) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    return NextResponse.json({ error: "Could not save source" }, { status: 503, headers: HEADERS });
  }
}
