declare module "*local-pkce.mjs" {
  export interface PkceConfig { issuer?: string; client?: string; redirect?: string; scope?: string; resource?: string; clientSecret?: string }
  export function authorize(fixture: { username: string; password: string; enabled?: boolean }, wrongPassword?: boolean, config?: PkceConfig): Promise<{ access_token: string; id_token: string; refresh_token: string }>;
}
