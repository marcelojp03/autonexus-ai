import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import {
  APPOINTMENTS, CANCEL_APPOINTMENT, CREATE_APPOINTMENT, CREATE_CUSTOMER, CREATE_SERVICE, CREATE_VEHICLE,
  CUSTOMERS, DEACTIVATE_CUSTOMER, DEACTIVATE_SERVICE, DEACTIVATE_VEHICLE, RESCHEDULE_APPOINTMENT, SERVICES,
  UPDATE_CUSTOMER, UPDATE_SERVICE, UPDATE_VEHICLE, VEHICLES,
  type Appointment, type Customer, type Page, type ServiceItem, type Vehicle,
} from './operations.contract';

/** Failure with a stable code so screens can explain what happened. */
export class OperationsFailure extends Error {
  constructor(readonly failure: { code: string; statusCode: number; message: string }) {
    super(failure.message);
  }
}

const operation = () => globalThis.crypto.randomUUID();

@Injectable({ providedIn: 'root' })
export class OperationsApi {
  private readonly session = inject(SESSION_PORT);

  customers(query: Record<string, unknown>): Promise<Page<Customer>> {
    return this.run<{ customers: Page<Customer> }>(CUSTOMERS, query).then(data => data.customers);
  }

  createCustomer(input: Record<string, unknown>): Promise<Customer> {
    return this.run<{ createCustomer: { customer: Customer } }>(CREATE_CUSTOMER, { input: { operationId: operation(), ...input } })
      .then(data => data.createCustomer.customer);
  }

  updateCustomer(id: string, version: number, input: Record<string, unknown>): Promise<Customer> {
    return this.run<{ updateCustomer: { customer: Customer } }>(UPDATE_CUSTOMER, { id, input: { operationId: operation(), expectedVersion: version, ...input } })
      .then(data => data.updateCustomer.customer);
  }

  deactivateCustomer(id: string, version: number): Promise<Customer> {
    return this.run<{ deactivateCustomer: { customer: Customer } }>(DEACTIVATE_CUSTOMER, { id, input: { operationId: operation(), expectedVersion: version } })
      .then(data => data.deactivateCustomer.customer);
  }

  vehicles(query: Record<string, unknown>): Promise<Page<Vehicle>> {
    return this.run<{ vehicles: Page<Vehicle> }>(VEHICLES, query).then(data => data.vehicles);
  }

  createVehicle(input: Record<string, unknown>): Promise<Vehicle> {
    return this.run<{ createVehicle: { vehicle: Vehicle } }>(CREATE_VEHICLE, { input: { operationId: operation(), ...input } })
      .then(data => data.createVehicle.vehicle);
  }

  updateVehicle(id: string, version: number, input: Record<string, unknown>): Promise<Vehicle> {
    return this.run<{ updateVehicle: { vehicle: Vehicle } }>(UPDATE_VEHICLE, { id, input: { operationId: operation(), expectedVersion: version, ...input } })
      .then(data => data.updateVehicle.vehicle);
  }

  deactivateVehicle(id: string, version: number): Promise<Vehicle> {
    return this.run<{ deactivateVehicle: { vehicle: Vehicle } }>(DEACTIVATE_VEHICLE, { id, input: { operationId: operation(), expectedVersion: version } })
      .then(data => data.deactivateVehicle.vehicle);
  }

  services(query: Record<string, unknown>): Promise<Page<ServiceItem>> {
    return this.run<{ services: Page<ServiceItem> }>(SERVICES, query).then(data => data.services);
  }

  createService(input: Record<string, unknown>): Promise<ServiceItem> {
    return this.run<{ createService: { service: ServiceItem } }>(CREATE_SERVICE, { input: { operationId: operation(), ...input } })
      .then(data => data.createService.service);
  }

