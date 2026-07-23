# StockPrime

## Run locally

```powershell
$env:FINNHUB_API_KEY="your_finnhub_api_key"
node server.js
```

Open `http://localhost:3000`.

The Finnhub key is used only by the server and is never exposed to the browser. The stock page requests cached quotes from `/api/stocks/quotes` every 60 seconds. Without a key, it displays `Feed unavailable` instead of presenting seeded values as live.

For the full service/module map, see `CORE_ENGINE_SERVICES.md`.

## Useful pages

- Customer registration: `/register.html`
- Customer dashboard: `/dashboard.html`
- Live stocks: `/stocks.html`
- Investment dashboard: `/investment-dashboard.html`
- Admin login: `/admin-login.html`

Admin design credentials:

- Email: `admin@tesla.test`
- Password: `Admin123!`

## Database

SQLite data is stored in `data/platform.sqlite`.

```powershell
node scripts/check-db.js
```
