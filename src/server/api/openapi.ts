import "server-only";
import { z } from "zod";
import { companyInputSchema } from "@/server/services/companies";
import { locationInputSchema } from "@/server/services/locations";
import { externalRefInputSchema } from "@/server/services/external-refs";
import { API_SCOPES } from "@/server/services/api-keys";
import { FIELD_TYPES } from "@/server/db/schema";

/**
 * OpenAPI 3.1, generated from the same Zod schemas the endpoints validate with
 * (CLAUDE.md), so the document cannot drift from the behavior.
 */

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });

const documentCreateSchema = z.object({
  company_id: z.uuid(),
  doc_type_id: z.uuid(),
  location_id: z.uuid().nullish(),
  title: z.string().min(1).max(300),
  field_values: z.record(z.string(), z.unknown()).optional(),
});

const documentPatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  /** Partial merge, keyed by field UUID. */
  field_values: z.record(z.string(), z.unknown()).optional(),
});

const optionItemSchema = z.object({ label: z.string().min(1).max(200) });

const companyBodySchema = z.object({
  name: z.string().min(1).max(200),
  is_internal: z.boolean().optional(),
  notes: z.string().nullish(),
});

const locationBodySchema = z.object({
  company_id: z.uuid(),
  name: z.string().min(1).max(200),
  address: z.string().nullish(),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const PAGE_PARAMS = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  { name: "cursor", in: "query", schema: { type: "string" } },
];

function ok(description: string, schemaName?: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaName ? { $ref: `#/components/schemas/${schemaName}` } : {},
      },
    },
  };
}

const ERRORS = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "422": { $ref: "#/components/responses/InvalidRequest" },
  "429": { $ref: "#/components/responses/RateLimited" },
};

