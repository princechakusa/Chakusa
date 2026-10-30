# App review notes (Apple App Review Information, Google Play app access)

Paste the sections below into App Store Connect (App Review Information → Notes) and Play Console
(App content → App access). Fill in the three `<…>` values from `npm run seed:qa` on a staging
database, or from your demo accounts. Never commit real passwords.

## Demo accounts
- Business owner: `<demo business email>` / `<password>` (Business plan, sample leads, bookings, reviews)
- Customer: `<demo customer email>` / `<password>`
- Customers can also tap "Browse without an account" on the sign-in screen (no login needed).

## What Chakusa is
Chakusa helps local service businesses (barbers, clinics, cleaners, repair shops) win back missed
calls, manage leads, bookings, quotes, invoices and reviews. Customers find and book those
businesses. Both roles are in one app.

## How to see the main features
1. **Leads and recovery:** sign in as the business owner → Leads. Sample leads are shown.
2. **Missed-call detection:** Android only (Account → Automation → Recovery engine → Turn on; a
   disclosure explains the permissions first). iPhone does not allow apps to see calls (iOS
   restriction), so on iPhone a business forwards unanswered calls to its Chakusa call line.
   To see it: from any phone call **+1 662 623 1646** and let it ring; a missed-call lead appears in
   the demo business's Leads within seconds. (Only phones verified in Twilio can call while the
   Twilio account is on a trial; upgrade before review. See OA-26.)
3. **Subscriptions (Starter, Pro, Business):** Account → Subscription. Purchases use Apple In-App
   Purchase. Sandbox purchases work against this server; Restore purchases is on the same screen.
4. **Messaging:** customers message a business from its profile → Message. Every conversation has
   a menu (••• top right) to **Report** or **Block**; every review and business profile has a
   **Report** link. Reports go to our moderation queue and are reviewed by our team.
5. **AI assistant (customer app):** shown only after the customer agrees to share the conversation
   with our AI providers (consent card). Business AI receptionist asks for confirmation each time
   it is switched on.
6. **Account deletion:** Account → Delete account (in the app) and
   https://chakusarecovery.com/delete-account. Sign in with Apple tokens are revoked on deletion.

## Things a reviewer may notice
- **Automatic WhatsApp replies** are enabled per business once its WhatsApp Business number is
  verified. In this build, messages are prepared in the app and the owner sends them from their
  own phone. SMS is off.
- **Location** is foreground only, never tracked in the background: nearby search, pinning a
  business, and (only when a provider chooses) showing a customer the provider is on the way.
- **Age:** the app is for people 18 and over; sign-up requires confirming it.
- Support: support@chakusarecovery.com. Privacy: https://chakusarecovery.com/privacy. Terms:
  https://chakusarecovery.com/terms.

## Server availability
The API is at https://chakusa-api.onrender.com. Keep it awake during review (the free Render
instance sleeps after inactivity); open the app once before submitting so it is warm.