  updateService(id: string, version: number, input: Record<string, unknown>): Promise<ServiceItem> {
    return this.run<{ updateService: { service: ServiceItem } }>(UPDATE_SERVICE, { id, input: { operationId: operation(), expectedVersion: version, ...input } })
      .then(data => data.updateService.service);
  }

  deactivateService(id: string, version: number): Promise<ServiceItem> {
    return this.run<{ deactivateService: { service: ServiceItem } }>(DEACTIVATE_SERVICE, { id, input: { operationId: operation(), expectedVersion: version } })
      .then(data => data.deactivateService.service);
  }

  appointments(query: Record<string, unknown>): Promise<Page<Appointment>> {
    return this.run<{ appointments: Page<Appointment> }>(APPOINTMENTS, query).then(data => data.appointments);
  }

  createAppointment(input: Record<string, unknown>): Promise<Appointment> {
    return this.run<{ createAppointment: { appointment: Appointment } }>(CREATE_APPOINTMENT, { input: { operationId: operation(), ...input } })
      .then(data => data.createAppointment.appointment);
  }

  rescheduleAppointment(id: string, version: number, startsAt: string, notes?: string): Promise<Appointment> {
    return this.run<{ rescheduleAppointment: { appointment: Appointment } }>(RESCHEDULE_APPOINTMENT, {
      id, input: { operationId: operation(), expectedVersion: version, startsAt, notes },
    }).then(data => data.rescheduleAppointment.appointment);
  }

  cancelAppointment(id: string, version: number, reason: string): Promise<Appointment> {
    return this.run<{ cancelAppointment: { appointment: Appointment } }>(CANCEL_APPOINTMENT, {
      id, input: { operationId: operation(), expectedVersion: version, reason },
    }).then(data => data.cancelAppointment.appointment);
  }

  private async run<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T> {
    if (!this.session) throw new OperationsFailure({ code: 'NO_SESSION_PORT', statusCode: 401, message: 'Esta vista requiere la sesión del Shell.' });
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new OperationsFailure(result.errors[0]);
    if (!result.data) throw new OperationsFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'El servicio de operaciones no está disponible.' });
    return result.data as T;
  }
}

const FAILURES: Readonly<Record<string, string>> = Object.freeze({
  FORBIDDEN: 'No tenés permiso para esta operación.',
  VALIDATION_ERROR: 'Revisá los datos: hay un campo inválido.',
  DUPLICATE_DOCUMENT: 'Ya existe un cliente con ese documento.',
  DUPLICATE_PLATE: 'Ya existe un vehículo con esa placa.',
  DUPLICATE_SERVICE: 'Ya existe un servicio con ese nombre.',
  CUSTOMER_NOT_FOUND: 'El cliente no existe.',
  VEHICLE_NOT_FOUND: 'El vehículo no existe.',
  SERVICE_NOT_FOUND: 'El servicio no existe.',
  APPOINTMENT_NOT_FOUND: 'La cita no existe.',
  CUSTOMER_INACTIVE: 'El cliente está inactivo.',
  VEHICLE_INACTIVE: 'El vehículo está inactivo.',
  SERVICE_INACTIVE: 'El servicio está inactivo.',
  VEHICLE_OWNERSHIP_MISMATCH: 'El vehículo no pertenece al cliente seleccionado.',
  APPOINTMENT_OVERLAP: 'El vehículo ya tiene una cita en esa franja.',
  APPOINTMENT_DUPLICATE: 'Esa cita ya está registrada.',
  APPOINTMENT_NOT_SCHEDULED: 'La cita ya no está programada.',
  WORKSHOP_CAPACITY_EXCEEDED: 'El taller no tiene capacidad en esa franja.',
  VERSION_CONFLICT: 'Otra persona modificó el registro; recargá y reintentá.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible en este momento.',
});

export const explain = (error: unknown): string => {
  const failure = error as OperationsFailure;
  return FAILURES[failure?.failure?.code ?? ''] ?? failure?.message ?? 'No se pudo completar la operación.';
};
