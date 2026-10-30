# chakusa-worker-tick

A Cloudflare cron worker (free) that calls the API's `POST /internal/worker/tick` every 5 minutes. On Render's free plan the API sleeps after ~15 idle minutes; without this, scheduled follow-ups, reminders and review requests wait until someone opens the app.

## Deploy (owner, once)

```powershell
cd cloudflare/worker-tick
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npx wrangler secret put WORKER_TRIGGER_SECRET   # paste the same value as Render's WORKER_TRIGGER_SECRET
npx wrangler deploy
```

Check: Cloudflare dashboard → Workers → chakusa-worker-tick → Logs shows a run every 5 minutes, and `GET https://chakusa-api.onrender.com/health/worker` shows a recent `lastSuccessAt`.
