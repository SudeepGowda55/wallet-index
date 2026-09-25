import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WalletIndex",
  description: "Wallets that market-make on Uniswap v4, priced by a new 1inch SwapVM instruction, money kept in 1inch Aqua wallets.",
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
