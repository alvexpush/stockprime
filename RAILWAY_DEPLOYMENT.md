# Vanguard Prime Railway deployment

1. Create a new GitHub repository and push this project to it.
2. In Railway, create a project from that GitHub repository.
3. Add a persistent Railway volume mounted at `/data`.
4. Set `DATABASE_PATH=/data/platform.sqlite`.
5. Set `NODE_ENV=production`, `APP_URL=https://your-production-domain.example`, and the production secrets from `.env.example`.
6. Configure the required Zoho registration and sign-in email flow using `ZOHO_RAILWAY_EMAIL_SETUP.md`.
7. Railway uses `npm start` and checks `/api/health` automatically through `railway.json`.

Do not commit `.env` or the local `data/` directory. Registration now requires email confirmation, and every login requires both the user's private six-digit code and a new emailed one-time code.
