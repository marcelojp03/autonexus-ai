export const modules = [
  "employees",
  "operations",
  "finance",
  "intelligence",
] as const;
export type ModuleId = (typeof modules)[number];
/** Entry only: each feature and its owner still authorizes its own actions. */
export const moduleEntryPermissions: Readonly<
  Record<ModuleId, readonly string[]>
> = {
  employees: [
    "employees:read",
    "employees:write",
    "schedules:read",
    "schedules:write",
    "security:read",
    "security:write",
    "agenda:read:self",
    "agenda:read:team",
    "mcp-clients:manage",
    "executions:read:self",
    "executions:read:team",
    "executions:write",
    "executions:verify",
  ],
  operations: [
    "customers:read",
    "customers:write",
    "vehicles:read",
    "vehicles:write",
    "vehicle-history:read",
    "catalog:read",
    "catalog:write",
    "appointments:read",
    "appointments:write",
    "receptions:read",
    "receptions:write",
    "orders:read",
    "orders:write",
    "confirmations:read",
    "confirmations:write",
  ],
  finance: [
    "quotes:read",
    "payments:read",
    "payments:write",
    "expenses:read",
    "expenses:write",
  ],
  intelligence: ["intelligence:read"],
};
export function authorizedModules(effective: readonly string[]): ModuleId[] {
  return modules.filter((module) =>
    moduleEntryPermissions[module].some((permission) =>
      effective.includes(permission),
    ),
  );
}
export function moduleProps(module: ModuleId) {
  return {
    basePath: ("/" + module) as
      "/employees" | "/operations" | "/finance" | "/intelligence",
    assetBase: ("/mfs/" + module + "/") as
      | "/mfs/employees/"
      | "/mfs/operations/"
      | "/mfs/finance/"
      | "/mfs/intelligence/",
  };
}
export function matchesModule(pathname: string, module: ModuleId): boolean {
  return pathname === "/" + module || pathname.startsWith("/" + module + "/");
}
export function moduleForPath(pathname: string): ModuleId | undefined {
  return modules.find((module) => matchesModule(pathname, module));
}
