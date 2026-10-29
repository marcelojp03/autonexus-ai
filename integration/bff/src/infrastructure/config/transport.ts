export function trustedHttpUrl(value: string, name: string): URL {
  try {
    if (!/^https?:\/\//.test(value)) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || value.split('/')[2]?.includes('@') || value.includes('?') || value.includes('#') || /[\s\\*]/.test(value)) throw new Error();
    return url;
  } catch { throw new Error(`Invalid configuration: ${name}`); }
}

export function exactOrigin(value: string): boolean {
  try { return trustedHttpUrl(value, 'WEB_ALLOWED_ORIGINS').origin === value; } catch { return false; }
}

export function httpHost(value = '127.0.0.1'): string {
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(value)) throw new Error('Invalid configuration: HTTP_HOST');
  return value;
}
