# Production mobile environment

Configure the production build environment (EAS or equivalent) with:

```dotenv
EXPO_PUBLIC_API_URL=https://chakusa-api.onrender.com
EXPO_PUBLIC_EAS_PROJECT_ID=3a425309-15fb-4407-8db4-9c380feae21b
EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=618618639466-03el8vtndca92oqjrcqv2f8uv7tqm41m.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=618618639466-1sosi4hua8q64h0til1rjkam36cbpdvd.apps.googleusercontent.com
EXPO_PUBLIC_APPLE_AUTH_ENABLED=true
EXPO_PUBLIC_EMAIL_ENABLED=false
EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED=false
EXPO_PUBLIC_AUTOMATION_ENABLED=false
EXPO_PUBLIC_BILLING_ENABLED=false
```

These are public Expo build values only. Do not place database URLs, Supabase credentials, JWT secrets, private Apple keys, Google service credentials, Twilio credentials, or backend Sentry credentials in mobile environment files.

For local development, create `mobile/.env` from `.env.example` and set `EXPO_PUBLIC_API_URL` to a reachable local API address: `http://localhost:4000` for Expo Web, `http://10.0.2.2:4000` for Android emulator, or the computer's LAN address for a physical device. Restart Expo after changing a public environment variable.
