import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth.mjs";

export async function sessionOwner() {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, process.env.TOPO_SESSION_SECRET);
}
