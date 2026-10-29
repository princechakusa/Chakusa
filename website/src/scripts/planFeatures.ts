// Pricing page: what each plan includes, straight from the API's enforcing
// entitlement tables (GET /plans), so the page can never promise a limit the
// server doesn't enforce. The static lists in data/pricing.ts are the fallback
// if the API is unreachable.
const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? "https://chakusa-api.onrender.com";

interface PlanDescription { plan: string; limits: Record<string, number | null>; features: Array<{ key: string; label: string }> }

const LIMIT_LINES: Array<[string, (n: number) => string, string]> = [
  ["leadsPerMonth", (n) => `Up to ${n.toLocaleString("en-US")} leads a month`, "Unlimited leads"],
  ["reviewRequestsPerMonth", (n) => `Up to ${n.toLocaleString("en-US")} review requests a month`, "Unlimited review requests"],
  ["customers", (n) => `Up to ${n.toLocaleString("en-US")} customers`, "Unlimited customers"],
  ["openReminders", (n) => `Up to ${n.toLocaleString("en-US")} open reminders`, "Unlimited reminders"],
  ["customTemplatesPerType", (n) => `${n} custom message template${n === 1 ? "" : "s"} per type`, "Unlimited custom message templates"],
];

function lines(plan: PlanDescription): string[] {
  const out = LIMIT_LINES.map(([key, limited, unlimited]) => { const value = plan.limits[key]; return value == null ? unlimited : limited(value); });
  const seats = plan.limits.staffSeats;
  out.push(seats == null ? "Unlimited team seats" : seats === 1 ? "1 team seat" : `Up to ${seats} team members with roles and invitations`);
  for (const feature of plan.features) if (feature.key !== "UNLIMITED_TEMPLATES" && feature.key !== "TEAM_MANAGEMENT") out.push(feature.label);
  return out;
}

/** Fill the comparison table: numbers for limits, Yes/No for features. */
function fillTable(plans: PlanDescription[]) {
  document.querySelectorAll<HTMLElement>("td[data-plan]").forEach((cell) => {
    const plan = plans.find((item) => item.plan === cell.dataset.plan);
    if (!plan) return;
    const limit = cell.dataset.limit;
    const feature = cell.dataset.feature;
    if (limit && limit in plan.limits) {
      const value = plan.limits[limit];
      cell.textContent = value == null ? "Unlimited" : value.toLocaleString("en-US");
    } else if (feature) {
      cell.textContent = plan.features.some((item) => item.key === feature) ? "Yes" : "No";
    }
  });
}

async function load() {
  const lists = document.querySelectorAll<HTMLUListElement>("[data-plan-features]");
  if (!lists.length && !document.querySelector("td[data-plan]")) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${API_URL}/plans`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return;
    const { plans } = (await response.json()) as { plans?: PlanDescription[] };
    if (!Array.isArray(plans)) return;
    fillTable(plans);
    lists.forEach((list) => {
      const plan = plans.find((item) => item.plan === list.dataset.planFeatures);
      if (!plan) return;
      const template = list.querySelector("li");
      const check = template?.querySelector(".pr-plan__check")?.cloneNode(true);
      const items = lines(plan).map((text) => { const li = document.createElement("li"); if (check) li.append(check.cloneNode(true)); li.append(text); return li; });
      if (items.length) list.replaceChildren(...items);
    });
  } catch { /* offline: static fallback stays */ }
}

void load();
