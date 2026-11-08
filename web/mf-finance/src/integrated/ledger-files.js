import { publicRuntimeConfig } from '../../../browser-auth/session.ts';

export function fileRequest(target, method) {
  const bff = new URL(publicRuntimeConfig(location.origin)?.graphqlUrl ?? 'http://127.0.0.1:3004/graphql');
  const url = new URL(target.url, bff);
  const path = url.pathname.split('/');
  const validPath = path.length === 5 && path[1] === 'finance-files' && path[2] === 'documents' && /^[0-9a-f-]{36}$/.test(path[3]) && path[4] === 'content';
  if (![location.origin, bff.origin].includes(url.origin) || !validPath || target.method !== method || url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('El destino documental no pertenece al BFF autorizado.');
  const headers = JSON.parse(target.headersJson);
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).some(key => !['content-type', 'x-finance-grant'].includes(key.toLowerCase()))) throw new Error('El permiso documental contiene encabezados no autorizados.');
  return { url: url.href, options: { method, headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) } };
}
