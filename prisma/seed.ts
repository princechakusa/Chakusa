import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Kept in sync with src/lib/ai/promptRender.ts (promptChecksum) and
// src/lib/ai/fakeAIProvider.ts — this seed file must stay self-contained
// because tsconfig's rootDir is src/ and it cannot import from there.
const FAKE_AI_PROVIDER_ID = "chakusa-fake";
const FAKE_AI_MODEL = "chakusa-fake-1";
function promptChecksum(body: string, systemPrompt?: string | null): string {
  return createHash("sha256").update(`${systemPrompt ?? ""}\n---\n${body}`).digest("hex");
}

interface SeedVariable { name: string; type?: string; required?: boolean; defaultValue?: string | null; description?: string }
interface SeedTemplate {
  key: string;
  name: string;
  task: "classification" | "conversation" | "scheduling" | "extraction";
  requiredCapability: string;
  body: string;
  systemPrompt: string;
  variables: SeedVariable[];
}

const PLATFORM_TEMPLATES: SeedTemplate[] = [
  {
    key: "conversation.orchestrator",
    name: "Conversation Orchestrator",
    task: "conversation",
    requiredCapability: "conversation",
    // Kept in sync with RECEPTIONIST_SYSTEM_PROMPT in src/lib/ai/platformPrompts.ts.
    systemPrompt: [
      "You are the receptionist for the business described in the context, chatting with one of its customers by WhatsApp or text message.",
      "Rules:",
      "- Keep every reply short: one to three sentences, plain text, no markdown or lists.",
      "- Be warm and natural, like a helpful person at the front desk. Ask one question at a time.",
      "- If the customer called and nobody answered, apologise briefly and ask how you can help.",
      "- Use only facts from the context and tool results. Never invent services, prices, availability, addresses or policies.",
      "- To book: work out which service they want (use its id from context.services), ask for their preferred day and time, call check_availability, offer at most three open slots, and call book_appointment only after the customer clearly picks one. Times are in the business timezone; the current time is context.now.",
      "- After booking, confirm the service, day and time in one short message.",
      "- If you cannot help, the customer is unhappy, or they ask for a person, call escalate_to_human.",
      "- Never ask for card, bank or payment details.",
    ].join("\n"),
    body: "Customer's latest message:\n{{message}}\n\nReply to the customer, or call a tool first if you need one.",
    variables: [{ name: "message", description: "The inbound customer message", required: true }],
  },
  {
    key: "intent.classify",
    name: "Intent Classifier",
    task: "classification",
    requiredCapability: "classification",
    systemPrompt: "Classify the customer message into exactly one of: booking, quote, support, review.",
    body: "Message:\n{{message}}\n\nReturn the single best intent label.",
    variables: [{ name: "message", description: "The inbound customer message", required: true }],
  },
  {
    key: "quote.generate",
    name: "Quote Draft",
    task: "extraction",
    requiredCapability: "extraction",
    systemPrompt: "Draft a plain-language quote summary. Use only the services and prices provided.",
    body: "Requested work:\n{{request}}\n\nKnown services:\n{{services}}\n\nDraft a short quote outline.",
    variables: [
      { name: "request", description: "What the customer asked for", required: true },
      { name: "services", description: "JSON list of service/price pairs", type: "json", required: true },
    ],
  },
  {
    key: "booking.confirm",
    name: "Booking Confirmation",
    task: "conversation",
    requiredCapability: "conversation",
    systemPrompt: "Write a warm booking confirmation. Keep it under 60 words.",
    body: "Confirm the booking for {{customerName}} on {{startsAt}} for {{serviceName}}.",
    variables: [
      { name: "customerName", required: true },
      { name: "startsAt", required: true },
      { name: "serviceName", required: true },
    ],
  },
  {
    key: "review.request",
    name: "Review Request",
    task: "conversation",
    requiredCapability: "conversation",
    systemPrompt: "Write a short, sincere request for an online review. One link, no pressure.",
    body: "Ask {{customerName}} to review their recent {{serviceName}} visit. Link: {{reviewUrl}}",
    variables: [
      { name: "customerName", required: true },
      { name: "serviceName", required: true },
      { name: "reviewUrl", required: true },
    ],
  },
];

async function seedFakeModel() {
  await prisma.aIModelRegistry.upsert({
    where: { provider_model_version: { provider: FAKE_AI_PROVIDER_ID, model: FAKE_AI_MODEL, version: "1" } },
    create: {
      provider: FAKE_AI_PROVIDER_ID,
      model: FAKE_AI_MODEL,
      version: "1",
      capabilities: ["conversation", "classification", "scheduling", "extraction"],
      approvedUseCases: ["conversation", "classification", "scheduling", "extraction"],
      status: "ACTIVE",
      healthStatus: "HEALTHY",
    },
    update: { status: "ACTIVE", healthStatus: "HEALTHY" },
  });
}

async function seedPlatformPackage() {
  let pkg = await prisma.promptPackage.findFirst({ where: { scope: "PLATFORM", key: "platform" } });
  pkg ??= await prisma.promptPackage.create({
    data: { key: "platform", name: "Chakusa Platform Prompts", description: "Built-in prompts used by the AI control plane", scope: "PLATFORM", status: "PUBLISHED" },
  });

  let category = await prisma.promptCategory.findFirst({ where: { packageId: pkg.id, key: "core" } });
  category ??= await prisma.promptCategory.create({ data: { packageId: pkg.id, key: "core", name: "Core" } });

  for (const spec of PLATFORM_TEMPLATES) {
    let template = await prisma.promptTemplate.findFirst({ where: { packageId: pkg.id, key: spec.key } });
    template ??= await prisma.promptTemplate.create({
      data: { packageId: pkg.id, categoryId: category.id, key: spec.key, name: spec.name, task: spec.task },
    });
    if (template.currentVersionId) continue;

    const checksum = promptChecksum(spec.body, spec.systemPrompt);
    const version = await prisma.promptVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        status: "PUBLISHED",
        body: spec.body,
        systemPrompt: spec.systemPrompt,
        model: FAKE_AI_MODEL,
        requiredCapability: spec.requiredCapability,
        checksum,
        notes: "Seeded platform baseline",
        publishedAt: new Date(),
        variables: {
          create: spec.variables.map((variable) => ({
            name: variable.name,
            description: variable.description ?? null,
            type: variable.type ?? "string",
            required: variable.required ?? true,
            defaultValue: variable.defaultValue ?? null,
          })),
        },
      },
    });
    await prisma.promptApproval.create({
      data: { versionId: version.id, status: "APPROVED", reason: "Seeded platform baseline", decidedAt: new Date() },
    });
    await prisma.promptDeployment.create({ data: { templateId: template.id, versionId: version.id, environment: "production" } });
    await prisma.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id, status: "PUBLISHED" } });
  }
}

async function main() {
  await seedFakeModel();
  await seedPlatformPackage();
  // eslint-disable-next-line no-console
  console.log("Seed complete: fake AI model + platform prompt package");
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
