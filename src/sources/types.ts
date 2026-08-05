import { DriveMode, EngineStatus } from "../sim-state";

/**
 * Contratti a cui il livello WoT si appoggia, cosi' non deve sapere se un
 * componente e' simulato o reale. Una porta per componente, in modo da poter
 * rendere reale il solo pacco batteria lasciando simulato il resto.
 */

export type PowerUnitReading = {
  batterySoC: number;
  engineRPM: number;
  torqueNm: number;
  temperatureC: number;
  systemEfficiency: number;
  estimatedRangeKm: number;
  thermalHealth: number;
  engineStatus: EngineStatus;
  speedKmh: number;
};

export type EnergyStorageReading = {
  batterySoC: number;
  batterySoH: number;
  voltageV: number;
  currentA: number;
  temperatureC: number;
};

export type ControlActuatorReading = {
  driveMode: DriveMode;
  regenIntensity: number;
};

/** Da dove proviene il dato restituito in questo istante. */
export type SourceKind = "simulated" | "real";

/**
 * `snapshot()` e' sincrona di proposito: restituisce l'ultimo stato noto senza
 * I/O, cosi' una lettura non resta appesa in attesa di un dispositivo che non
 * risponde. A dire se il dato e' misurato o stimato ci pensa `origin()`.
 */
export interface ComponentSource<TReading> {
  readonly component: string;
  origin(): SourceKind;
  snapshot(): TReading;
}

/** Sorgente attuabile: aggiunge il canale digitale -> fisico. */
export interface ActuatorSource extends ComponentSource<ControlActuatorReading> {
  setDriveMode(mode: DriveMode): void;
  setRegenIntensity(intensity: number): void;
}

/** L'insieme delle sorgenti da cui il gemello compone il proprio stato. */
export type TwinSources = {
  powerUnit: ComponentSource<PowerUnitReading>;
  energyStorage: ComponentSource<EnergyStorageReading>;
  controlActuator: ActuatorSource;
};

/** Nomi dei componenti sostituibili, usati da `REAL_COMPONENTS`. */
export const COMPONENT_NAMES = ["powerUnit", "energyStorage", "controlActuator"] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];
