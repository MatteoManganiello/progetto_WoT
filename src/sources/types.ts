import { DriveMode, EngineStatus } from "../sim-state";

/**
 * PORTE DEL GEMELLO DIGITALE.
 *
 * Il livello WoT non deve sapere se un componente e' simulato o reale: dipende
 * solo da questi contratti. Ogni componente fisico ha la sua porta, cosi' la
 * sostituzione e' granulare — si puo' rendere reale il solo pacco batteria
 * lasciando simulato tutto il resto.
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
 * Sorgente di un componente del gemello.
 *
 * `snapshot()` e' sincrona di proposito: restituisce l'ultimo stato noto, senza
 * I/O. Un gemello digitale deve saper rispondere sempre, anche quando la parte
 * reale tace; e' `origin()` a dichiarare se il dato e' misurato o simulato.
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
