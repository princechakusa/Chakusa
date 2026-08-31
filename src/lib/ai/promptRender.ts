import { createHash } from "node:crypto";
import { ApiError } from "../errors.js";

export type PromptVariableType = "string" | "number" | "boolean" | "json";
export const PROMPT_VARIABLE_TYPES: PromptVariableType[] = ["string", "number", "boolean", "json"];

export interface DeclaredVariable {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string | null;
}

export interface RenderInput {
  body: string;
  systemPrompt?: string | null;
  variables: DeclaredVariable[];
  values: Record<string, unknown>;
}

export interface RenderResult {
  prompt: string;
  systemPrompt: string | null;
  checksum: string;
  referencedVariables: string[];
}

// {{ name }} / {{name}} — dotted names allowed so a caller can namespace
// (e.g. {{customer.name}}); no filters, no logic, no partials by design.
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Content hash of a prompt body (+ optional system prompt). Used both as the
 * immutable integrity checksum stored on a PromptVersion at creation and as
 * the record of exactly what text was sent to a model (AIInvocationLedger).
 */
export function promptChecksum(body: string, systemPrompt?: string | null): string {
  return createHash("sha256").update(`${systemPrompt ?? ""}\n---\n${body}`).digest("hex");
}

function stringifyValue(name: string, type: string, raw: unknown): string {
  switch (type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw ApiError.badRequest(`Prompt variable "${name}" must be a number`);
      return String(n);
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw ? "true" : "false";
      if (raw === "true" || raw === "false") return raw;
      throw ApiError.badRequest(`Prompt variable "${name}" must be a boolean`);
    }
    case "json": {
      try {
        return typeof raw === "string" ? JSON.stringify(JSON.parse(raw)) : JSON.stringify(raw);
      } catch {
        throw ApiError.badRequest(`Prompt variable "${name}" must be valid JSON`);
      }
    }
    default: {
      if (typeof raw === "string") return raw;
      if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
      throw ApiError.badRequest(`Prompt variable "${name}" must be a string`);
    }
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Substitutes declared variables into a prompt body deterministically.
 * Rejects unknown supplied values, references to undeclared variables, and
 * missing required variables that have no default. The returned checksum
 * covers the fully rendered text.
 */
export function renderPrompt(input: RenderInput): RenderResult {
  const declared = new Map(input.variables.map((v) => [v.name, v]));

  for (const key of Object.keys(input.values)) {
    if (!declared.has(key)) throw ApiError.badRequest(`Unknown prompt variable: ${key}`);
  }

  for (const decl of input.variables) {
    if (decl.required && isBlank(input.values[decl.name]) && isBlank(decl.defaultValue)) {
      throw ApiError.badRequest(`Missing required prompt variable: ${decl.name}`);
    }
  }

  const referenced = new Set<string>();
  const substitute = (text: string): string =>
    text.replace(PLACEHOLDER, (_match, name: string) => {
      const decl = declared.get(name);
      if (!decl) throw ApiError.badRequest(`Prompt references undeclared variable: ${name}`);
      referenced.add(name);
      const raw = isBlank(input.values[name]) ? decl.defaultValue ?? "" : input.values[name];
      if (isBlank(raw)) return "";
      return stringifyValue(name, decl.type, raw);
    });

  const prompt = substitute(input.body);
  const systemPrompt = input.systemPrompt ? substitute(input.systemPrompt) : null;
  return { prompt, systemPrompt, checksum: promptChecksum(prompt, systemPrompt), referencedVariables: [...referenced] };
}
