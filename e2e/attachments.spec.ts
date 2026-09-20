import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { psql } from "./db";
import { createCompany, createDocType, createDocument, signInAsAdmin, unique } from "./support";

/**
 * What a document will take as an attachment. The rule is the file's own
 * bytes: a renamed executable claims whatever its uploader likes.
 */

const DOC_TYPE = unique("Files Vendor");
const COMPANY = unique("Files Co");

let documentId = "";

test.describe.configure({ mode: "serial" });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

function office(entries: Record<string, string>): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(entries)) files[name] = strToU8(body);
  return Buffer.from(zipSync(files));
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Support Phone", type: "text" }]);
  const companyId = await createCompany(page, COMPANY);
  documentId = await createDocument(page, companyId, DOC_TYPE, unique("File holder"));

  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}`);
});

async function upload(
  page: import("@playwright/test").Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await page.getByLabel("Add a file").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "Upload" }).click();
}

test("the file input offers what the policy takes", async ({ page }) => {
  const accept = await page.getByLabel("Add a file").getAttribute("accept");
  expect(accept).toContain("image/png");
  expect(accept).toContain("application/pdf");
  expect(accept).toContain(".heic");
  expect(accept).not.toContain("svg");
});

test("images and documents are accepted and stored as what they are", async ({ page }) => {
  await upload(page, "screenshot.png", "image/png", PNG);
  await expect(page.getByRole("link", { name: "screenshot.png" })).toBeVisible();

  await upload(page, "contract.pdf", "application/pdf", PDF);
  await expect(page.getByRole("link", { name: "contract.pdf" })).toBeVisible();

  await upload(
    page,
    "runbook.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    office({ "word/document.xml": "<w:document/>", "[Content_Types].xml": "<Types/>" }),
  );
  await expect(page.getByRole("link", { name: "runbook.docx" })).toBeVisible();

  expect(
    psql(`select mime_type from attachments where filename = 'screenshot.png' limit 1;`),
  ).toBe("image/png");
  expect(psql(`select mime_type from attachments where filename = 'contract.pdf' limit 1;`)).toBe(
    "application/pdf",
  );
});

test("a macro-enabled document is refused", async ({ page }) => {
  await upload(
    page,
    "invoice.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    office({ "word/document.xml": "<w:document/>", "word/vbaProject.bin": "\u0000\u0000" }),
  );

  await expect(page.getByText(/contains macros/)).toBeVisible();
  expect(psql(`select count(*) from attachments where filename = 'invoice.docx';`)).toBe("0");
});

test("the bytes decide, not the name", async ({ page }) => {
  // A Windows executable wearing a .png extension.
  await upload(page, "totally-a-picture.png", "image/png", Buffer.from("MZ\x90\x00\x03\x00\x00\x00"));
  await expect(page.getByText(/file type is not accepted/)).toBeVisible();

  // A zip that is not an Office document.
  await upload(page, "bundle.zip", "application/zip", office({ "notes.txt": "hello" }));
  await expect(page.getByText(/file type is not accepted/)).toBeVisible();

  // Binary wearing a text extension.
  await upload(page, "notes.txt", "text/plain", Buffer.from([0x00, 0x01, 0x02, 0x03]));
  await expect(page.getByText(/file type is not accepted/)).toBeVisible();

  expect(
    psql(
      `select count(*) from attachments where filename in ` +
        `('totally-a-picture.png', 'bundle.zip', 'notes.txt');`,
    ),
  ).toBe("0");
});

test("plain text still works, as it always did", async ({ page }) => {
  await upload(page, "notes.md", "text/markdown", Buffer.from("# Runbook\n\nStep one.\n"));
  await expect(page.getByRole("link", { name: "notes.md" })).toBeVisible();
  expect(psql(`select mime_type from attachments where filename = 'notes.md' limit 1;`)).toBe(
    "text/markdown",
  );
});