function body(schema: z.ZodType) {
  return {
    required: true,
    content: { "application/json": { schema: jsonSchema(schema) } },
  };
}

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Strata API",
      version: "1.0.0",
      description:
        "Self-hosted structured IT documentation. Authenticate with an API key as a bearer token.",
      license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Companies" },
      { name: "Locations" },
      { name: "Doc types" },
      { name: "Documents" },
      { name: "Option lists" },
      { name: "Search" },
      { name: "Integrations" },
    ],
    paths: {
      "/companies": {
        get: {
          tags: ["Companies"],
          summary: "List companies",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "external_system", in: "query", schema: { type: "string" } },
            { name: "external_id", in: "query", schema: { type: "string" } },
            ...PAGE_PARAMS,
          ],
          responses: { "200": ok("A page of companies"), ...ERRORS },
        },
        post: {
          tags: ["Companies"],
          summary: "Create a company",
          requestBody: body(companyBodySchema),
          responses: { "201": ok("The created company"), ...ERRORS },
        },
      },
      "/companies/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Companies"],
          summary: "Fetch a company",
          responses: { "200": ok("The company"), ...ERRORS },
        },
        patch: {
          tags: ["Companies"],
          summary: "Update a company",
          requestBody: body(companyBodySchema.partial()),
          responses: { "200": ok("The updated company"), ...ERRORS },
        },
      },
      "/companies/{id}/locations": {
        parameters: [idParam, ...PAGE_PARAMS],
        get: {
          tags: ["Locations"],
          summary: "List a company's locations",
          responses: { "200": ok("A page of locations"), ...ERRORS },
        },
      },
      "/companies/{id}/documents": {
        parameters: [
          idParam,
          { name: "doc_type", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
          ...PAGE_PARAMS,
        ],
        get: {
          tags: ["Documents"],
          summary: "List a company's documents",
          responses: { "200": ok("A page of documents"), ...ERRORS },
        },
      },
      "/locations": {
        post: {
          tags: ["Locations"],
          summary: "Create a location",
          requestBody: body(locationBodySchema),
          responses: { "201": ok("The created location"), ...ERRORS },
        },
      },
      "/locations/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Locations"],
          summary: "Fetch a location",
          responses: { "200": ok("The location"), ...ERRORS },
        },
        patch: {
          tags: ["Locations"],
          summary: "Update a location",
          requestBody: body(locationBodySchema.omit({ company_id: true }).partial()),
          responses: { "200": ok("The updated location"), ...ERRORS },
        },
      },
      "/doc-types": {
        get: {
          tags: ["Doc types"],
          summary: "List doc types with their template fields",
          responses: { "200": ok("Every active doc type"), ...ERRORS },
        },
      },
      "/doc-types/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Doc types"],
          summary: "Fetch one doc type",
          responses: { "200": ok("The doc type"), ...ERRORS },
        },
      },
      "/documents": {
        post: {
          tags: ["Documents"],
          summary: "Create a document",
          requestBody: body(documentCreateSchema),
          responses: { "201": ok("The created document"), ...ERRORS },
        },
      },
      "/documents/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Documents"],
          summary: "Fetch a document with resolved values",
          responses: { "200": ok("The document"), ...ERRORS },
        },
        patch: {
          tags: ["Documents"],
          summary: "Update a document, merging field_values",
          requestBody: body(documentPatchSchema),
          responses: { "200": ok("The updated document"), ...ERRORS },
        },
      },
      "/documents/{id}/revisions": {
        parameters: [idParam],
        get: {
          tags: ["Documents"],
          summary: "List a document's revisions, newest first",
          responses: { "200": ok("Revisions"), ...ERRORS },
        },
      },
      "/option-lists/{id}/items": {
        parameters: [idParam],
        get: {
          tags: ["Option lists"],
          summary: "List the items on an option list",
          responses: { "200": ok("Items"), ...ERRORS },
        },
        post: {
          tags: ["Option lists"],
          summary: "Add an item to an option list",
          requestBody: body(optionItemSchema),
          responses: { "201": ok("The created item"), "409": ok("That label already exists"), ...ERRORS },
        },
      },
      "/search": {
        get: {
          tags: ["Search"],
          summary: "Search every document",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "company_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "doc_type", in: "query", schema: { type: "string", format: "uuid" } },
            ...PAGE_PARAMS,
          ],
          responses: { "200": ok("Matching documents"), ...ERRORS },
        },
      },
      "/external-refs": {
        put: {
          tags: ["Integrations"],
          summary: "Map a record to an id in another system",
          requestBody: body(externalRefInputSchema),
          responses: { "200": ok("The stored mapping"), ...ERRORS },
        },
      },
      "/lookup": {
        get: {
          tags: ["Integrations"],
          summary: "Find a record by its id in another system",
          parameters: [
            { name: "system", in: "query", required: true, schema: { type: "string" } },
            {
              name: "entity",
              in: "query",
              schema: { type: "string", enum: ["company", "location", "document"] },
            },
            { name: "external_id", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": ok("The company with its locations and documents"),
            ...ERRORS,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: `Scopes: ${API_SCOPES.join(", ")}. admin implies write, write implies read.`,
        },
      },
      schemas: {
        Error: jsonSchema(errorSchema),
        CompanyInput: jsonSchema(companyInputSchema),
        LocationInput: jsonSchema(locationInputSchema),
        FieldType: { type: "string", enum: [...FIELD_TYPES] },
      },
      responses: {
        Unauthorized: ok("No or invalid API key", "Error"),
        Forbidden: ok("The key lacks the required scope", "Error"),
        NotFound: ok("No such record", "Error"),
        InvalidRequest: ok("The request body or query was rejected", "Error"),
        RateLimited: ok("Too many requests", "Error"),
      },
    },
    webhooks: {
      "document.updated": {
        post: {
          summary: "Sent when a document is saved",
          description:
            "Signed with HMAC-SHA256 in X-Strata-Signature, with X-Strata-Event and X-Strata-Delivery alongside.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    event: { type: "string" },
                    occurred_at: { type: "string", format: "date-time" },
                    data: { type: "object" },
                  },
                  required: ["event", "occurred_at", "data"],
                },
              },
            },
          },
          responses: { "200": { description: "Acknowledged" } },
        },
      },
    },
  };
}
