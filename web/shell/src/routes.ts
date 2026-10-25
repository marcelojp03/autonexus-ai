export const modules = ['employees', 'operations'] as const;
export type ModuleId = (typeof modules)[number];
export function matchesModule(pathname: string, module: ModuleId): boolean {
  return pathname === '/' + module || pathname.startsWith('/' + module + '/');
}
export function moduleForPath(pathname: string): ModuleId | undefined {
  return modules.find((module) => matchesModule(pathname, module));
}
