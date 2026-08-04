const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const db = require("../database");
const { chromium } = require("playwright-core");
const base = process.env.BASE_URL || "http://127.0.0.1:3204";
let conversationId = "";
let browser;

async function request(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return { response, payload };
}

(async () => {
  try {
    const created = await request("/api/support/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Automated support integration test" }),
    });
    conversationId = created.payload.conversation.id;
    const visitorToken = created.payload.conversation.token;

    const login = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL || "admin@tesla.test",
        password: process.env.ADMIN_PASSWORD || "Admin123!",
      }),
    });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const conversations = await request("/api/admin/support/conversations", { headers: { Cookie: cookie } });
    if (!conversations.payload.conversations.some((item) => item.id === conversationId)) throw new Error("Conversation did not reach the admin inbox.");

    await request(`/api/admin/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Automated admin reply" }),
    });
    const visitorView = await request(`/api/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
      headers: { "X-Support-Token": visitorToken },
    });
    const reply = visitorView.payload.messages.find((message) => message.senderType === "admin" && message.message === "Automated admin reply");
    if (!reply) throw new Error("Admin reply did not reach the visitor conversation.");
    if (visitorView.payload.messages[0]?.senderType !== "visitor" || visitorView.payload.messages[1]?.senderType !== "admin") throw new Error("Support messages are not in chronological order.");
    const [cookieName, cookieValue] = cookie.split("=");
    browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: cookieName, value: cookieValue, url: base }]);
    await context.addInitScript((adminEmail) => localStorage.setItem("stockprimeAdminSession", JSON.stringify({ email: adminEmail, name: "Super Admin" })), process.env.ADMIN_EMAIL || "admin@tesla.test");
    const page = await context.newPage();
    await page.goto(`${base}/admin.html#support`, { waitUntil: "domcontentloaded" });
    await page.locator(`[data-support-conversation="${conversationId}"]`).waitFor({ timeout: 10000 });
    await page.locator(`[data-support-conversation="${conversationId}"]`).click();
    await page.locator("[data-support-reply]").waitFor();
    await page.screenshot({ path: "data/stockprime-admin-support.png", fullPage: true });
    const visitorContext = await browser.newContext();
    await visitorContext.addInitScript((session) => localStorage.setItem("stockprimeSupportConversation", JSON.stringify(session)), { id: conversationId, token: visitorToken, status: "open" });
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
    await visitorPage.locator("[data-chat-launcher]").click();
    await visitorPage.locator("[data-chat-messages] p").filter({ hasText: "Automated admin reply" }).waitFor({ timeout: 10000 });
    await visitorPage.screenshot({ path: "data/stockprime-home-support-reply.png" });
    console.log({ conversationCreated: true, adminInboxReceived: true, adminReplyReceived: true, adminUiRendered: true, visitorUiRendered: true, chronological: true, messageCount: visitorView.payload.messages.length });
  } finally {
    if (browser) await browser.close();
    if (conversationId) db.prepare("DELETE FROM support_conversations WHERE public_id=?").run(conversationId);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
