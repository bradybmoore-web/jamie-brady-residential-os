/**
 * End-to-end smoke test.
 *
 * Drives a real browser through the flows that unit tests cannot reach: the
 * login server action, the interactive priority cards, marketing generation and
 * approval, the approval queue, and the assistant.
 *
 * Prerequisites:
 *   npx playwright install chromium     # once, or set CHROMIUM_PATH instead
 *   npm run build && npm run start      # in another terminal
 *
 * Then:
 *   npm run test:e2e                    # or: node tests/e2e/smoke.mjs <baseUrl>
 *
 * Defaults to http://localhost:3000. Assumes the app is running on seed data
 * with the default demo passcode; it mutates that data as it goes, so restart
 * the server between runs for a clean slate.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSCODE = process.env.DEMO_PASSCODE ?? "residential";

const results = [];
const failures = [];

function ok(name, condition, detail = "") {
  results.push(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(name);
}

// CHROMIUM_PATH lets this run against a Chromium that is already on the machine
// (a CI image, a preinstalled browser) instead of Playwright's own download.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* -------------------------------------------------------------------- auth */

await page.goto(`${BASE}/today`, { waitUntil: "networkidle" });
ok("an unauthenticated visit is redirected to login", page.url().includes("/login"));

const wrong = await browser.newPage();
await wrong.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await wrong.fill("#passcode", "definitely-not-the-passcode");
await wrong.click('button[type="submit"]');
await wrong.waitForSelector('p[role="alert"]', { timeout: 15000 });
ok("a wrong passcode is rejected", (await wrong.locator('p[role="alert"]').first().innerText()).includes("not correct"));
await wrong.close();

await page.selectOption("#profileId", { index: 0 });
await page.fill("#passcode", PASSCODE);
await page.click('button[type="submit"]');
await page.waitForURL("**/today", { timeout: 20000 });
ok("signing in lands on Today", page.url().endsWith("/today"));
ok("Jamie is greeted by name", /Jamie/.test(await page.locator("h1").first().innerText()));

/* ------------------------------------------------------------------- today */

const firstCard = (await page.locator("h3").first().innerText()).trim();

await page.getByRole("button", { name: /records? behind this/i }).first().click();
await page.waitForTimeout(300);
ok(
  "a priority card discloses the records behind it",
  await page.locator("text=/Last personal contact|Inquiry|Task:|Contract milestone/").first().isVisible(),
);

await page.getByRole("button", { name: "Mark Done" }).first().click();
await page.waitForFunction(
  (name) => ![...document.querySelectorAll("h3")].some((h) => h.textContent?.trim() === name),
  firstCard,
  { timeout: 25000 },
);
ok("Mark Done clears the card", true, firstCard);

await page.reload({ waitUntil: "networkidle" });
const remaining = (await page.locator("h3").allInnerTexts()).map((t) => t.trim());
ok("completed work does not come back after a reload", !remaining.includes(firstCard), firstCard);

await page.getByRole("button", { name: "Prepare Me" }).first().click();
await page.waitForSelector("text=Appointment preparation", { timeout: 30000 });
ok("Prepare Me produces a brief with talking points", await page.locator("text=Talking points").isVisible());

/* --------------------------------------------------------------- marketing */

await page.goto(`${BASE}/marketing`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: "Open Listing Studio" }).first().click();
await page.waitForURL("**/marketing/**");
await page.getByRole("button", { name: /^(Generate|Regenerate)$/ }).click();
await page.waitForSelector("textarea", { timeout: 30000 });

const copy = await page.locator("textarea").first().inputValue();
ok("the studio produces listing copy", copy.length > 100, `${copy.length} characters`);
ok("the copy avoids stock real-estate phrasing", !/stunning|nestled|boasts|dream home/i.test(copy));

await page.getByRole("button", { name: "Approve" }).first().click();
await page.waitForSelector("text=Approved and ready to publish", { timeout: 20000 });
ok("marketing copy can be approved", true);

/* ------------------------------------------------------- leads → approvals */

await page.goto(`${BASE}/leads?view=all`, { waitUntil: "networkidle" });
await page.locator('a[href^="/leads/"]').first().click();
await page.waitForURL("**/leads/**");
await page.getByRole("button", { name: /Re-analyse/ }).click();
await page.waitForSelector("text=/Classified as/", { timeout: 30000 });
ok("a lead can be re-analysed and reports its classification", true);

await page.goto(`${BASE}/approvals`, { waitUntil: "networkidle" });
ok("the drafted reply is waiting for review", /Needs Review/i.test(await page.locator("body").innerText()));

await page.getByRole("button", { name: "Approve" }).first().click();
await page.getByRole("button", { name: "Send" }).first().waitFor({ timeout: 25000 });
ok("approving unlocks the send step", true);

await page.getByRole("button", { name: "Send" }).first().click();
await page.waitForTimeout(3000);
await page.reload({ waitUntil: "networkidle" });
const afterSend = await page.locator("body").innerText();
ok("what actually happened on send survives a reload", /not connected|approval queue|drafts folder/i.test(afterSend));
ok("the page says plainly that no message left the application", /no message leaves this application/i.test(afterSend));

/* --------------------------------------------------- assistant + filtering */

await page.goto(`${BASE}/assistant`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Which relationships are going cold?" }).click();
await page.waitForSelector("text=Looked at", { timeout: 40000 });
ok("the assistant answers using its tools", /getOpportunities/.test(await page.locator("body").innerText()));

await page.goto(`${BASE}/opportunities`, { waitUntil: "networkidle" });
const shownBefore = await page.locator("text=/\\d+ shown/").innerText();
await page.selectOption("#filter", "active_buyer");
await page.waitForTimeout(400);
const shownAfter = await page.locator("text=/\\d+ shown/").innerText();
ok("the opportunity filter narrows the list", shownBefore !== shownAfter, `${shownBefore} -> ${shownAfter}`);
await page.selectOption("#filter", "all");

/* ------------------------------------------------------ navigation + mobile */

for (const label of [
  "Today", "Leads", "Clients", "Buyers", "Listings",
  "Transactions", "Marketing", "Opportunities", "AI Assistant", "Approvals", "Settings",
]) {
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForLoadState("networkidle");
  const body = await page.locator("body").innerText();
  ok(`navigation: ${label}`, !/could not load|does not exist/i.test(body));
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/today`, { waitUntil: "networkidle" });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
ok("no horizontal overflow at 390px", overflow <= 1, `${overflow}px`);

await page.getByRole("button", { name: "Open navigation" }).click();
await page.waitForTimeout(300);
ok("mobile navigation opens", await page.getByRole("link", { name: "Listings", exact: true }).first().isVisible());

/* ------------------------------------------------------------------ report */

console.log(results.join("\n"));
console.log(`\nConsole errors: ${consoleErrors.length ? consoleErrors.slice(0, 6).join("\n  ") : "none"}`);
console.log(`\n${results.length - failures.length}/${results.length} passed`);

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
