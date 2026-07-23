# StockPrime Railway deployment

1. Create a new GitHub repository and push this project to it.
2. In Railway, create a project from that GitHub repository.
3. Add a persistent Railway volume mounted at `/data`.
4. Set `DATABASE_PATH=/data/platform.sqlite`.
5. Set production secrets from `.env.example`, including the admin credentials and Zoho values when email login is re-enabled.
6. Railway uses `npm start` and checks `/api/health` automatically through `railway.json`.

Do not commit `.env` or the local `data/` directory. The current user login flow uses a user-created six-digit code; email OTP endpoints remain available for later activation.
