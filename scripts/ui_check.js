// Browser check of the UI with Playwright: loads the page, clicks Buy / Sell / official-router trade, checks
// console errors and mobile layout, saves screenshots to .run/. Setup once: npm i playwright@1 && npx playwright install chromium
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = [];
  p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  await p.goto((process.env.UI_URL || "http://localhost:8787/"), { waitUntil: "networkidle" });
  await p.waitForFunction(() => document.querySelectorAll("#wallets .panel").length >= 3, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: ".run/ui-desktop-loaded.png", fullPage: true });
  const txt = id => p.$eval("#" + id, e => e.innerText);
  console.log("shared before:", await txt("slWallet"), "|", await txt("slBasket"), "|", await txt("slCurve")); console.log("bestBuy:", await txt("bestBuy")); console.log("bestSell:", await txt("bestSell")); console.log("shared:", await txt("slRatio"));
  await p.click("#buy");
  await p.waitForFunction(() => /tx 0x|reverted/.test(document.querySelector("#tradeMsg").innerText), null, { timeout: 60000 });
  console.log("buy ->", await txt("tradeMsg"));
  const prev = await txt("tradeMsg");
  await p.click("#sell");
  await p.waitForFunction(pv => { const t = document.querySelector("#tradeMsg").innerText; return t !== pv && /tx 0x|reverted/.test(t); }, prev, { timeout: 60000 });
  console.log("sell ->", await txt("tradeMsg"));
  await p.click("#direct");
  await p.waitForFunction(() => /tx 0x|reverted/.test(document.querySelector("#directMsg").innerText), null, { timeout: 60000 });
  console.log("direct ->", await txt("directMsg"));
  await p.waitForTimeout(6000); console.log("shared after:", await txt("slWallet"), "|", await txt("slBasket"), "|", await txt("slCurve"), "|", await txt("slRatio"));
  await p.screenshot({ path: ".run/ui-desktop-after-trades.png", fullPage: true });
  const mobile = await b.newPage({ viewport: { width: 400, height: 900 } });
  await mobile.goto((process.env.UI_URL || "http://localhost:8787/"), { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => document.querySelectorAll("#wallets .panel").length >= 3, null, { timeout: 60000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await mobile.screenshot({ path: ".run/ui-mobile.png", fullPage: true });
  console.log("mobile horizontal overflow:", overflow);
  console.log("console errors:", errs.length ? errs : "none");
  await b.close();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
