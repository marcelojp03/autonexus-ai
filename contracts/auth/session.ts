/** CU01 client composition contract. Types only: no token storage or business policy. */
export type WorkshopRole = 'administrador' | 'recepcionista' | 'mecanico' | 'jefe_taller' | 'responsable_financiero';
export type TechnicalService = 'operations' | 'employees';
export type TechnicalResource = 'session' | 'admin';
/** Token role slugs are presentation metadata, never proof of a business permission. */
export interface SessionIdentity { readonly subject: string; readonly username: string; readonly roles: readonly string[]; }
export interface SessionSnapshot {
  readonly mode: 'oidc' | 'demo';
  readonly phase: 'initializing' | 'authenticated' | 'anonymous' | 'error' | 'demo';
  readonly authenticated: boolean;
  readonly identity: SessionIdentity | null;
  readonly notice?: string;
}
export interface TechnicalSession { readonly resource: 'session'; readonly service: TechnicalService; readonly subject: string; readonly roles: readonly WorkshopRole[]; }
export interface TechnicalAdmin { readonly resource: 'admin'; readonly service: TechnicalService; readonly authorized: true; }
export type TechnicalResult = TechnicalSession | TechnicalAdmin;
/** Business failure surfaced by the BFF with a stable code; never a token or transport detail. */
export interface BusinessFailure {
  readonly code: string;
  readonly statusCode: number;
  readonly message: string;
}
export interface BusinessResult {
  readonly data?: unknown;
  readonly errors?: readonly BusinessFailure[];
}
/**
 * Evidence bytes go straight to the owner-authorized storage URL. The browser never receives
 * AWS credentials and never sends the Keycloak token to storage: this is the bounded, explicit
 * exception to the GraphQL business channel, and it carries bytes only.
 */
export interface EvidenceUploadTarget {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}
export interface EvidenceUploadOutcome {
  readonly completed: boolean;
  readonly status: number;
}
export interface SessionPort {
  snapshot(): Readonly<SessionSnapshot>;
  subscribe(listener: (snapshot: Readonly<SessionSnapshot>) => void): () => void;
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  requestTechnical(service: TechnicalService, resource: TechnicalResource): Promise<TechnicalResult>;
  /** Executes an allowlisted BFF GraphQL request with the RAM-only token; never exposes it. */
  requestBusiness(query: string, variables?: Readonly<Record<string, unknown>>): Promise<BusinessResult>;
  /** Transfers evidence bytes to an already authorized URL; attaches no token and decides nothing. */
  uploadEvidence(target: EvidenceUploadTarget, body: Blob | ArrayBuffer): Promise<EvidenceUploadOutcome>;
}
export interface IntegratedProps {
  domElement: HTMLElement;
  basePath: '/employees' | '/operations' | '/finance';
  assetBase: '/mfs/employees/' | '/mfs/operations/' | '/mfs/finance/';
  session: SessionPort;
}
