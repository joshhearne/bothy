ALTER TABLE "companies" ADD COLUMN "vault_provider_id" uuid;--> statement-breakpoint
/*
 * Collection mappings used to name the system 'bitwarden', which assumed one
 * vault for the whole instance. They are now keyed by provider, so two vaults
 * can each map the same company without colliding.
 */
UPDATE external_refs r
SET system = 'vault:' || p.id::text
FROM vault_providers p
WHERE r.system = 'bitwarden'
  AND p.id = (
    SELECT id FROM vault_providers
    WHERE kind IN ('bw_serve', 'bitwarden_public_api')
    ORDER BY enabled DESC, name
    LIMIT 1
  );
