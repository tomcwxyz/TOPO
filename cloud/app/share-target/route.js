// The installed-PWA service worker handles these POSTs locally.
// This server fallback deliberately does not read or persist private shares.
export function POST() {
  return new Response("Open the installed TOPO app and share again, or paste the text manually at /capture.", {
    status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export function GET(request) {
  return Response.redirect(new URL("/capture", request.url), 303);
}
