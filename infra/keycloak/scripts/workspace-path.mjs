export function normalizeWorkspacePath(value) {
  let path = value.split(String.fromCharCode(92)).join('/');
  while (path.includes('//')) path = path.replaceAll('//', '/');
  if (path.endsWith('/')) path = path.slice(0, -1);
  return path.toLowerCase();
}
