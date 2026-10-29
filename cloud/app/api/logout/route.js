import { NextResponse } from "next/server";
import { isSameOrigin, SESSION_COOKIE } from "../../../lib/auth.mjs";

export async function POST(request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
