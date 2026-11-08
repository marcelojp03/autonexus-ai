export const modules = ['employees', 'operations', 'finance', 'intelligence'] as const;
export type ModuleId = (typeof modules)[number];
/** Entry only: each feature and its owner still authorizes its own actions. */
export const moduleEntryPermissions: Partial<Record<ModuleId, readonly string[]>> = {
  finance: ['quotes:read', 'payments:read', 'payments:write', 'expenses:read', 'expenses:write'],
  intelligence: ['intelligence:read'],
};
export function moduleProps(module: ModuleId) {
  return {
    basePath: ('/' + module) as '/employees' | '/operations' | '/finance' | '/intelligence',
    assetBase: ('/mfs/' + module + '/') as '/mfs/employees/' | '/mfs/operations/' | '/mfs/finance/' | '/mfs/intelligence/',
  };
}
export function matchesModule(pathname: string, module: ModuleId): boolean {
  return pathname === '/' + module || pathname.startsWith('/' + module + '/');
}
export function moduleForPath(pathname: string): ModuleId | undefined {
  return modules.find((module) => matchesModule(pathname, module));
}
