import { PrismaClient, type LegalDocumentType } from "@prisma/client";

/**
 * PROGRAM 2 LOOP 4 — one-off seed for the four legal documents.
 *
 * Nothing is published when the legal-acceptance tables are first migrated,
 * so `GET /legal/documents/:type` 404s until this runs. The HTTP admin API
 * needs an authenticated admin session (chicken-and-egg for a first seed),
 * so this writes v1 PUBLISHED rows directly via Prisma instead, following
 * the same pattern as prisma/seed.ts and scripts/bootstrap-admin.ts.
 *
 * Safety: mirrors scripts/prisma-local.mjs exactly — refuses to run unless
 * CHAKUSA_LOCAL_TEST_DATABASE_URL is a localhost `chakusa_test` URL, and
 * builds its own PrismaClient bound to that URL so an unrelated
 * DATABASE_URL in the environment can never be the target. Also requires an
 * explicit confirmation token as argv[2].
 *
 * Usage (PowerShell):
 *   $env:CHAKUSA_LOCAL_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/chakusa_test'
 *   npx tsx scripts/seed-legal-documents.ts --confirm-seed-local
 *
 * Idempotent: if a version already exists for a type, it is left untouched.
 *
 * The document text is ported verbatim from website/src/pages/{privacy,
 * terms,cookies,ai-disclosure}.astro as of 2026-09-01. It is a reviewed
 * engineering draft, not attorney-reviewed — the "not yet reviewed by a
 * licensed attorney" notice is part of the content on purpose and must
 * travel with it wherever it surfaces. The Terms "Governing law" section is
 * an intentional unfilled placeholder. The AI Disclosure's honest
 * statements about the ungated customer assistant and unredacted admin
 * transcript access are load-bearing — do not soften them.
 */

const CONFIRM_TOKEN = "--confirm-seed-local";

const localTestUrl = process.env.CHAKUSA_LOCAL_TEST_DATABASE_URL;
const confirmation = process.argv[2];

if (confirmation !== CONFIRM_TOKEN) {
  console.error(`Usage: npx tsx scripts/seed-legal-documents.ts ${CONFIRM_TOKEN}`);
  console.error("(and CHAKUSA_LOCAL_TEST_DATABASE_URL must point at the local chakusa_test database)");
  process.exit(1);
}
if (!localTestUrl) {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL must be supplied by the process environment");
  process.exit(1);
}

