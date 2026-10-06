import { describe, expect, it } from "vitest";
import { tidyImportedMarkdown } from "./tidy";

describe("tidyImportedMarkdown", () => {
  it("drops a site's own menu of anchor links", () => {
    const text = [
      "**MENU**",
      "",
      "-   [1\\. Manage](#1)",
      "",
      "-   [2\\. Add](#2)",
      "",
      "[](#)",
      "",
      "Real text.",
    ].join("\n");
    expect(tidyImportedMarkdown(text)).toBe("Real text.");
  });

  it("joins a numbered title to its number as a heading", () => {
    const text = "1.\n\nManage Office Anywhere\n\nOffice Anywhere is a feature.\n\n2.\n\nAdd a Phone Number\n\nSteps follow.";
    expect(tidyImportedMarkdown(text)).toBe(
      "## 1. Manage Office Anywhere\n\nOffice Anywhere is a feature.\n\n## 2. Add a Phone Number\n\nSteps follow.",
    );
  });

  it("gives a number back to the heading it was kept apart from, and drops a label or a button on its own", () => {
    const text = "**MENU**\n\n[![Print](https://cdn/print.png)](#)\n\n1.\n\n### Manage\n\nText.\n\n2.\n\n### Add\n\nMore.";
    expect(tidyImportedMarkdown(text)).toBe("### 1. Manage\n\nText.\n\n### 2. Add\n\nMore.");
  });

  it("does not take a sentence for a title", () => {
    const text = "1.\n\nThis is a whole sentence that ends with a stop.\n\nMore.";
    expect(tidyImportedMarkdown(text)).toContain("1.\n\nThis is a whole");
  });

  it("joins steps that an empty picture link cut apart", () => {
    const text = [
      "1.  From the menu, click **Office Anywhere**.",
      "",
      "[](https://cdn.example.com/shot-1.png)",
      "",
      "1.  On the **Setup** page, click **Plus**.",
      "",
      "[](https://cdn.example.com/shot-2.png)",
      "",
      "1.  Enter the number.",
      "2.  Click **Save**.",
    ].join("\n");
    expect(tidyImportedMarkdown(text)).toBe(
      [
        "1.  From the menu, click **Office Anywhere**.",
        "",
        "2. On the **Setup** page, click **Plus**.",
        "",
        "3. Enter the number.",
        "4. Click **Save**.",
      ].join("\n"),
    );
  });

  it("tucks a picture between steps under the step above and carries the count on", () => {
    const text = "1. Open the panel.\n\n![](images/1/a.png)\n\n1. Choose a sender.\n2. Save.";
    expect(tidyImportedMarkdown(text)).toBe("1. Open the panel.\n\n    ![](images/1/a.png)\n\n2. Choose a sender.\n3. Save.");
  });

  it("lets a paragraph between two lists keep them apart", () => {
    const note = "1. Open the panel.\n\nA note about the panel.\n\n1. Choose a sender.\n2. Save.";
    expect(tidyImportedMarkdown(note)).toBe(note);
    const label = "1. Too many reports.\n\n**Common Causes**:\n\n1. Volume caps.";
    expect(tidyImportedMarkdown(label)).toBe(label);
  });

  it("leaves a list alone that runs on across a wrapped line, as Markdown already reads it as one", () => {
    const text = "3. Pour the solution. Rock\nvehicle back and forth.\n\n1. Open all faucets.\n2. Wait four hours.";
    expect(tidyImportedMarkdown(text)).toBe(text);
  });

  it("does not join across a change of delimiter", () => {
    const text = "1. One\n2. Two\n\n1) First\n2) Second";
    expect(tidyImportedMarkdown(text)).toBe(text);
  });

  it("makes a step of a number with only a picture under it", () => {
    const text = "1.\n\n![](images/1/a.png)\n\n1.\n\n![](images/1/b.png)";
    expect(tidyImportedMarkdown(text)).toBe("1. ![](images/1/a.png)\n\n2. ![](images/1/b.png)");
  });

  it("leaves two lists apart when a heading or a bullet list stands between", () => {
    const text = "1. First list.\n\n## Another part\n\n1. Second list.";
    expect(tidyImportedMarkdown(text)).toBe(text);
    const bullets = "1. First list.\n\n- a bullet\n\n1. Second list.";
    expect(tidyImportedMarkdown(bullets)).toBe(bullets);
  });

  it("lets a list start over under a plain-text title, as a PDF's text has them", () => {
    const text = "1. Run the close.\n2. Press Enter to exit.\nJournal Entry for Last Year (9-6-3)\n1. After the close, this is the only routine.\n2. Entries can be made.";
    expect(tidyImportedMarkdown(text)).toBe(
      "1. Run the close.\n2. Press Enter to exit.\n\nJournal Entry for Last Year (9-6-3)\n1. After the close, this is the only routine.\n2. Entries can be made.",
    );
    const spaced = "1. Run the close.\n\nPreparing for Year End\n\n1. Do not run a month end.";
    expect(tidyImportedMarkdown(spaced)).toBe(spaced);
  });

  it("leaves nested lists and fenced code alone", () => {
    const text = "1. Outer\n    1. Inner\n    2. Inner too\n2. Outer again\n\n```\n1.\n\nNot a title\n```";
    expect(tidyImportedMarkdown(text)).toBe(text);
  });
});
