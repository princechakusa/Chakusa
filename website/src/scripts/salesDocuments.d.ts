export const MAX_BODY_BYTES: number;
export const MAX_LINES: number;

export interface LineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  taxable?: boolean;
  serviceOfferingId?: string | null;
}

export interface DocumentFields {
  documentType?: string;
  customerId?: string;
  taxRatePercent?: string;
  notes?: string;
  terms?: string;
  expiresAt?: string;
  issueDate?: string;
  dueDate?: string;
  lines: LineInput[];
}

export interface DocumentOrigins {
  customerId?: string | null;
  customerProfileId?: string | null;
  appointmentId?: string | null;
  leadId?: string | null;
}

export function isUuid(value: unknown): value is string;
export function safeHttpsUrl(value: unknown): string | null;
export function validateDocumentForm(kind: "quote" | "invoice", fields: DocumentFields): string | null;
export function buildDocumentPayload(kind: "quote" | "invoice", operation: "create" | "update", fields: DocumentFields, expectedCurrentRevisionId?: string, origins?: DocumentOrigins): Record<string, unknown>;
export function deriveTaxRatePercent(revision: unknown): string;
