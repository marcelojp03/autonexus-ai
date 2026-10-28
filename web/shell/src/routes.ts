export const modules = ['employees', 'operations'] as const;
/** Registered only after the React mount is verified end to end; see docs/context/STATUS.md. */
export const pendingModules = ['finance'] as const;
export type ModuleId = (typeof modules)[number];
export function matchesModule(pathname: string, module: ModuleId): boolean {
  return pathname === '/' + module || pathname.startsWith('/' + module + '/');
}
export function moduleForPath(pathname: string): ModuleId | undefined {
  return modules.find((module) => matchesModule(pathname, module));
}
