export interface BuildingConfig {
  floors: number;
  aptsPerFloor: number;
  maxKeysOut?: number;
  updatedAt: string;
}

export type VisitorType = "Resident" | "Renovation Company";

export interface KeyStatus {
  apartmentId: string;
  isOut: boolean;
  currentHolder?: string;
  holderType?: VisitorType;
  outAt?: string;
  returnDeadline?: string;
  lastReturnedAt?: string;
}

export type LogType = "Checkout" | "Checkin";

export interface KeyLog {
  id: string;
  apartmentId: string;
  holder: string;
  holderType: VisitorType;
  type: LogType;
  timestamp: string;
}

export type VisitStatus = "Scheduled" | "Completed" | "Cancelled";

export interface Visit {
  id: string;
  apartmentId: string;
  visitorName: string;
  visitorType: VisitorType;
  scheduledAt: string;
  status: VisitStatus;
  notes?: string;
}

export interface Admin {
  id: string;
  email: string;
  name?: string;
  addedAt: string;
  addedBy: string;
}
