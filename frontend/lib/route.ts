// Shared request parsing + JSON error handling for the API route handlers.
export function params(req: Request) {
  const u = new URL(req.url), q = u.searchParams;
  const side = (q.get("side") || "buy") as "buy" | "sell";
  return { net: q.get("net") || "local", usd: Number(q.get("usd") || 500), side };
}
export async function json(fn: () => Promise<any>) {
  try { return Response.json(await fn(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e: any) { return Response.json({ error: e.shortMessage || e.message }, { status: e.message?.includes("only enabled") ? 403 : 500 }); }
}
