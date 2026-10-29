import { purgeExpiredCaptures } from "../../../../lib/db.mjs";
import { passwordMatches } from "../../../../lib/auth.mjs";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Disabled" }, { status: 503 });
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || !passwordMatches(header.slice(7), secret)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    return Response.json({ deleted: await purgeExpiredCaptures() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch { return Response.json({ error: "Purge unavailable" }, { status: 503 }); }
}
