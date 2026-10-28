import { BusinessError } from './business-error.js';

/** Only codes published by the operations contract may leave this BFF. */
const PUBLIC_CODES = new Set([
  'VALIDATION_ERROR',
  'CUSTOMER_NOT_FOUND',
  'VEHICLE_NOT_FOUND',
  'SERVICE_NOT_FOUND',
  'APPOINTMENT_NOT_FOUND',
  'RECEPTION_NOT_FOUND',
  'ORDER_NOT_FOUND',
  'VEHICLE_ALREADY_IN_RECEPTION',
  'MILEAGE_REGRESSION',
  'ORDER_ALREADY_EXISTS',
  'DUPLICATE_DOCUMENT',
  'DUPLICATE_PLATE',
  'DUPLICATE_SERVICE',
  'CUSTOMER_INACTIVE',
  'VEHICLE_INACTIVE',
  'VEHICLE_OWNERSHIP_MISMATCH',
  'SERVICE_INACTIVE',
  'APPOINTMENT_DUPLICATE',
  'APPOINTMENT_OVERLAP',
  'APPOINTMENT_NOT_SCHEDULED',
  'VEHICLE_HAS_SCHEDULED_APPOINTMENTS',
  'CUSTOMER_HAS_SCHEDULED_APPOINTMENTS',
  'WORKSHOP_CAPACITY_EXCEEDED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONCURRENT_OPERATION',
  'PERSISTENCE_UNAVAILABLE',
]);

export interface OperationsPageQuery {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
  customerId?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
  active?: boolean;
  open?: boolean;
}
export interface OperationsCommand {
  operationId: string;
  expectedVersion?: number;
  [field: string]: unknown;
}

/** Port to the Operations owner REST API. Never crosses into its database. */
export interface OperationsGateway {
  customers(query: OperationsPageQuery, token: string): Promise<unknown>;
  customer(id: string, token: string): Promise<unknown>;
  createCustomer(input: OperationsCommand, token: string): Promise<unknown>;
  updateCustomer(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  deactivateCustomer(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  vehicles(query: OperationsPageQuery, token: string): Promise<unknown>;
  vehicle(id: string, token: string): Promise<unknown>;
  createVehicle(input: OperationsCommand, token: string): Promise<unknown>;
  updateVehicle(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  deactivateVehicle(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  services(query: OperationsPageQuery, token: string): Promise<unknown>;
  service(id: string, token: string): Promise<unknown>;
  createService(input: OperationsCommand, token: string): Promise<unknown>;
  updateService(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  deactivateService(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  appointments(query: OperationsPageQuery, token: string): Promise<unknown>;
  appointment(id: string, token: string): Promise<unknown>;
  createAppointment(input: OperationsCommand, token: string): Promise<unknown>;
  rescheduleAppointment(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  cancelAppointment(id: string, input: OperationsCommand, token: string): Promise<unknown>;
  receptions(query: OperationsPageQuery, token: string): Promise<unknown>;
  reception(id: string, token: string): Promise<unknown>;
  createReception(input: OperationsCommand, token: string): Promise<unknown>;
  orders(query: OperationsPageQuery, token: string): Promise<unknown>;
  order(id: string, token: string): Promise<unknown>;
  createWorkOrder(input: OperationsCommand, token: string): Promise<unknown>;
}

export class HttpOperationsGateway implements OperationsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(path: string, token: string, init: RequestInit = {}, allowed = [200, 201]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
    const body = await this.payload(response);
    if (allowed.includes(response.status)) return body;
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'FORBIDDEN');
    if (response.status === 503) throw new BusinessError(503, 'PERSISTENCE_UNAVAILABLE');
    const candidate = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const code = candidate && PUBLIC_CODES.has(candidate) ? candidate : undefined;
    const statusCode = response.status === 400 || response.status === 404 || response.status === 409 ? response.status : 503;
    throw new BusinessError(
      statusCode,
      code ?? (statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'VERSION_CONFLICT' : statusCode === 400 ? 'VALIDATION_ERROR' : 'SERVICE_UNAVAILABLE'),
    );
  }

  private async payload(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private suffix(query: OperationsPageQuery): string {
    const parameters = new URLSearchParams();
    for (const key of ['limit', 'offset', 'status', 'search', 'customerId', 'vehicleId', 'from', 'to', 'active', 'open'] as const) {
      const value = query[key];
      if (value !== undefined && value !== null) parameters.set(key, String(value));
    }
    const serialized = parameters.toString();
    return serialized ? `?${serialized}` : '';
  }

  customers(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/customers' + this.suffix(query), token);
  }

  customer(id: string, token: string): Promise<unknown> {
    return this.request(`/customers/${encodeURIComponent(id)}`, token);
  }

  createCustomer(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/customers', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  updateCustomer(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/customers/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
  }

  deactivateCustomer(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/customers/${encodeURIComponent(id)}/deactivate`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  vehicles(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/vehicles' + this.suffix(query), token);
  }

  vehicle(id: string, token: string): Promise<unknown> {
    return this.request(`/vehicles/${encodeURIComponent(id)}`, token);
  }

  createVehicle(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/vehicles', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  updateVehicle(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/vehicles/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
  }

  deactivateVehicle(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/vehicles/${encodeURIComponent(id)}/deactivate`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  services(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/services' + this.suffix(query), token);
  }

  service(id: string, token: string): Promise<unknown> {
    return this.request(`/services/${encodeURIComponent(id)}`, token);
  }

  createService(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/services', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  updateService(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/services/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
  }

  deactivateService(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/services/${encodeURIComponent(id)}/deactivate`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  appointments(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/appointments' + this.suffix(query), token);
  }

  appointment(id: string, token: string): Promise<unknown> {
    return this.request(`/appointments/${encodeURIComponent(id)}`, token);
  }

  createAppointment(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/appointments', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  rescheduleAppointment(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/appointments/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
  }

  cancelAppointment(id: string, input: OperationsCommand, token: string): Promise<unknown> {
    return this.request(`/appointments/${encodeURIComponent(id)}/cancel`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  receptions(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/receptions' + this.suffix(query), token);
  }

  reception(id: string, token: string): Promise<unknown> {
    return this.request(`/receptions/${encodeURIComponent(id)}`, token);
  }

  createReception(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/receptions', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  orders(query: OperationsPageQuery, token: string): Promise<unknown> {
    return this.request('/orders' + this.suffix(query), token);
  }

  order(id: string, token: string): Promise<unknown> {
    return this.request(`/orders/${encodeURIComponent(id)}`, token);
  }

  createWorkOrder(input: OperationsCommand, token: string): Promise<unknown> {
    return this.request('/orders', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }
}
