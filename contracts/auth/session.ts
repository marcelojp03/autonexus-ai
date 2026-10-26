/** CU01 client composition contract. Types only: no token storage or business policy. */
export type WorkshopRole = 'administrador' | 'recepcionista' | 'mecanico' | 'jefe_taller' | 'responsable_financiero';
export type TechnicalService = 'operations' | 'employees';
export type TechnicalResource = 'session' | 'admin';
export interface SessionIdentity { readonly subject: string; readonly username: string; readonly roles: readonly WorkshopRole[]; }
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
export interface SessionPort {
  snapshot(): Readonly<SessionSnapshot>;
  subscribe(listener: (snapshot: Readonly<SessionSnapshot>) => void): () => void;
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  requestTechnical(service: TechnicalService, resource: TechnicalResource): Promise<TechnicalResult>;
}
export interface IntegratedProps {
  domElement: HTMLElement;
  basePath: '/employees' | '/operations';
  assetBase: '/mfs/employees/' | '/mfs/operations/';
  session: SessionPort;
}
