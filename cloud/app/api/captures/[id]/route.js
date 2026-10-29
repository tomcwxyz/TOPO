import { NextResponse } from "next/server";
import { isSameOrigin } from "../../../../lib/auth.mjs";
import { deleteCapture } from "../../../../lib/db.mjs";
import { sessionOwner } from "../../../../lib/session.mjs";

export async function DELETE(request, { params }) {
  const owner = await sessionOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  try {
    const deleted = await deleteCapture(owner, id);
    return NextResponse.json({ deleted }, { status: deleted ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not delete source" }, { status: 503 }); }
}
