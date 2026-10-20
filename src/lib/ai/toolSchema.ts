import { z } from "zod";

/**
 * A tool's parameters as plain JSON Schema in the subset every provider
 * accepts (Gemini's function-declaration schema is the strictest: object /
 * string / number / integer / boolean / array / enum, `required`, no
 * `additionalProperties`, `$schema`, `default` or union types). Built from the
 * tool's Zod schema so the model is told exactly which arguments exist; the
 * Zod schema still validates whatever the model sends back.
 */
export interface ToolParameterSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
}

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  let current = schema;
  let optional = false;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) { optional = true; current = current.unwrap(); continue; }
    if (current instanceof z.ZodDefault) { optional = true; current = current._def.innerType; continue; }
    if (current instanceof z.ZodEffects) { current = current.innerType(); continue; }
    return { inner: current, optional };
  }
}

function describeString(schema: z.ZodString): string | undefined {
  const notes: string[] = [];
  for (const check of schema._def.checks) {
    if (check.kind === "uuid") notes.push("UUID");
    else if (check.kind === "datetime") notes.push("ISO 8601 date-time with timezone offset, e.g. 2026-10-24T10:00:00+02:00");
    else if (check.kind === "email") notes.push("email address");
    else if (check.kind === "url") notes.push("URL");
  }
  return notes.length ? notes.join("; ") : undefined;
}

export function toToolParameterSchema(schema: z.ZodTypeAny): ToolParameterSchema {
  const { inner } = unwrap(schema);
  const description = inner.description;
  const withDescription = (out: ToolParameterSchema, extra?: string): ToolParameterSchema => {
    const text = [description, extra].filter(Boolean).join(". ");
    return text ? { ...out, description: text } : out;
  };

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, ToolParameterSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = toToolParameterSchema(value);
      if (!unwrap(value).optional) required.push(key);
    }
    return withDescription({ type: "object", properties, ...(required.length ? { required } : {}) });
  }
  if (inner instanceof z.ZodString) return withDescription({ type: "string" }, describeString(inner));
  if (inner instanceof z.ZodNumber) return withDescription({ type: inner.isInt ? "integer" : "number" });
  if (inner instanceof z.ZodBoolean) return withDescription({ type: "boolean" });
  if (inner instanceof z.ZodEnum) return withDescription({ type: "string", enum: [...inner.options] as string[] });
  if (inner instanceof z.ZodLiteral && typeof inner.value === "string") return withDescription({ type: "string", enum: [inner.value] });
  if (inner instanceof z.ZodArray) return withDescription({ type: "array", items: toToolParameterSchema(inner.element) });
  // Anything else (records, unions, any) is described loosely as a string.
  return withDescription({ type: "string" });
}

/** True when a parameters schema declares no arguments at all. */
export function hasNoParameters(schema: object | undefined): boolean {
  if (!schema) return true;
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  return (schema as { type?: string }).type === "object" && (!properties || Object.keys(properties).length === 0);
}
