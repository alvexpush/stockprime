const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_FROM_EMAIL"];
const missing = required.filter(key => !String(process.env[key] || "").trim());
if (missing.length) {
  console.error(`Zoho email is not configured. Missing: ${missing.join(", ")}`);
  process.exitCode = 1;
  return;
}

const accountsBase = String(process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/$/, "");
const mailBase = String(process.env.ZOHO_MAIL_API_URL || "https://mail.zoho.com/api").replace(/\/$/, "");
const fromAddress = process.env.ZOHO_FROM_EMAIL.trim();

async function requestJson(url, options, label) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const providerError = data.error || data.data?.errorCode || data.status?.description;
    throw new Error(`${label} failed (${response.status})${providerError ? `: ${providerError}` : ""}`);
  }
  return data;
}

async function main() {
  const tokenData = await requestJson(`${accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token"
    })
  }, "Zoho token refresh");
  if (!tokenData.access_token) throw new Error(`Zoho token refresh returned no access token${tokenData.error ? `: ${tokenData.error}` : "."}`);

  const authorization = `Zoho-oauthtoken ${tokenData.access_token}`;
  const accountData = await requestJson(`${mailBase}/accounts`, {
    headers: { Authorization: authorization, Accept: "application/json" }
  }, "Zoho account discovery");
  const accounts = Array.isArray(accountData.data) ? accountData.data : [];
  const normalized = fromAddress.toLowerCase();
  const account = accounts.find(item =>
    [item.primaryEmailAddress, item.emailAddress, item.accountName]
      .some(value => String(value || "").toLowerCase() === normalized)
  );
  if (!account?.accountId) throw new Error(`Zoho did not return an account for ${fromAddress}.`);

  console.log(`PASS OAuth and mailbox access are valid for ${fromAddress}.`);
  console.log(`ZOHO_ACCOUNT_ID=${account.accountId}`);

  if (!process.argv.includes("--send")) return;
  const recipient = String(process.env.EMAIL_TEST_TO || fromAddress).trim();
  await requestJson(`${mailBase}/accounts/${encodeURIComponent(account.accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      fromAddress,
      toAddress: recipient,
      subject: "StockPrime production email check",
      content: "<p>Zoho Mail is configured correctly for StockPrime.</p>",
      mailFormat: "html",
      askReceipt: "no"
    })
  }, "Zoho test email");
  console.log(`PASS Test email accepted for delivery to ${recipient}.`);
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
