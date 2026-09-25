import { apiQuote } from "@/lib/server";
import { json, params } from "@/lib/route";

/** GET /api/quote?side=buy|sell&usd=500: which wallet the Uniswap pool would route to, and at what cost. */
export async function GET(req: Request) {
  const { net, side, usd } = params(req);
  if (side !== "buy" && side !== "sell") return Response.json({ error: "side must be buy or sell" }, { status: 400 });
  return json(() => apiQuote(net, side, usd));
}
