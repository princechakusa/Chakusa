# Chakusa end-to-end tests (Expo web + Playwright + Chrome)

These tests drive the real app in Google Chrome at phone size, against a real
local API and a **throwaway** `chakusa_test` database. They never touch
production. Each run creates two fresh accounts, one business and one
customer, and walks both through the whole product.

## What is covered

- `01-welcome-and-motion.spec.ts`: the first screen and its motion. It checks
  that the entrance really animates, the tagline rotates, cards spring under a
  press, and reduce-motion users get a static screen.
- `02-business-and-customer-journey.spec.ts`: in order:
  - **Business:** sign-up, the 8-step setup, and legal acceptance. Every main
    tab. Pinning the business location with device GPS and a dropped map pin
    (Expo Location, Nominatim, and Leaflet with OpenStreetMap). Creating a
    client, a lead, and an appointment. The quote Pro gate. Every "More"
    destination. A wrong-password rejection, then sign out and back in.
  - **Customer:** sign-up and legal acceptance. "Near me": distance, radius,
    map view, and searching a named place. The business profile map and
    directions. Booking a Haircut. The booking detail and every account
    screen. Sign out and back in.
  - **Business again:** sees the customer's booking on the calendar.

Every test fails on an uncaught error, a console error, or a blocked map
request. The run also lists any on-screen button without an accessible name.

## Run it

You need three things running: a test database, the API in test mode, and
Expo web. From the repo root (PowerShell shown; bash is equivalent):

```powershell
# 1. Throwaway Postgres (any free port; the name must be chakusa_test)
docker run -d --name chakusa-e2e-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=<pick-one> -e POSTGRES_DB=chakusa_test -p 5434:5432 postgres:16-alpine
$env:DATABASE_URL = "postgresql://e2e:<pick-one>@localhost:5434/chakusa_test"
$env:DIRECT_URL = $env:DATABASE_URL
npx prisma migrate deploy
$env:CHAKUSA_LOCAL_TEST_DATABASE_URL = $env:DATABASE_URL
npx tsx scripts/seed-legal-documents.ts --confirm-seed-local

# 2. API in test mode, allowing the Expo web origin
$env:NODE_ENV = "test"; $env:CORS_ALLOWED_ORIGINS = "http://localhost:8081"
npm run dev:test

# 3. The app: a production web build pointed at that API, served statically (in mobile/)
npm run e2e:build     # rebuild after app changes (~2-4 min)
npm run e2e:serve     # http://localhost:8081

# 4. The tests (in mobile/)
npm run e2e          # headless
npm run e2e:watch    # visible Chrome, slowed down, pausing on each screen
```

The suite runs against a **production build**, not `expo start`. A dev
server rebuilds the bundle on demand and stalls when the machine is busy:
page loads took minutes there, against about 1 s for the static build. The
production build is also what users actually get.

`e2e:build` turns Google and Apple **on** on purpose. On web their
buttons must stay hidden, because neither SDK can complete there, and the
tests check that.

The map steps call the real OpenStreetMap services (Nominatim and tile
servers). Both are free and keyless. The app follows their usage policies:
at most one Nominatim request per second, results cached, attribution shown,
and a valid Referer or User-Agent. Keep runs occasional.

Results: `mobile/e2e-report/` (HTML report) and `mobile/e2e-results/`
(screenshots and videos). Both are git-ignored.

To reset between runs, drop and recreate the schema, then repeat the
migrate and seed steps:

```powershell
docker exec chakusa-e2e-pg psql -U e2e -d chakusa_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```
