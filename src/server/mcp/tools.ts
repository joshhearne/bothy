import "server-only";
import { z } from "zod";
import { serializeCompany, serializeDocument } from "@/server/api/serializers";
import { getCompany, listCompaniesPage } from "@/server/services/companies";
import { listLocations } from "@/server/services/locations";
import { listDocTypes, listTemplateFields } from "@/server/services/doc-types";
import { getDocumentDetail, listBacklinks, listCompanyDocuments } from "@/server/services/documents";
import { searchDocuments } from "@/server/services/search";
import { toolError, toolResult, type ToolResult } from "@/server/mcp/protocol";
import type { CompanyScope } from "@/server/auth/company-scope";

/**
 * Read-only tools over the documentation. Nothing here can change a record,
 * and nothing here can return a secret: a secret_ref is redacted the same way
 * it is for webhooks, and there is deliberately no reveal tool. Revealing a
 * credential is a decision for a person at a keyboard, with an audit entry.
 */

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
    * The scope is the API key's: a key limited to named companies gives its
    * model a view limited to the same ones, search included.
    */
  run: (args: Record<string, unknown>, scope: CompanyScope) => Promise<ToolResult>;
};

const searchArgs = z.object({
  query: z.string().trim().min(1, "query is required").max(200),
  company_id: z.uuid().optional(),
  doc_type_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const companyArgs = z.object({ company_id: z.uuid() });
const documentArgs = z.object({ document_id: z.uuid() });
const listCompaniesArgs = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Turns a Zod failure into something a model can act on. */
function invalid(error: z.ZodError): ToolResult {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return toolError(`Invalid arguments — ${detail}`);
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_documents",
    title: "Search documents",
    description:
      "Full-text search across every document. Returns matching documents with their " +
      "company, location, and doc type. Use this first when you do not know where " +
      "something is documented.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or a quoted phrase. OR is supported." },
        company_id: { type: "string", format: "uuid", description: "Restrict to one company." },
        doc_type_id: { type: "string", format: "uuid", description: "Restrict to one doc type." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
    async run(args, scope) {
      const parsed = searchArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const results = await searchDocuments({
        q: parsed.data.query,
        ...(parsed.data.company_id ? { companyId: parsed.data.company_id } : {}),
        ...(parsed.data.doc_type_id ? { docTypeId: parsed.data.doc_type_id } : {}),
        limit: parsed.data.limit,
      }, scope);

      return toolResult({
        query: parsed.data.query,
        count: results.hits.length,
        documents: results.hits.map((hit) => ({
          document_id: hit.id,
          title: hit.title,
          company: { id: hit.companyId, name: hit.companyName },
          doc_type: hit.docTypeName,
          location: hit.locationName,
          updated_at: hit.updatedAt.toISOString(),
        })),
      });
    },
  },

  {
    name: "get_document",
    title: "Read a document",
    description:
      "Every field of one document, with values resolved to labels and linked titles. " +
      "Secret fields report only that a credential exists and where it lives; the " +
      "credential itself is never returned.",
    inputSchema: {
      type: "object",
      properties: { document_id: { type: "string", format: "uuid" } },
      required: ["document_id"],
    },
    async run(args, scope) {
      const parsed = documentArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const detail = await getDocumentDetail(parsed.data.document_id, scope);
      if (!detail) return toolError("No document with that id");

      const [company, backlinks] = await Promise.all([
        getCompany(detail.document.companyId, scope),
        listBacklinks(parsed.data.document_id, scope),
      ]);

      // redactSecrets keeps every secret_ref out of the payload entirely.
      const serialized = serializeDocument({ ...detail, redactSecrets: true });

      return toolResult({
        ...serialized,
        company_name: company?.name ?? null,
        linked_from: backlinks.map((link) => ({
          document_id: link.documentId,
          title: link.title,
          doc_type: link.docTypeName,
          field: link.fieldLabel,
        })),
        note: "Secret fields are omitted. Reveal a credential in Bothy, where it is audited.",
      });
    },
  },

  {
    name: "list_companies",
    title: "List companies",
    description: "Every company, optionally filtered by name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Match part of a company name." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
    async run(args, scope) {
      const parsed = listCompaniesArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const rows = await listCompaniesPage({
        ...(parsed.data.query ? { q: parsed.data.query } : {}),
        limit: parsed.data.limit,
        cursor: null,
        scope,
      });

      return toolResult({
        count: rows.length,
        companies: rows.slice(0, parsed.data.limit).map((row) => serializeCompany(row)),
      });
    },
  },

  {
    name: "get_company",
    title: "Read a company",
    description:
      "One company with its locations and a summary of every document it holds. Use " +
      "this to see what is documented for a client before reading any one document.",
    inputSchema: {
      type: "object",
      properties: { company_id: { type: "string", format: "uuid" } },
      required: ["company_id"],
    },
    async run(args, scope) {
      const parsed = companyArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const company = await getCompany(parsed.data.company_id, scope);
      if (!company) return toolError("No company with that id");

      const [locations, documents] = await Promise.all([
        listLocations(company.id, scope),
        listCompanyDocuments(company.id, scope),
      ]);

      return toolResult({
        company: serializeCompany(company),
        locations: locations.map((location) => ({
          id: location.id,
          name: location.name,
          address: location.address,
        })),
        documents: documents.map((document) => ({
          document_id: document.id,
          title: document.title,
          doc_type: document.docTypeName,
          location: document.locationName,
          updated_at: document.updatedAt.toISOString(),
        })),
      });
    },
  },

  {
    name: "list_doc_types",
    title: "List doc types",
    description:
      "The templates documents are built from, with their fields. Useful for knowing " +
      "what information Bothy expects to hold about a firewall, a circuit, and so on.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const docTypes = await listDocTypes();

      const described = await Promise.all(
        docTypes.map(async (docType) => ({
          id: docType.id,
          name: docType.name,
          scope: docType.scope,
          document_count: docType.documentCount,
          fields: (await listTemplateFields(docType.id)).map((field) => ({
            label: field.label,
            type: field.fieldType,
            required: field.required,
          })),
        })),
      );

      return toolResult({ count: described.length, doc_types: described });
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** The wire shape of tools/list. */
export function describeTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }));
}
