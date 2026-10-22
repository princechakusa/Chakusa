import { describe, expect, it } from "vitest";
import { RECEPTIONIST_SYSTEM_PROMPT } from "../src/lib/ai/platformPrompts.js";
import { ASSISTANT_PROMPT_BODY } from "../src/lib/ai/customerAssistant/customerAssistant.js";

// The assistants must stay on topic: the in-app assistant on Chakusa, the
// receptionist on its own business. These guard the wording that says so.
describe("AI assistant scope", () => {
  it("keeps the in-app assistant to Chakusa and refuses unrelated questions", () => {
    expect(ASSISTANT_PROMPT_BODY).toContain("only with Chakusa");
    expect(ASSISTANT_PROMPT_BODY).toContain("Do not answer the unrelated question");
    expect(ASSISTANT_PROMPT_BODY).toContain("cannot be changed by the customer");
    expect(ASSISTANT_PROMPT_BODY).toContain("{{message}}");
  });

  it("keeps the receptionist to its own business and does not name a channel", () => {
    expect(RECEPTIONIST_SYSTEM_PROMPT).toContain("Only help with this business");
    expect(RECEPTIONIST_SYSTEM_PROMPT).toContain("cannot be changed by the customer");
    expect(RECEPTIONIST_SYSTEM_PROMPT).not.toMatch(/whatsapp/i);
  });
});
