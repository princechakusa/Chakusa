# Production mobile environment

Configure the production build environment (EAS or equivalent) with:

```dotenv
EXPO_PUBLIC_API_URL=https://chakusa-api.onrender.com
EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=false
EXPO_PUBLIC_APPLE_AUTH_ENABLED=false
EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED=false
EXPO_PUBLIC_AUTOMATION_ENABLED=false
EXPO_PUBLIC_BILLING_ENABLED=false
```

These are public Expo build values only. Do not place database URLs, Supabase credentials, JWT secrets, private Apple keys, Google service credentials, Twilio credentials, or backend Sentry credentials in mobile environment files.

For local development, create `mobile/.env` from `.env.example` and set `EXPO_PUBLIC_API_URL` to a reachable local API address: `http://localhost:4000` for Expo Web, `http://10.0.2.2:4000` for Android emulator, or the computer's LAN address for a physical device. Restart Expo after changing a public environment variable.
