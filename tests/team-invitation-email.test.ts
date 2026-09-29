import { describe, expect, it } from "vitest";
import { renderTeamInvitationEmail } from "../src/modules/team/teamInvitationEmail.js";
import { escapeHtml, singleLine } from "../src/lib/html.js";

describe("team invitation email never carries account-holder markup", () => {
  it("escapes the business and inviter names in the HTML body", () => {
    const { html } = renderTeamInvitationEmail('<a href="https://evil.example">Click</a>', "<img src=x onerror=alert(1)>", "https://chakusarecovery.com/team-invite/abc");
    expect(html).not.toContain("<a href=\"https://evil.example\"");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;");
    expect(html).toContain('<a href="https://chakusarecovery.com/team-invite/abc">Accept invitation</a>');
  });

  it("flattens the subject to one bounded line", () => {
    const { subject } = renderTeamInvitationEmail("Shop\r\nBcc: victim@example.com", "Sam", "https://x/y");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual(200);
  });

  it("escape helpers cover every HTML-significant character", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(singleLine("a\u0000b\nc")).toBe("a b c");
  });
});
