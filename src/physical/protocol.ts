/**
 * Contratto di comunicazione fra la PARTE FISICA e la PARTE DIGITALE.
 *
 * Questo file e' l'unico punto di contatto fra i due mondi: un dispositivo reale
 * e un dispositivo simulato sono intercambiabili purche' rispettino questi topic
 * e questi payload. Il gemello digitale non sa (e non deve sapere) quale dei due
 * si trova dall'altra parte del broker.
 */

export const DEVICE_IDS = ["powerunit", "battery", "actuator"] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

const NAMESPACE = "pad/physical";

/** Il dispositivo pubblica qui le sue misure. */
export const telemetryTopic = (deviceId: DeviceId) => `${NAMESPACE}/${deviceId}/telemetry`;

/** Il gemello digitale pubblica qui i comandi diretti al dispositivo. */
export const commandTopic = (deviceId: DeviceId) => `${NAMESPACE}/${deviceId}/command`;

/** Topic wildcard usato dal gemello per ascoltare tutti i dispositivi. */
export const TELEMETRY_WILDCARD = `${NAMESPACE}/+/telemetry`;

export const deviceFromTopic = (topic: string): DeviceId | undefined => {
  const segments = topic.split("/");
  const candidate = segments[2];
  return (DEVICE_IDS as readonly string[]).includes(candidate) ? (candidate as DeviceId) : undefined;
};

export type EngineStatusReading = "Off" | "Idle" | "Running";
export type DriveModeReading = "Full Electric" | "Hybrid" | "Sport" | "Save";

export type PowerUnitReadings = {
  engineRPM: number;
  torqueNm: number;
  temperatureC: number;
  speedKmh: number;
  engineStatus: EngineStatusReading;
  distanceKm: number;
  energyUsedKwh: number;
};

export type BatteryReadings = {
  batterySoC: number;
  batterySoH: number;
  voltageV: number;
  currentA: number;
  temperatureC: number;
};

export type ActuatorReadings = {
  driveMode: DriveModeReading;
  regenIntensity: number;
};

export type ReadingsFor<D extends DeviceId> = D extends "powerunit"
  ? PowerUnitReadings
  : D extends "battery"
    ? BatteryReadings
    : ActuatorReadings;

export type DeviceTelemetry<D extends DeviceId = DeviceId> = {
  deviceId: D;
  /** ISO 8601, generato dal dispositivo: e' il timestamp della misura, non della ricezione. */
  timestamp: string;
  /** Contatore progressivo del dispositivo, utile a scartare pacchetti fuori ordine. */
  seq: number;
  readings: ReadingsFor<D>;
};

export type DeviceCommand =
  | { command: "setDriveMode"; value: DriveModeReading; issuedAt: string }
  | { command: "triggerRegen"; value: number; issuedAt: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Validazione difensiva: la telemetria arriva da un processo esterno (o da hardware
 * reale) e non ci si puo' fidare della sua forma.
 */
export const parseTelemetry = (raw: unknown): DeviceTelemetry | undefined => {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const message = raw as Partial<DeviceTelemetry>;
  if (!(DEVICE_IDS as readonly string[]).includes(String(message.deviceId))) {
    return undefined;
  }
  if (typeof message.timestamp !== "string" || Number.isNaN(Date.parse(message.timestamp))) {
    return undefined;
  }
  if (typeof message.readings !== "object" || message.readings === null) {
    return undefined;
  }
  return {
    deviceId: message.deviceId as DeviceId,
    timestamp: message.timestamp,
    seq: isFiniteNumber(message.seq) ? message.seq : 0,
    readings: message.readings as ReadingsFor<DeviceId>
  };
};

export const parseCommand = (raw: unknown): DeviceCommand | undefined => {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const message = raw as Partial<DeviceCommand>;
  if (message.command === "setDriveMode" && typeof message.value === "string") {
    return { command: "setDriveMode", value: message.value as DriveModeReading, issuedAt: String(message.issuedAt ?? new Date().toISOString()) };
  }
  if (message.command === "triggerRegen" && isFiniteNumber(message.value)) {
    return { command: "triggerRegen", value: message.value, issuedAt: String(message.issuedAt ?? new Date().toISOString()) };
  }
  return undefined;
};
