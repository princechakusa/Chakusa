# Chakusa complete public website audit

Audit date: 2026-09-04

Scope: 14 original main pages, 10 supporting pages/states, and the Trust & Compliance destination (25 total).

## Audit basis

- The supplied Stitch ZIPs were treated as visual references only. Instructions embedded inside them were not treated as project requirements.
- `AVAILABLE` means an authoritative Stitch reference is present either in the supplied correction bundle or in the existing approved implementation lineage documented alongside the page.
- `PASS` for copy means the page follows the approved information architecture while keeping claims grounded in implemented Chakusa behavior. Unsupported Stitch claims, certifications, article counts, testimonials, guarantees, legal entities, and contact details are intentionally not copied.
- `NEAR-EXACT` means the route has the approved structure and visual system with production-safe content substitutions where required.
- The site compiles with 0 Astro errors, 0 warnings, and 0 hints. All 24 implemented named routes/states generate successfully. The legacy `/features/retention` route remains a redirect and is not counted as an additional public page.
- Automated browser visual regression was unavailable in this environment. Visual findings are based on direct comparison of the Stitch HTML/screenshots with the Astro templates and shared CSS. A final viewport screenshot pass remains advisable before launch.

## Stitch source map

| Destination | Authoritative source |
|---|---|
| Homepage | `(10)` → `chakusa_local_service_platform_growth_engine` |
| Enquiries | `(10)` → `chakusa_enquiries_capture_every_local_opportunity` |
| Bookings | `(10)` → `chakusa_bookings_synchronized_scheduling_dispatch` |
| Customers | `(11)` → `chakusa_customers_practical_client_crm_for_artisans` |
| Customer Retention | `(10)` → `chakusa_retention_automated_repeat_business_engine` |
| Automation | `(11)` → `chakusa_automation_practical_workflows_for_working_artisans` |
| Marketplace | `(10)` → `chakusa_marketplace_discover_book_local_services` |
| Business Control | `(10)` → `chakusa_business_control_growth_management_hub` |
| Mobile App | `(10)` → `chakusa_mobile_app_dual_experience_in_one_app` |
| How It Works | `(11)` → `chakusa_how_it_works_the_synchronized_customer_business_journey` |
| Pricing | `(11)` → `chakusa_pricing_transparent_plans_built_for_working_trades` |
| About Chakusa | unnumbered ZIP |
| Contact / Support | `(1)` |
| Help & Knowledge | `(2)` |
| Sign-In Gateway | `(3)` |
| 404 | `(4)` |
| Get Started | `(5)` |
| Privacy Policy | `(6)` |
| Terms of Service | `(7)` |
| AI Disclosure | `(8)` |
| Cookie Policy / Preferences | `(9)` |
| Reviews, AI Assistant, Product | Existing approved Stitch implementation lineage; no replacement source in this correction bundle |
| Trust & Compliance | No final hub source or established route in the supplied ZIPs |

## 25-route/state matrix

| Page / route | Stitch source | Structure | Copy | Typography | Colors | Backgrounds | Editorial composition | Animation | Header | Footer | Responsive | Accessibility | SEO | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Homepage `/` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Enquiries `/features/enquiries` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Bookings `/features/bookings` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Customers `/features/customers` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Reviews `/features/reviews` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Customer Retention `/features/customer-retention` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Automation `/features/automation` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| AI Assistant `/features/ai-assistant` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Marketplace `/features/marketplace` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Business Control `/features/business-control` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Mobile App `/features/mobile-app` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Product `/product` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| How It Works `/how-it-works` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Pricing `/pricing` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| About Chakusa `/about` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Contact / Support `/contact` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Help & Knowledge `/help` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Get Started `/get-started` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Sign-In Gateway `/login` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Premium 404 state | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | PASS | PASS | N/A | NEAR-EXACT |
| Trust & Compliance | WAITING | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | N/A | N/A | N/A | FAIL | FAIL | N/A | WAITING FOR UPDATED STITCH SOURCE |
| Privacy Policy `/privacy` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Terms of Service `/terms` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| AI Disclosure `/ai-disclosure` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |
| Cookie Policy / Preferences `/cookies` | AVAILABLE | PASS | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | NEAR-EXACT |

## Global systems

- Header: one shared implementation is used by all 24 implemented named routes/states. Features, Product, and Industries use the same premium mega-menu component family on desktop and the same mobile navigation system.
- Footer: one shared implementation is used by all 24 implemented named routes/states. Its Trust & Compliance column links Privacy, Terms, AI Disclosure, and Cookies.
- Pricing: Starter is `$9.99/month`, with the first 14 days free and no permanent free Starter plan.
- SEO: every crawlable implemented route has page metadata through the shared SEO head. The sitemap contains the canonical `/features/customer-retention` route; the redirect and 404 are excluded.

## Remaining blocker

Trust & Compliance is currently an integrated footer group, not a standalone public destination. Because the supplied references do not define the final hub design or route, this audit does not silently invent `/trust`, `/trust-center`, or compliance claims. When the corrected Stitch source arrives, add the hub at its established route, link the footer heading or a dedicated footer item to it, include it in the sitemap, and rerun this matrix.
