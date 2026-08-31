# Zoho Mail and Railway email setup

Vanguard Prime sends registration and sign-in codes through the Zoho Mail REST API over HTTPS. Railway hosts the application; Zoho hosts the mailbox and sends the email. SMTP, the mailbox password, and a Zoho app password are not required.

## 1. Split the domain responsibilities

The configured sender is `spgonline@zohomail.com`. Because Zoho owns the `zohomail.com` domain, no MX, SPF, DKIM, or DMARC changes are required for this sender.

If the sender is later changed to an address on a custom domain, use the same domain for both services but give each service its own DNS records:

- Website: connect `www.yourdomain.com` (or `app.yourdomain.com`) to Railway using the CNAME and TXT records Railway provides.
- Email: keep the domain's MX, SPF, DKIM, and DMARC records pointed to Zoho Mail.
- Sender: create a Zoho mailbox such as `security@yourdomain.com`.

Using a subdomain for Railway avoids placing a CNAME at the root where it can conflict with MX records at DNS providers that do not support CNAME flattening.

## 2. Configure the domain in Zoho Mail

1. Add the domain in Zoho Mail Admin Console.
2. Add Zoho's ownership TXT record at the DNS provider and verify it.
3. Add the exact MX records shown for the Zoho data center.
4. Add and verify SPF and DKIM.
5. Add DMARC initially with a monitoring policy such as `p=none`, then strengthen it after delivery has been observed.
6. Create `security@yourdomain.com` and confirm it can send and receive mail.

Do not copy MX or API host values from another Zoho region. Use the values displayed in the Zoho account.

## 3. Create Zoho OAuth credentials

1. Open the Zoho API Console in the same data center as the mailbox.
2. Create a Self Client for backend automation. The mailbox password is never entered into Vanguard Prime or Railway.
3. Generate an authorization grant with these scopes: `ZohoMail.messages.CREATE,ZohoMail.accounts.READ`.
4. Exchange the grant for tokens using `access_type=offline` and save the refresh token.
5. Record the Client ID and Client Secret. Treat all three values as production secrets.

For the local setup, place the newly generated one-time code in `ZOHO_GRANT_CODE` inside the ignored `.env`, then immediately run `npm run email:authorize`. The command exchanges it for the long-lived refresh token, saves that token without printing it, generates `OTP_SECRET` when needed, and clears the one-time code. A Zoho grant code cannot be used as `ZOHO_REFRESH_TOKEN`.

The application refreshes one-hour access tokens automatically. The long-lived refresh token remains in Railway variables and is never sent to the browser.

## 4. Add Railway variables

In the Railway service, open **Variables**, add the following, then deploy the staged changes:

```text
NODE_ENV=production
EMAIL_PROVIDER=zoho
APP_URL=https://your-production-domain.example
OTP_SECRET=<long-random-secret>
ZOHO_CLIENT_ID=<secret>
ZOHO_CLIENT_SECRET=<secret>
ZOHO_REFRESH_TOKEN=<secret>
ZOHO_FROM_EMAIL=spgonline@zohomail.com
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com
ZOHO_MAIL_API_URL=https://mail.zoho.com/api
DATABASE_PATH=/data/platform.sqlite
```

Replace both `.com` Zoho URLs with the matching data-center URLs when the mailbox is hosted in another region. `ZOHO_ACCOUNT_ID` is optional because the application discovers it using `ZohoMail.accounts.READ`; setting it explicitly removes that discovery request.

Generate `OTP_SECRET` with a password manager or cryptographic random generator. Seal `OTP_SECRET`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN` in Railway after confirming they work. Do not commit them to Git or place them in client-side JavaScript.

After placing the same variables in a local untracked `.env`, validate OAuth and mailbox discovery with:

```text
npm run email:check
```

The command prints the discovered `ZOHO_ACCOUNT_ID`, which can then be added to Railway. To send a real delivery test, run `npm run email:check -- --send`; it sends to `EMAIL_TEST_TO` when set, otherwise to the configured sender mailbox. The validator never prints OAuth credentials.

## 5. Connect Railway and persist data

1. Attach a Railway volume to the application service at `/data`.
2. Add the custom web subdomain in **Settings > Networking > Public Networking**.
3. Add both the Railway CNAME and verification TXT records to DNS.
4. Wait for Railway to issue HTTPS and show the domain as verified.
5. Keep one application replica while using SQLite. Multiple replicas cannot safely share one SQLite file.

## 6. Verify production

Open `https://www.yourdomain.com/api/health`. It should include:

```json
{"email":{"provider":"zoho","configured":true}}
```

Railway receives HTTP `503` from this endpoint and refuses the production deployment while required Zoho or OTP variables are missing.

Then register with a real external email address and confirm:

1. Registration redirects to the email confirmation screen.
2. The six-digit email arrives and expires after ten minutes.
3. The dashboard is unavailable until the registration code is confirmed.
4. A later sign-in requires the private login code and a new emailed one-time code.
5. The message passes SPF and DKIM in the recipient's message headers.

If health reports `configured: false`, check the Railway variables. If sending fails, verify that the OAuth credentials and mailbox are in the same Zoho data center and that the refresh token includes both required scopes.
