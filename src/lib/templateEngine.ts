export interface TemplateVariables {
  customer_name?: string;
  business_name?: string;
  service_name?: string;
  booking_time?: string;
  review_link?: string;
  phone_number?: string;
}

/**
 * How a customer is greeted. A customer created from a missed call or an
 * import often has only a phone number (or nothing) as their name — that is
 * not something to greet anyone with, so it becomes "there" ("Hi there").
 */
export function greetingName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return /\p{L}/u.test(trimmed) ? trimmed : "there";
}

/**
 * Templates already say "your {{service_name}}", so a service value that
 * itself starts with "your " (the old generic fallback) would read
 * "your your service".
 */
function serviceName(value: string): string {
  return value.replace(/^\s*your\s+/i, "");
}

export function renderTemplate(body: string, variables: TemplateVariables): string {
  const values: Record<string, string | undefined> = {
    ...variables,
    ...(variables.customer_name !== undefined ? { customer_name: greetingName(variables.customer_name) } : {}),
    ...(variables.service_name !== undefined ? { service_name: serviceName(variables.service_name) } : {}),
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}
