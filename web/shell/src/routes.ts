export const modules = ['employees', 'operations', 'finance'] as const;
export type ModuleId = (typeof modules)[number];
export function moduleProps(module: ModuleId) {
  return { basePath: ('/' + module) as '/employees' | '/operations' | '/finance', assetBase: ('/mfs/' + module + '/') as '/mfs/employees/' | '/mfs/operations/' | '/mfs/finance/' };
}
export function matchesModule(pathname: string, module: ModuleId): boolean {
  return pathname === '/' + module || pathname.startsWith('/' + module + '/');
}
export function moduleForPath(pathname: string): ModuleId | undefined {
  return modules.find((module) => matchesModule(pathname, module));
}
