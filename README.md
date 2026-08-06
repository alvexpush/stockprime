# StockPrime

## Run locally

```powershell
$env:FINNHUB_API_KEY="your_finnhub_api_key"
node server.js
```

Open `http://localhost:3000`.

For local registration testing, keep `EMAIL_PROVIDER=development` in `.env`. The
six-digit verification code will appear on the confirmation page and will be
filled in automatically. Restart the Node server after changing `.env`.

For deployment, set `EMAIL_PROVIDER=zoho` in the hosting provider's environment
variables together with the required `ZOHO_*` credentials and `OTP_SECRET`.

The Finnhub key is used only by the server and is never exposed to the browser. The stock page requests cached quotes from `/api/stocks/quotes` every 60 seconds. Without a key, it displays `Feed unavailable` instead of presenting seeded values as live.

For the full service/module map, see `CORE_ENGINE_SERVICES.md`.

## Useful pages

- Customer registration: `/register.html`
- Customer dashboard: `/dashboard.html`
- Live stocks: `/stocks.html`
- Investment dashboard: `/investment-dashboard.html`
- Admin login: `/admin-login.html`

Configure `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before using the administrator portal.

## Database

SQLite data is stored in `data/platform.sqlite`.

```powershell
node scripts/check-db.js
```
