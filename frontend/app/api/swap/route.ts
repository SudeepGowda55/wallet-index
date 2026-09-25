import { apiSwap } from "@/lib/server";
import { json, params } from "@/lib/route";

/** POST /api/swap?side=buy|sell&usd=500 (local fork): real swap through the Uniswap v4 pool; returns tx + who filled it. */
export async function POST(req: Request) {
  const { net, side, usd } = params(req);
  if (side !== "buy" && side !== "sell") return Response.json({ error: "side must be buy or sell" }, { status: 400 });
  return json(() => apiSwap(net, side, usd));
}
