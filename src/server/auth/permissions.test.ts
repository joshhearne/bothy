import { describe, expect, it } from "vitest";
import {
  BUILTIN_PERMISSIONS,
  isAdministrator,
  isBuiltinRole,
  isPermission,
  PERMISSIONS,
  toRoleKey,
} from "./permissions";

describe("built-in roles", () => {
  it("give admin everything, tech the spec's list, and readonly nothing", () => {
    expect(BUILTIN_PERMISSIONS.admin).toEqual(PERMISSIONS);
    expect(BUILTIN_PERMISSIONS.tech).toEqual(["documents.edit", "secrets.fields"]);
    expect(BUILTIN_PERMISSIONS.readonly).toEqual([]);
  });

  it("know which keys are built in", () => {
    expect(isBuiltinRole("tech")).toBe(true);
    expect(isBuiltinRole("editor")).toBe(false);
  });
});

describe("toRoleKey", () => {
  it("makes a slug of a name", () => {
    expect(toRoleKey("  Help Desk / Tier 1 ")).toBe("help-desk-tier-1");
    expect(toRoleKey("Éditeur")).toBe("diteur");
    expect(toRoleKey("---")).toBe("");
  });
});

describe("isAdministrator", () => {
  it("is the admin-area permission, whatever the role is called", () => {
    expect(isAdministrator(new Set(["admin.area"]))).toBe(true);
    expect(isAdministrator(new Set(["documents.edit", "hierarchy.manage"]))).toBe(false);
    expect(isPermission("admin.area")).toBe(true);
    expect(isPermission("root")).toBe(false);
  });
});
