/** Operations web contract: CU06, CU07, CU09 and CU10 through the BFF. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  document: string;
  phone: string;
  email: string | null;
  address: string | null;
  status: 'active' | 'inactive';
  version: number;
}
export interface Vehicle {
  id: string;
  customerId: string;
  customerName: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  fuelType: 'gasolina' | 'diesel' | 'gas' | 'electrico' | 'hibrido';
  color: string | null;
  status: 'active' | 'inactive';
  version: number;
}
export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  category: 'mantenimiento' | 'reparacion' | 'diagnostico' | 'otros';
  estimatedMinutes: number;
  referenceRate: number;
  active: boolean;
  version: number;
}
export interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  vehicleId: string;
  vehiclePlate: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'cancelled';
  notes: string | null;
  cancelReason: string | null;
  version: number;
}

const CUSTOMER = 'id firstName lastName document phone email address status version';
const VEHICLE = 'id customerId customerName plate make model year fuelType color status version';
const SERVICE = 'id name description category estimatedMinutes referenceRate active version';
const APPOINTMENT = 'id customerId customerName vehicleId vehiclePlate serviceId serviceName startsAt endsAt status notes cancelReason version';

export const CUSTOMERS = `query Customers($limit: Int, $offset: Int, $status: CustomerStatus, $search: String) {
  customers(limit: $limit, offset: $offset, status: $status, search: $search) { items { ${CUSTOMER} } total limit offset }
}`;
export const CREATE_CUSTOMER = `mutation CreateCustomer($input: CreateCustomerInput!) { createCustomer(input: $input) { customer { ${CUSTOMER} } replayed } }`;
export const UPDATE_CUSTOMER = `mutation UpdateCustomer($id: UUID!, $input: UpdateCustomerInput!) { updateCustomer(id: $id, input: $input) { customer { ${CUSTOMER} } replayed } }`;
export const DEACTIVATE_CUSTOMER = `mutation DeactivateCustomer($id: UUID!, $input: OperationsCommandInput!) { deactivateCustomer(id: $id, input: $input) { customer { ${CUSTOMER} } replayed } }`;

export const VEHICLES = `query Vehicles($limit: Int, $offset: Int, $status: VehicleStatus, $customerId: UUID, $search: String) {
  vehicles(limit: $limit, offset: $offset, status: $status, customerId: $customerId, search: $search) { items { ${VEHICLE} } total limit offset }
}`;
export const CREATE_VEHICLE = `mutation CreateVehicle($input: CreateVehicleInput!) { createVehicle(input: $input) { vehicle { ${VEHICLE} } replayed } }`;
export const UPDATE_VEHICLE = `mutation UpdateVehicle($id: UUID!, $input: UpdateVehicleInput!) { updateVehicle(id: $id, input: $input) { vehicle { ${VEHICLE} } replayed } }`;
export const DEACTIVATE_VEHICLE = `mutation DeactivateVehicle($id: UUID!, $input: OperationsCommandInput!) { deactivateVehicle(id: $id, input: $input) { vehicle { ${VEHICLE} } replayed } }`;

export const SERVICES = `query Services($limit: Int, $offset: Int, $active: Boolean, $search: String) {
  services(limit: $limit, offset: $offset, active: $active, search: $search) { items { ${SERVICE} } total limit offset }
}`;
export const CREATE_SERVICE = `mutation CreateService($input: CreateServiceInput!) { createService(input: $input) { service { ${SERVICE} } replayed } }`;
export const UPDATE_SERVICE = `mutation UpdateService($id: UUID!, $input: UpdateServiceInput!) { updateService(id: $id, input: $input) { service { ${SERVICE} } replayed } }`;
export const DEACTIVATE_SERVICE = `mutation DeactivateService($id: UUID!, $input: OperationsCommandInput!) { deactivateService(id: $id, input: $input) { service { ${SERVICE} } replayed } }`;

export const APPOINTMENTS = `query Appointments($limit: Int, $offset: Int, $from: DateTime, $to: DateTime, $status: AppointmentStatus) {
  appointments(limit: $limit, offset: $offset, from: $from, to: $to, status: $status) { items { ${APPOINTMENT} } total limit offset }
}`;
export const CREATE_APPOINTMENT = `mutation CreateAppointment($input: CreateAppointmentInput!) { createAppointment(input: $input) { appointment { ${APPOINTMENT} } replayed } }`;
export const RESCHEDULE_APPOINTMENT = `mutation RescheduleAppointment($id: UUID!, $input: RescheduleAppointmentInput!) { rescheduleAppointment(id: $id, input: $input) { appointment { ${APPOINTMENT} } replayed } }`;
export const CANCEL_APPOINTMENT = `mutation CancelAppointment($id: UUID!, $input: CancelAppointmentInput!) { cancelAppointment(id: $id, input: $input) { appointment { ${APPOINTMENT} } replayed } }`;

export const FUEL_TYPES: ReadonlyArray<{ value: Vehicle['fuelType']; label: string }> = Object.freeze([
  { value: 'gasolina', label: 'Gasolina' },
  { value: 'diesel', label: 'Diésel' },
  { value: 'gas', label: 'Gas' },
  { value: 'electrico', label: 'Eléctrico' },
  { value: 'hibrido', label: 'Híbrido' },
]);
export const CATEGORIES: ReadonlyArray<{ value: ServiceItem['category']; label: string }> = Object.freeze([
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'reparacion', label: 'Reparación' },
  { value: 'diagnostico', label: 'Diagnóstico' },
  { value: 'otros', label: 'Otros' },
]);

/** Workshop zone: America/La_Paz, UTC-4 without daylight saving. */
export const WORKSHOP_OFFSET = '-04:00';

/** `datetime-local` value -> ISO-8601 with the workshop offset. */
export const toWorkshopIso = (local: string): string => (local.length === 16 ? `${local}:00${WORKSHOP_OFFSET}` : local);

/** ISO instant -> local `datetime-local` value for edit forms. */
export const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
};

export const localDate = (value: string): string => toLocalInput(value).slice(0, 10);
export const localTime = (value: string): string => toLocalInput(value).slice(11, 16);
