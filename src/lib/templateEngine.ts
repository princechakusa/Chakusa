export interface TemplateVariables {
  customer_name?: string;
  business_name?: string;
  service_name?: string;
  booking_time?: string;
  review_link?: string;
  phone_number?: string;
}

export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = (variables as Record<string, string | undefined>)[key];
    return value ?? match;
  });
}
