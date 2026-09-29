export interface ServiceFields {
  name: string; description?: string; category?: string;
  durationMinutes: string; preparationMinutes?: string; cleanupMinutes?: string;
  price?: string; depositAmount?: string; sortOrder?: string;
  active?: boolean; publiclyBookable?: boolean; memberIds?: string[];
}
export function validateServiceForm(fields: ServiceFields): string | null;
export function buildServicePayload(fields: ServiceFields): Record<string, unknown>;
