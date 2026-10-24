import type { Metadata } from "next";
import { Martian_Mono, Onest, Unbounded } from "next/font/google";
import Shell from "@/components/site/Shell";
import { OG_IMAGE, SITE } from "@/lib/site";
import "./globals.css";

const display = Unbounded({ subsets: ["latin"], variable: "--f-display", weight: ["300", "400", "500", "600"] });
const body = Onest({ subsets: ["latin"], variable: "--f-body" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--f-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · wallets that rebalance themselves`, template: `%s · ${SITE.name}` },
  description: SITE.pitch,
  openGraph: { title: SITE.name, description: SITE.pitch, url: "/", siteName: SITE.name, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
