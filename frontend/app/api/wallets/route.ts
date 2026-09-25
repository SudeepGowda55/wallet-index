import { apiWallets } from "@/lib/server";
import { json, params } from "@/lib/route";

/** GET /api/wallets?usd=500: every maker wallet: balances, mix vs target, base spread, live cost to buy/sell. */
export async function GET(req: Request) { const { net, usd } = params(req); return json(() => apiWallets(net, usd)); }
