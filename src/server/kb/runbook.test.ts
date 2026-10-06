import { describe, expect, it } from "vitest";
import { deriveRunbook, RunbookStepError, withoutStepIds } from "./runbook";

describe("deriveRunbook", () => {
  it("takes the first top-level ordered list as the steps, with ids, notes, and canned tokens", () => {
    const body = [
      "# VM PIN Reset",
      "",
      "Before you start, have the user's extension.",
      "",
      "1. Find the user under **Management**. {#find-user}",
      "2. Open **Voicemail Passcode** and set it.",
      "",
      "    Default is `753159`.",
      "    - never reuse the old one",
      "",
      "3. Send @canned:[Voicemail PIN Reset] to the user.",
      "",
      "Done. Close the ticket.",
    ].join("\n");

    const parts = deriveRunbook(body);
    expect(parts.steps).toHaveLength(3);
    expect(parts.steps[0]).toEqual({ id: "find-user", text: "Find the user under **Management**." });
    expect(parts.steps[1]?.text).toBe("Open **Voicemail Passcode** and set it.");
    expect(parts.steps[1]?.note).toBe("Default is `753159`.\n- never reuse the old one");
    expect(parts.steps[1]?.id).toMatch(/^[0-9a-f]{8}$/);
    expect(parts.steps[2]?.canned).toBe("Voicemail PIN Reset");
    expect(parts.steps[2]?.text).toContain("@canned:[Voicemail PIN Reset]");
    expect(parts.preamble).toBe("# VM PIN Reset\n\nBefore you start, have the user's extension.");
    expect(parts.tail).toBe("Done. Close the ticket.");
    // Minted ids are written back, so the next save sees them.
    expect(parts.body).toContain(`2. Open **Voicemail Passcode** and set it. {#${parts.steps[1]?.id}}`);
    expect(parts.body).toContain(`3. Send @canned:[Voicemail PIN Reset] to the user. {#${parts.steps[2]?.id}}`);
    expect(deriveRunbook(parts.body).body).toBe(parts.body);
  });

  it("keeps an earlier step's id for an item with the same words and no id", () => {
    const first = deriveRunbook("1. Open the panel.\n2. Save.");
    const [open, save] = first.steps;
    const edited = deriveRunbook("1. Say hello.\n2. Save!\n3. Open the panel", first.steps);
    expect(edited.steps.map((s) => s.id)).toEqual([expect.stringMatching(/^[0-9a-f]{8}$/), save?.id, open?.id]);
  });

  it("falls back to a task list when there is no ordered list", () => {
    const parts = deriveRunbook("Checks:\n\n- [ ] Power on {#power}\n- [x] Lights\n\nThen go.");
    expect(parts.steps.map((s) => s.text)).toEqual(["Power on", "Lights"]);
    expect(parts.steps[0]?.id).toBe("power");
    expect(parts.tail).toBe("Then go.");
  });

  it("ignores lists inside fenced code and a list that is nested", () => {
    const parts = deriveRunbook("```\n1. not a step\n```\n\n- a bullet\n  1. nested\n\nNo steps here.");
    expect(parts.steps).toEqual([]);
  });

  it("refuses a repeated or malformed id", () => {
    expect(() => deriveRunbook("1. A {#same}\n2. B {#same}")).toThrow(RunbookStepError);
    expect(() => deriveRunbook("1. A {#Not_Valid}")).toThrow(RunbookStepError);
  });
});

describe("withoutStepIds", () => {
  it("takes the id blocks off for reading", () => {
    expect(withoutStepIds("1. One {#a1}\n2. Two {#b2}\nplain")).toBe("1. One\n2. Two\nplain");
  });
});
