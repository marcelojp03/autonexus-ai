export interface IdentityDesired {
  employeeId: string;
  subject: string | null;
  firstName: string;
  lastName: string;
  email: string;
  enabled: boolean;
}
export interface IdentityGateway {
  sync(desired: IdentityDesired): Promise<string>;
}
export class IdentitySyncError extends Error {
  constructor(
    readonly code: string,
    readonly conflict = false,
  ) {
    super(code);
  }
}
