import { describe, expect, it } from "vitest";
import { greetingName, renderTemplate } from "../src/lib/templateEngine.js";
import { getDefaultTemplateBody } from "../src/lib/defaultTemplates.js";

describe("template engine", () => {
  it("never greets a customer by phone number", () => {
    expect(greetingName("+971521018367")).toBe("there");
    expect(greetingName("  ")).toBe("there");
    expect(greetingName(null)).toBe("there");
    expect(greetingName("Amina Diallo")).toBe("Amina Diallo");
  });

  it("renders the missed-call default without 'your your' or a phone-number greeting", () => {
    const body = renderTemplate(getDefaultTemplateBody("missed_call"), { customer_name: "+971521018367", business_name: "Kuts", service_name: "your service", phone_number: "+971500000000" });
    expect(body).toBe("Hi there, sorry we missed your call at Kuts! We'd love to help with your service. Give us a call back at +971500000000 or reply here.");
  });

  it("leaves unknown placeholders and real service names alone", () => {
    expect(renderTemplate("{{service_name}} / {{unknown}}", { service_name: "Haircut" })).toBe("Haircut / {{unknown}}");
  });
});
