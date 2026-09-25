import fs from "fs";
import path from "path";
import { DEPLOYMENTS } from "@/lib/server";

/** GET /deployments/<net>.json | <net>.state.json: deployment addresses and the agent's decision log. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[a-z0-9_-]+(\.state)?\.json$/i.test(file)) return Response.json({ error: "not found" }, { status: 404 });
  const p = path.join(DEPLOYMENTS, file);
  if (!fs.existsSync(p)) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
