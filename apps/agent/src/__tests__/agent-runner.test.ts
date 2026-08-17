import { describe, it, expect } from "vitest";
import { selfValidate } from "../agent-runner.js";

describe("selfValidate", () => {
  it("returns empty findings for clean section 1 content", () => {
    const content = `<!--\n  Section Metadata:\n  - Agent: brs-agent\n  - Section: 1\n  - Section Name: Introduction\n-->\n\n## 1. Introduction\n\nThis BRS will define the business need.\n\n### 1.1 Purpose\n\nThe business may expand its services.

## 1.2 Scope

In scope for the initial release.`;
    const findings = selfValidate("1", "Introduction", content);
    expect(findings).toEqual([]);
  });

  it("flags SHALL and technical terms as BLOCKING", () => {
    const content = `<!-- Section Metadata -->\n\n## 5. Business Requirements\n\n| ID | Requirement | Priority | Source |\n|---|---|---|---|\n| BR-01 | The system shall expose a REST API. | Must Have | Problem Statement |\n\nThe customer database must be PostgreSQL.`;
    const findings = selfValidate("5", "Business Requirements", content);

    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("business-language");

    const blocking = findings.filter((f) => f.type === "BLOCKING");
    expect(blocking.length).toBeGreaterThanOrEqual(3);

    const messages = findings.map((f) => f.message.toLowerCase());
    expect(messages.some((m) => m.includes("shall"))).toBe(true);
    expect(messages.some((m) => m.includes("rest"))).toBe(true);
    expect(messages.some((m) => m.includes("postgresql"))).toBe(true);
  });

  it("deduplicates overlapping shall findings", () => {
    const content = `## 5. Business Requirements\n\nThe system shall do something.`;
    const findings = selfValidate("5", "Business Requirements", content);
    const shallFindings = findings.filter((f) =>
      f.message.toLowerCase().includes("shall"),
    );
    expect(shallFindings.length).toBe(1);
  });

  it('does not false-positive "api" inside words', () => {
    const content = `<!-- Section Metadata -->\n\n## 1. Introduction\n\nThe business capacity may increase rapidly across many mapping locations.`;
    const findings = selfValidate("1", "Introduction", content);
    const apiFinding = findings.find((f) =>
      f.message.toLowerCase().includes("api"),
    );
    expect(apiFinding).toBeUndefined();
  });

  it("flags missing metadata as WARNING", () => {
    const content = `## 1. Introduction\n\nSome content.`;
    const findings = selfValidate("1", "Introduction", content);
    const metadataFinding = findings.find((f) => f.rule === "metadata-present");
    expect(metadataFinding).toBeDefined();
    expect(metadataFinding?.type).toBe("WARNING");
  });

  it("flags missing MoSCoW priority for BR rows in section 5", () => {
    const content = `<!-- Section Metadata -->\n\n## 5. Business Requirements\n\n| ID | Requirement | Priority | Source |\n|---|---|---|---|\n| BR-01 | A requirement without priority. | | Problem Statement |\n| BR-02 | Another requirement. | Should Have | Interview |\n`;
    const findings = selfValidate("5", "Business Requirements", content);
    const moscowFindings = findings.filter((f) => f.rule === "moscow");
    expect(moscowFindings.length).toBeGreaterThanOrEqual(1);
    expect(moscowFindings.some((f) => f.message.includes("BR-01"))).toBe(true);
  });

  it("flags missing Source column for traceable IDs in section 5", () => {
    const content = `<!-- Section Metadata -->\n\n## 5. Business Requirements\n\n| ID | Requirement | Priority |\n|---|---|---|\n| BR-01 | A requirement. | Must Have |\n`;
    const findings = selfValidate("5", "Business Requirements", content);
    const traceFinding = findings.find((f) => f.rule === "traceability");
    expect(traceFinding).toBeDefined();
    expect(traceFinding?.type).toBe("BLOCKING");
  });
});
