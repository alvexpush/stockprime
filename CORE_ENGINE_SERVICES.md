# Core Engine Services

This project keeps third-party API keys on the Node server and exposes only app-owned endpoints to the browser.

## Runtime

- Node.js 24+
  - Runs `server.js`.
  - Uses native `fetch`, `crypto`, `http`, `fs`, and `node:sqlite`.
- SQLite
  - Database file: `data/platform.sqlite`.
  - Schema and seed data: `database.js`.
  - Check command: `npm.cmd run db:check`.
- Playwright Core
  - Used by `scripts/e2e-flow.js` for end-to-end checks.
  - Check command: `npm.cmd run test:e2e`.

## Market Data

- Finnhub
  - Used for live stock quotes through `/api/stocks/quotes`.
  - Optional fallback source for current general market news through `/api/market-news`.
  - Environment variable: `FINNHUB_API_KEY`.
  - Docs: https://finnhub.io/docs/api/quote and https://finnhub.io/docs/api/market-news

- Alpha Vantage
  - Preferred free-friendly source for current market news and sentiment through `/api/market-news`.
  - Environment variable: `ALPHA_VANTAGE_API_KEY`.
  - Docs: https://www.alphavantage.co/documentation/#news-sentiment

## Email

- Resend
  - Sends password reset email when configured.
  - Without a key, reset links are logged to the server console for development.
  - Environment variables: `RESEND_API_KEY`, `RESET_FROM_EMAIL`.
  - Docs: https://resend.com/docs/send-with-nodejs

## App-Owned API Surface

- Auth and sessions
  - `/api/register`
  - `/api/login`
  - `/api/logout`
  - `/api/me`
  - `/api/password/forgot`
  - `/api/password/reset`
  - `/api/password/change`

- Wallet
  - `/api/wallet`
  - `/api/wallet/transactions`
  - `/api/wallet/deposits`
  - `/api/wallet/withdrawals`

- Investments
  - `/api/investment-plans`
  - `/api/investment-orders`
  - Six active staged plans are maintained in `database.js`.

- Stocks and market content
  - `/api/stocks/quotes`
  - `/api/stock-orders`
  - `/api/market-news`

- Dashboard and inventory
  - `/api/dashboard`
  - `/api/vehicles`

- Notifications
  - `/api/notifications`
  - `/api/notifications/:id/read`
  - `/api/admin/notifications`

- Admin
  - `/api/admin/login`
  - `/api/admin/logout`
  - `/api/admin/users`
  - `/api/admin/users/password`
  - `/api/admin/payments`
  - `/api/admin/payments/:id/status`
  - `/api/admin/investment-plans`

## Frontend Modules

- `global-theme.js` and `global-theme.css`
  - Global market ticker.
  - Theme/logo normalization.
  - Notification drawer and unread/opened badge behavior.

- `dashboard.js`
  - Customer dashboard data hydration.
  - Dashboard video controls.
  - Wallet, portfolio, vehicle, and stock summary panels.

- `investments.js`
  - Server-backed investment plan listing.
  - Investment purchase flow and duration selection.

- `stocks.js`
  - Live quote loading.
  - Stock table, watchlist, and stock order flow.

- `wallet.js`
  - Deposit and withdrawal flows.

- `portal.js`
  - Portfolio, profile, order, and analytics views.

- `admin.js`
  - Admin operations for users, plans, payments, notifications, vehicles, and orders.

## Required Production Environment

```powershell
FINNHUB_API_KEY="..."
ALPHA_VANTAGE_API_KEY="..."
RESEND_API_KEY="..."
RESET_FROM_EMAIL="StockPrime <support@yourdomain.com>"
ADMIN_EMAIL="admin@yourdomain.com"
ADMIN_PASSWORD="use-a-strong-password"
SESSION_DAYS="7"
```

`ALPHA_VANTAGE_API_KEY` is optional if Finnhub market news is enough. `FINNHUB_API_KEY` is required for live stock quotes.
