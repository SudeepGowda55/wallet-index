import { pageMeta } from "@/lib/site";
import Dashboard from "./Dashboard";

export const metadata = pageMeta("/live", "Live", "Live wallets, routing, charts, trades and the agent's decisions, read straight from the chain.");
export default function Page() { return <Dashboard />; }
