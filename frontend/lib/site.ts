// Site-wide constants for metadata and the nav.
export const SITE = {
  name: "WalletIndex",
  pitch: "Your wallet becomes a market maker on Uniswap v4. 1inch Aqua keeps the money in your wallet; a new SwapVM instruction charges less for trades that rebalance you.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://wallet-index.vercel.app",
  repo: "https://github.com/SudeepGowda55/wallet-index",
};
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 627 };
export const PAGES = [["/", "Story"], ["/how", "How it works"], ["/proof", "Proof"], ["/live", "Live"]] as const;

export const pageMeta = (path: string, title: string, description = SITE.pitch) => ({
  title, description, alternates: { canonical: path },
  openGraph: { title: `${title} · ${SITE.name}`, description, url: path, siteName: SITE.name, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image" as const, title: `${title} · ${SITE.name}`, description, images: [OG_IMAGE.url] },
});
