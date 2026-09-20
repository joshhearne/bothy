/*
 * The starter pack had Registrar, DNS Host, and ISP Provider pointing at a
 * Vendor document, and Vendor documents belong to one company. An MSP whose
 * clients all sit behind the same registrar had to re-create that registrar
 * for every client. These are names, not relationships, so they become shared
 * option lists instead: one list per job, reachable from every company, and
 * editable inline from any document.
 *
 * This migration repairs an install that was seeded before that change. It is
 * idempotent, and it does nothing at all on an install that never seeded the
 * starter pack.
 */

INSERT INTO option_lists (name) VALUES ('Registrars and DNS Hosts')
  ON CONFLICT (name) DO NOTHING;--> statement-breakpoint
INSERT INTO option_lists (name) VALUES ('Internet Providers')
  ON CONFLICT (name) DO NOTHING;--> statement-breakpoint

INSERT INTO option_items (list_id, label, sort_order)
SELECT l.id, v.label, v.ord
FROM option_lists l
CROSS JOIN (VALUES
  ('Cloudflare', 0), ('GoDaddy', 1), ('Namecheap', 2), ('Hostinger', 3),
  ('Route 53 (AWS)', 4), ('Azure DNS', 5), ('Google Cloud DNS', 6),
  ('DigitalOcean', 7), ('IONOS', 8), ('Gandi', 9), ('Porkbun', 10),
  ('Dynadot', 11), ('Name.com', 12), ('Network Solutions', 13),
  ('Squarespace Domains', 14), ('DNSimple', 15)
) AS v(label, ord)
WHERE l.name = 'Registrars and DNS Hosts'
ON CONFLICT (list_id, label) DO NOTHING;--> statement-breakpoint

INSERT INTO option_items (list_id, label, sort_order)
SELECT l.id, v.label, v.ord
FROM option_lists l
CROSS JOIN (VALUES
  ('AT&T', 0), ('Verizon', 1), ('Comcast Business', 2), ('Spectrum', 3),
  ('Cox Business', 4), ('Lumen', 5), ('Frontier', 6), ('BT', 7),
  ('Virgin Media O2', 8), ('Vodafone', 9), ('Starlink', 10)
) AS v(label, ord)
WHERE l.name = 'Internet Providers'
ON CONFLICT (list_id, label) DO NOTHING;--> statement-breakpoint

/*
 * Anything already filled in points at a Vendor document. Its title becomes an
 * option so the answer already recorded survives the change, even when it is a
 * vendor nobody else would have listed.
 */
INSERT INTO option_items (list_id, label, sort_order)
SELECT DISTINCT l.id, vendor.title, 100
FROM fields f
JOIN doc_types dt ON dt.id = f.doc_type_id
JOIN documents d ON d.doc_type_id = dt.id AND d.field_values ? f.id::text
JOIN documents vendor ON vendor.id::text = d.field_values ->> f.id::text
JOIN option_lists l ON l.name = CASE dt.name
  WHEN 'Domain/DNS' THEN 'Registrars and DNS Hosts'
  ELSE 'Internet Providers'
END
WHERE f.field_type = 'doc_link'
  AND (
    (dt.name = 'Domain/DNS' AND f.label IN ('Registrar', 'DNS Host'))
    OR (dt.name = 'ISP' AND f.label = 'Provider')
  )
  AND btrim(vendor.title) <> ''
ON CONFLICT (list_id, label) DO NOTHING;--> statement-breakpoint

/*
 * Every converted field on a document is patched in one statement. An UPDATE
 * ... FROM touches each target row once, so remapping them one field at a time
 * would silently keep only the first: a Domain/DNS record would carry its
 * registrar across and quietly lose its DNS host.
 */
UPDATE documents d
SET field_values = d.field_values || patched.patch
FROM (
  SELECT doc.id AS doc_id, jsonb_object_agg(f.id::text, to_jsonb(oi.id::text)) AS patch
  FROM documents doc
  JOIN doc_types dt ON dt.id = doc.doc_type_id
  JOIN fields f ON f.doc_type_id = dt.id
    AND f.field_type = 'doc_link'
    AND (
      (dt.name = 'Domain/DNS' AND f.label IN ('Registrar', 'DNS Host'))
      OR (dt.name = 'ISP' AND f.label = 'Provider')
    )
  JOIN documents vendor ON vendor.id::text = doc.field_values ->> f.id::text
  JOIN option_lists l ON l.name = CASE dt.name
    WHEN 'Domain/DNS' THEN 'Registrars and DNS Hosts'
    ELSE 'Internet Providers'
  END
  JOIN option_items oi ON oi.list_id = l.id AND lower(oi.label) = lower(vendor.title)
  WHERE doc.field_values ? f.id::text
  GROUP BY doc.id
) AS patched
WHERE d.id = patched.doc_id;--> statement-breakpoint

UPDATE fields f
SET field_type = 'dropdown',
    option_list_id = (SELECT id FROM option_lists WHERE name = 'Registrars and DNS Hosts'),
    link_doc_type_id = NULL
FROM doc_types dt
WHERE dt.id = f.doc_type_id
  AND dt.name = 'Domain/DNS'
  AND f.label IN ('Registrar', 'DNS Host')
  AND f.field_type = 'doc_link';--> statement-breakpoint

UPDATE fields f
SET field_type = 'dropdown',
    option_list_id = (SELECT id FROM option_lists WHERE name = 'Internet Providers'),
    link_doc_type_id = NULL
FROM doc_types dt
WHERE dt.id = f.doc_type_id
  AND dt.name = 'ISP'
  AND f.label = 'Provider'
  AND f.field_type = 'doc_link';--> statement-breakpoint

/*
 * A value that could not be matched pointed at a document that is gone. It is
 * dropped rather than left behind, where it would read as an unknown option
 * and fail the next save.
 */
UPDATE documents d
SET field_values = d.field_values - f.id::text
FROM fields f
JOIN doc_types dt ON dt.id = f.doc_type_id
WHERE d.doc_type_id = dt.id
  AND f.field_type = 'dropdown'
  AND (
    (dt.name = 'Domain/DNS' AND f.label IN ('Registrar', 'DNS Host'))
    OR (dt.name = 'ISP' AND f.label = 'Provider')
  )
  AND d.field_values ? f.id::text
  AND NOT EXISTS (
    SELECT 1 FROM option_items oi
    WHERE oi.list_id = f.option_list_id
      AND oi.id::text = d.field_values ->> f.id::text
  );--> statement-breakpoint

/* Backlinks were derived from the old doc_link values, so they go too. */
DELETE FROM document_links dl
USING fields f
JOIN doc_types dt ON dt.id = f.doc_type_id
WHERE dl.field_id = f.id
  AND (
    (dt.name = 'Domain/DNS' AND f.label IN ('Registrar', 'DNS Host'))
    OR (dt.name = 'ISP' AND f.label = 'Provider')
  );
