/**
 * What a TXT record is for, when it can be told. Most of what sits at a
 * domain's apex is one of two things: a mail policy, or a token some service
 * asked for to prove the domain is yours. Naming them saves reading them.
 */

export type TxtKind = "spf" | "dmarc" | "dkim" | "verification" | "other";

export type TxtClass = {
  kind: TxtKind;
  /** The short name shown beside the record: "SPF", "Google site verification". */
  label: string | null;
};

type Rule = { test: RegExp; kind: TxtKind; label: string };

/* Anchored at the start, case-insensitive, whitespace before it tolerated. */
const RULES: readonly Rule[] = [
  { test: /^v=spf1\b/i, kind: "spf", label: "SPF" },
  { test: /^v=dmarc1\b/i, kind: "dmarc", label: "DMARC" },
  { test: /^v=dkim1\b/i, kind: "dkim", label: "DKIM" },
  {
    test: /^google-site-verification=/i,
    kind: "verification",
    label: "Google site verification",
  },
  {
    test: /^atlassian-domain-verification=/i,
    kind: "verification",
    label: "Atlassian domain verification",
  },
  {
    test: /^(?:v=verifydomain\s+)?MS=/i,
    kind: "verification",
    label: "Microsoft 365 verification",
  },
  {
    test: /^amazonses:/i,
    kind: "verification",
    label: "Amazon SES verification",
  },
  {
    test: /^ppe-[0-9a-f]{6,}/i,
    kind: "verification",
    label: "Proofpoint Essentials verification",
  },
  {
    test: /^proofpoint-verification=/i,
    kind: "verification",
    label: "Proofpoint verification",
  },
  {
    test: /^apple-domain-verification=/i,
    kind: "verification",
    label: "Apple domain verification",
  },
  {
    test: /^facebook-domain-verification=/i,
    kind: "verification",
    label: "Meta domain verification",
  },
  { test: /^docusign=/i, kind: "verification", label: "DocuSign verification" },
  {
    test: /^adobe-(?:idp-site|sign)-verification=/i,
    kind: "verification",
    label: "Adobe verification",
  },
  { test: /^zoom_verify_/i, kind: "verification", label: "Zoom verification" },
  {
    test: /^stripe-verification=/i,
    kind: "verification",
    label: "Stripe verification",
  },
  {
    test: /^_globalsign-domain-verification=/i,
    kind: "verification",
    label: "GlobalSign verification",
  },
  {
    test: /^dropbox-domain-verification=/i,
    kind: "verification",
    label: "Dropbox verification",
  },
  {
    test: /^miro-verification=/i,
    kind: "verification",
    label: "Miro verification",
  },
  {
    test: /^openai-domain-verification=/i,
    kind: "verification",
    label: "OpenAI verification",
  },
  {
    test: /^cisco-ci-domain-verification=/i,
    kind: "verification",
    label: "Cisco verification",
  },
  {
    test: /^webexdomainverification/i,
    kind: "verification",
    label: "Webex verification",
  },
  {
    test: /^onetrust-domain-verification=/i,
    kind: "verification",
    label: "OneTrust verification",
  },
  {
    test: /^hubspot-developer-verification=/i,
    kind: "verification",
    label: "HubSpot verification",
  },
  {
    test: /^logmein-verification-code=/i,
    kind: "verification",
    label: "LogMeIn verification",
  },
  {
    test: /^mongodb-site-verification=/i,
    kind: "verification",
    label: "MongoDB verification",
  },
  {
    test: /^knowbe4-site-verification=/i,
    kind: "verification",
    label: "KnowBe4 verification",
  },
  {
    test: /^have-i-been-pwned-verification=/i,
    kind: "verification",
    label: "Have I Been Pwned verification",
  },
  {
    test: /^canva-site-verification=/i,
    kind: "verification",
    label: "Canva verification",
  },
  {
    test: /^(?:brevo|sendinblue)-code:/i,
    kind: "verification",
    label: "Brevo verification",
  },
  {
    test: /^pardot_?\d*=/i,
    kind: "verification",
    label: "Salesforce Pardot verification",
  },
  {
    test: /^slack-domain-verification=/i,
    kind: "verification",
    label: "Slack verification",
  },
  {
    test: /^twilio-domain-verification=/i,
    kind: "verification",
    label: "Twilio verification",
  },
  {
    test: /^1password-site-verification=/i,
    kind: "verification",
    label: "1Password verification",
  },
  {
    test: /^cloudflare-verify=/i,
    kind: "verification",
    label: "Cloudflare verification",
  },
  {
    test: /^github-verification=/i,
    kind: "verification",
    label: "GitHub verification",
  },
  {
    test: /^[a-z0-9-]+-(?:domain|site)-verification=/i,
    kind: "verification",
    label: "Domain verification",
  },
];

export function classifyTxt(record: string): TxtClass {
  const value = record.trim();
  for (const rule of RULES) {
    if (rule.test.test(value)) return { kind: rule.kind, label: rule.label };
  }
  return { kind: "other", label: null };
}
