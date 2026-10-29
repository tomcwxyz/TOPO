import { NextResponse } from "next/server";
import { isSameOrigin, issueSession, passwordMatches, SESSION_COOKIE, SESSION_SECONDS } from "../../../lib/auth.mjs";

export async function POST(request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (!passwordMatches(form.get("password"), process.env.TOPO_ALPHA_PASSWORD)) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }
  let token;
  try { token = issueSession(process.env.TOPO_SESSION_SECRET); }
  catch { return new Response("Cloud alpha is not configured", { status: 503 }); }
  const destination = form.get("next") === "/capture" ? "/capture" : "/";
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