let target: URL;
try {
  target = new URL(localTestUrl);
} catch {
  console.error("Refusing to run: CHAKUSA_LOCAL_TEST_DATABASE_URL is not a valid URL");
  process.exit(1);
}
const database = target.pathname.replace(/^\//, "").split("/")[0];
if (
  !(
    ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
    database === "chakusa_test"
  )
) {
  console.error("Refusing to run: target must be the local chakusa_test PostgreSQL database");
  process.exit(1);
}

const DRAFT_NOTICE =
  "Draft dated 2026-09-01. Not yet reviewed by a licensed attorney. Do not publish as final or rely on this to establish legal compliance.";

interface LegalDocSeed {
  type: LegalDocumentType;
  title: string;
  summary: string;
  content: string;
}

const PRIVACY_POLICY = `${DRAFT_NOTICE}

## Who this covers
Chakusa has two kinds of accounts: **business accounts** (business owners running their CRM, marketplace listing, bookings, and loyalty program) and **customer accounts** (people who discover, book, and message businesses through Chakusa). One person can hold both. This policy covers both, and this website.

## Information we collect

### From business accounts
Name, email, and business details when you sign up. If you sign in with Google or Apple, the basic profile information those providers share. If you use the CRM to track your own customers, the customer names, phone numbers, notes, message content, and review/feedback records you enter, that data is yours, not ours; you're responsible for having the right to collect and store it.

### From customer accounts
Name, email, phone (optional), and a profile used across every business you interact with through Chakusa: booking history, loyalty points and redemptions, marketplace searches and favorites, reviews you leave, and messages and AI assistant conversations you send. Marketplace search recognizes your approximate location if you allow it, to show nearby businesses.

### Bookings and payments
Appointment details (service, time, price, staff assigned), and payment records for deposits or balances paid through Chakusa (amount, status, refunds). Card details are handled entirely by **Stripe**; we never see or store them. A business's own cancellation, rescheduling, and no-show policies are set by that business, not by Chakusa.

### Loyalty, memberships, and referrals
Points balances and history, redemption codes, membership plan details, and, if you refer someone, the referral code and the email address of the person you're referring (collected before they've signed up, so we can credit the referral once they do).

### Messages and AI conversations
Content of messages sent through Chakusa (SMS/WhatsApp via Twilio), and, if you use an AI-powered feature, the content of that conversation. See the AI Disclosure for the specifics of what happens to that data.

### Technical information
Device push-notification tokens, and error/diagnostic data when something breaks. This website itself sets no tracking or advertising cookies, see the Cookie Policy.

## How we use it
To run the product: showing your leads, bookings, loyalty balances, and marketplace listings; sending messages you ask us to send or that automation sends on your behalf; generating AI responses where that feature is used; and sending push notifications about activity in your account. We don't sell data, and we don't use it to serve ads.

## AI features
Chakusa includes AI-powered features: a business-facing assistant that can draft or send replies to a business's customers (a business must turn this on), and an in-app assistant customers can chat with directly. Both send conversation content to a third-party AI provider (OpenAI or Anthropic, depending on configuration) to generate a response. Full detail, including an important gap in how the customer-facing assistant currently works, its data retention behavior, and who inside Chakusa can view a conversation, is in the dedicated AI Disclosure, which is part of this Privacy Policy by reference.

## Text messages
Message delivery runs through Twilio. Standard message and data rates may apply depending on the recipient's carrier. **The business is responsible for having consent** to message their customer, under whatever law applies where that customer lives (in the US, generally the TCPA; in Canada, CASL; other countries have their own rules). If a customer replies STOP, Chakusa automatically registers that as an opt-out, and our automated messaging checks this before sending anything further. A business sending manually or through a channel outside Chakusa's own automation is still responsible for honoring that opt-out itself.

## Who we share it with
We don't sell data to anyone. The services below process data on our behalf, only for the purpose of running Chakusa:
- **Twilio**, sends SMS/WhatsApp messages
- **Stripe**, processes booking payments and refunds; also handles payouts to businesses (Stripe Connect)
- **OpenAI** and/or **Anthropic**, generate AI responses when an AI feature is used
- **Expo**, delivers push notifications
- **Sentry**, receives error/crash reports from our backend, configured to scrub authentication tokens and other sensitive fields before anything is sent
- **Google** and **Apple**, handle Sign-In if you use those options, and handle subscription billing for a business's own Chakusa plan (we never see card details there either)
- Our infrastructure and database providers, who host the servers Chakusa runs on

Because these providers operate infrastructure in multiple countries, data may be processed outside the country you're in, including the United States (both AI providers' standard endpoints are US-based unless a data-residency-specific configuration is set up in the future). Each provider is responsible for its own compliance with applicable data-transfer rules.

## Automated decisions
When an AI feature is enabled, Chakusa's system automatically decides whether to send an AI-generated reply, hold it for a human to approve, or escalate the conversation to a person, based on confidence and safety rules (see AI Disclosure). A person can always take over. We don't use automated decisions for anything with a legal or similarly significant effect on you (for example, we don't use AI to approve or deny a booking, a refund, or account access).

## How long we keep it
Account, booking, loyalty, and message data is kept for as long as the account is active, plus a reasonable period afterward, unless deletion is requested sooner or the law requires longer retention. AI conversation content is currently kept indefinitely rather than on a fixed schedule, see AI Disclosure for the specifics and the retention improvement this points to.

## Your rights
Depending on where you are, you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain uses of it, for example under the EU/UK **GDPR**, the California **CCPA/CPRA**, the **UAE PDPL**, or South Africa's **POPIA**. You can exercise these rights by contacting us below; we'll respond within the time required by applicable law. As Chakusa expands to more countries, this section will be updated to name the specific local law that applies.

Reference: European Commission on data protection (GDPR) — https://commission.europa.eu/law/law-topic/data-protection_en · California Attorney General on the CCPA — https://oag.ca.gov/privacy/ccpa

## Children's privacy
Chakusa is not directed at children, and we don't knowingly collect personal data from anyone under 16.

## Security
Passwords are hashed, never stored in plain text. Sessions are rotated and scoped separately for business accounts, customer accounts, and internal admin access. Any linked sign-in credentials are encrypted at rest. Internal access to production data is limited to what's needed to operate the service, and administrative actions are logged.

## Complaints
If you're not satisfied with how we've handled a request, you can contact us below, or, depending on where you live, lodge a complaint with your local data protection authority.

## Changes to this policy
If we make a material change to how we handle data, we'll update this page and the date at the top.

## Contact
To exercise a data right or ask a question about this policy: privacy@chakusarecovery.com.`;

const TERMS_OF_SERVICE = `${DRAFT_NOTICE}

## Agreement
By creating a Chakusa account, business or customer, you agree to these terms. If you're creating a business account on behalf of a business, you're confirming you have the authority to bind that business to them. You must be of legal age to enter into a contract in your jurisdiction.

## Two kinds of accounts
Chakusa serves two roles, which can be held by the same person:
- A **business account** uses the CRM, and optionally lists on the marketplace, takes bookings, and runs a loyalty program.
- A **customer account** discovers businesses, books appointments, earns and redeems loyalty rewards, leaves reviews, and messages businesses, including through AI-powered features.

## Business terms
If you use Chakusa to send messages to your own customers, **you are solely responsible for having their consent** to be contacted, under whatever law governs that communication where they live. If you list your business on the marketplace, you're responsible for the accuracy of your listing, pricing, and availability. If you accept bookings, you're responsible for setting and honoring your own cancellation, rescheduling, and no-show policies, Chakusa provides the tool, not the policy. If a customer asks to stop receiving messages, you must honor that; Chakusa's own automation already checks for a STOP reply, see the Privacy Policy.

## Customer terms
You're responsible for the accuracy of the information in your customer profile, for the conduct of your bookings (showing up, cancelling with reasonable notice), and for the content of any review you leave, reviews must be honest and based on a real interaction. You may not use a customer account to harass a business, post fake reviews, or attempt to access another person's account or another business's data.

## Marketplace
The marketplace helps customers discover businesses; Chakusa is not a party to the service a business actually provides. We don't guarantee the accuracy of a listing, the quality of a business's work, or the outcome of any booking. Businesses and customers can report listings or reviews that violate these terms; we may remove content or suspend an account that does.

## Bookings and payments
Where a business accepts deposits or payments through Chakusa, those payments are processed by Stripe. Chakusa facilitates the transaction; the business is the one providing the service and is responsible for refunds according to its own stated policy, subject to Stripe's own dispute and chargeback processes. We are not liable for a business's failure to perform a booked service, or for a customer's failure to show up.

## Messaging and AI features
Some Chakusa features use AI to draft or send responses. AI-generated content can be inaccurate, and you should not rely on it for anything requiring professional, medical, legal, or financial advice. A business can review or take over an AI-drafted message before it sends, depending on configuration; a customer can always ask to speak with a person. Full detail on how this works is in the AI Disclosure, which is part of these terms by reference.

## Loyalty, memberships, and rewards
Loyalty points and rewards have no cash value and cannot be exchanged for cash. A business sets and can change its own loyalty program, including point values, reward availability, and expiry, at its discretion, subject to honoring points already earned in good faith. We may suspend a loyalty account showing signs of fraud or abuse (for example, fake referrals).

## Subscriptions
A business's own Chakusa plan (Free, Pro, or Business) is billed as an auto-renewing subscription through the Apple App Store or Google Play. Pricing, billing, and cancellation are handled by whichever store the business subscribed through. Business-tier pricing is not yet finalized.

## Acceptable use
Don't use Chakusa to:
- send unsolicited, unlawful, or fraudulent messages
- post fake reviews, fake listings, or otherwise misrepresent a business or service
- harass, threaten, or spam another user
- store or message personal data you don't have the right to store or message
- attempt to access another account, another business's data, or reverse-engineer the service
- use a loyalty, referral, or booking feature fraudulently

We can suspend or terminate an account that violates this, with or without notice depending on severity, and may permanently ban an account for repeated or severe violations.

## Ownership
The customer, lead, booking, and message data in your account is yours. Chakusa's software, branding, and the way the product is built are ours. Using Chakusa doesn't give you ownership over the app itself. Reviews and other content you post remain yours, but you grant Chakusa a license to display them as part of the service.

## No warranty
Chakusa is provided "as is." We work to keep it reliable, but we don't guarantee it will be uninterrupted, error-free, or fit for a particular purpose beyond what's described on this site.

## Limitation of liability
To the extent allowed by law, Chakusa isn't liable for indirect, incidental, or consequential damages arising from your use of the app, including messages sent, AI-generated content, bookings made or missed, or decisions made based on data in the app. This doesn't limit liability where the law doesn't allow it to be limited.

## Indemnification
You agree to cover any claim, cost, or damage arising from your misuse of Chakusa, including messaging someone without proper consent, storing data you didn't have the right to store, or misrepresenting a business or booking.

## Termination
You can stop using Chakusa and delete your account at any time. We can suspend or terminate access for violating these terms.

## Governing law
Placeholder: the governing law and jurisdiction for disputes has not been set yet, pending confirmation of where Chakusa is legally incorporated. This must be filled in correctly, not guessed, before this page is final.

## Changes
We'll update these terms as the product changes. Material changes will be reflected on this page and the date at the top.

## Questions
Reach out. See the About page.`;

const COOKIE_POLICY = `${DRAFT_NOTICE}

## The short version
This website (chakusarecovery.com) does not use tracking cookies, advertising cookies, or analytics cookies. There's no third-party tracking script on this site at all, so there's nothing to opt out of here.

## What this site does use
Nothing beyond what your browser needs to render the page. No cookies are set to remember you between visits, run analytics, or serve ads.

## The mobile app is different
The Chakusa mobile app doesn't use browser cookies at all, apps don't work that way, but it does store some information securely on your device (like your login session) to keep you signed in. That's covered in the Privacy Policy, not here.

## If that changes
If we ever add analytics or a similar tool to this website, we'll update this page to say exactly what it does, before it goes live, not after.

## Questions
Reach out. See the About page.`;

const AI_DISCLOSURE = `${DRAFT_NOTICE}

# How Chakusa uses AI

## Where AI shows up
Two places. First, a business can turn on an AI assistant that drafts or sends replies to that business's own customers over SMS or WhatsApp. Second, customers can chat directly with an in-app AI assistant inside the Chakusa app.

## How it works
When either feature is used, the relevant conversation, along with some context (like the customer's name, notes on file, and recent appointments, for the business-facing assistant) is sent to a third-party AI provider, either **OpenAI** or **Anthropic** depending on how the system is configured, to generate a response.

## What it can do
- Answer routine questions from a business's customers
- Draft, and in some cases send, a reply on a business's behalf
- Answer a customer's questions inside the app

## What it cannot do
- Guarantee its answers are accurate
- Replace professional, medical, legal, or financial advice
- Make a booking, payment, or account change on its own outside what a business has explicitly configured it to do
- Act without limits, every response is checked against automated rules before it's sent (see below)

## Automated safety checks
Before a response is generated or sent, an automated system checks for things like attempts to manipulate the AI's instructions, content that looks like it's leaking sensitive information, and language patterns associated with unsafe or inappropriate advice. These are rule-based pattern checks, not a human reviewing every message, and not a second AI judging the first one's safety. A message can also be automatically held for a human to approve, or escalated to a person entirely, based on confidence and configurable business rules (for example: quiet hours, blocked topics, or a customer who has opted out of contact). A business, or a customer asking to speak with a person, can always take over from the AI.

There's also a platform-wide switch that can immediately turn AI features off across all of Chakusa if needed.

## Consent, honestly stated
The business-facing assistant is opt-in, a business must turn it on before it acts on their behalf. **The in-app customer assistant currently is not gated by a separate opt-in**, it's available to any customer by default. We consider this a gap worth closing with a clearer first-use notice, and it's tracked as a product improvement, not something we're pretending is already resolved.

## Who can see a conversation
The business whose customer is messaging (for the business-facing assistant) can see that conversation, the same as any other message in their account. For the in-app customer assistant, Chakusa staff with admin access can view the full conversation content for support and safety purposes; as of this disclosure, that view is not redacted. Every admin view is intended to be logged.

## How long it's kept
AI conversation content is currently kept indefinitely rather than deleted on a fixed schedule. Some system-generated "memory" used to personalize responses is deleted automatically after it expires; not all of it currently has an expiry set. A customer can turn off personalization and conversation memory in their app settings.

## Providers
OpenAI and Anthropic. Neither is instructed to use your conversations to train their own models beyond what their own standard API terms provide; we haven't independently audited that claim beyond relying on those providers' published terms.

## Changes to this disclosure
If how our AI features work changes materially, especially around consent or data handling, we'll update this page and the date at the top.

## Questions
Reach out. See the About page.`;

const DOCUMENTS: LegalDocSeed[] = [
  {
    type: "PRIVACY_POLICY",
    title: "Privacy Policy",
    summary:
      "How Chakusa collects, uses, shares, and protects data across the CRM, marketplace, bookings, loyalty, and AI features, plus your rights under GDPR, CCPA, and other privacy laws.",
    content: PRIVACY_POLICY,
  },
  {
    type: "TERMS_OF_SERVICE",
    title: "Terms of Service",
    summary:
      "The terms for using Chakusa as a business or a customer, covering the marketplace, bookings and payments, loyalty, AI features, acceptable use, liability, and termination.",
    content: TERMS_OF_SERVICE,
  },
  {
    type: "COOKIE_POLICY",
    title: "Cookie Policy",
    summary:
      "The chakusarecovery.com website sets no tracking, advertising, or analytics cookies; the mobile app stores only what it needs on your device to keep you signed in.",
    content: COOKIE_POLICY,
  },
  {
    type: "AI_DISCLOSURE",
    title: "AI Disclosure",
    summary:
      "How Chakusa's AI features work, what they can and cannot do, which providers process your data, the current lack of a customer-assistant consent gate, and who inside Chakusa can view an AI conversation.",
    content: AI_DISCLOSURE,
  },
];

const prisma = new PrismaClient({ datasources: { db: { url: localTestUrl } } });

async function main() {
  console.log(`[seed-legal-documents] target: ${target.hostname}/${database}`);
  const now = new Date();
  for (const doc of DOCUMENTS) {
    const existing = await prisma.legalDocumentVersion.findFirst({
      where: { type: doc.type },
      orderBy: { version: "desc" },
      select: { version: true, status: true },
    });
    if (existing) {
      console.log(`  skip  ${doc.type}: already has v${existing.version} (${existing.status})`);
      continue;
    }
    const created = await prisma.legalDocumentVersion.create({
      data: {
        type: doc.type,
        version: 1,
        status: "PUBLISHED",
        title: doc.title,
        content: doc.content,
        summary: doc.summary,
        effectiveAt: now,
        publishedAt: now,
      },
      select: { id: true, type: true, version: true },
    });
    console.log(`  publish ${created.type}: v${created.version} (${created.id})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
