import { apiStatus } from "@/lib/server";
import { json, params } from "@/lib/route";

/** GET /api/status: deployment, block, prices the wallets use, live Base mainnet price, agent's last decision. */
export async function GET(req: Request) { const { net } = params(req); return json(() => apiStatus(net)); }
