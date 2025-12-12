export enum ShipmentStatus {
  PLANNED = 'PLANNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  DELAYED = 'DELAYED',
  AT_RISK = 'AT_RISK',
}

export interface Shipment {
  shipment_id: string;
  origin_city: string;
  destination_city: string;
  status: ShipmentStatus;
  carrier_name: string;
  carrier_email: string;
  truck_id: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  eta_utc: string;
  sla_utc: string;
  notes: string;
  customer_name: string;
  customer_email: string;
}

export interface LogisticsStats {
  total: number;
  onTime: number;
  atRisk: number;
  delayed: number;
}