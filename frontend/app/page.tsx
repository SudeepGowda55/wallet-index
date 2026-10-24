import Home from "@/components/site/Home";
import { pageMeta } from "@/lib/site";

export const metadata = { ...pageMeta("/", "Wallets that rebalance themselves"), title: { absolute: "WalletIndex · wallets that rebalance themselves" } };
export default function Page() { return <Home />; }
