import { Simulation, SimulationState } from "../sim-state";
import {
  ActuatorSource,
  ComponentSource,
  EnergyStorageReading,
  PowerUnitReading,
  TwinSources
} from "./types";

/**
 * SORGENTI SIMULATE.
 *
 * Adattatori sottili sul modello fisico di `sim-state`: proiettano lo stato
 * globale della simulazione sulla vista di ciascun componente. Sono la parte
 * "digitale pura" del gemello e restano il fallback quando la parte reale
 * non e' presente.
 *
 * La proiezione resta esplicita, campo per campo: le letture sono il contratto
 * del componente fisico e non devono dipendere dalla forma interna del modello.
 */
const project = <TReading>(
  component: string,
  simulation: Simulation,
  view: (state: SimulationState) => TReading
): ComponentSource<TReading> => ({
  component,
  origin: () => "simulated",
  snapshot: () => view(simulation.state)
});

export const createSimulatedPowerUnit = (simulation: Simulation) =>
  project<PowerUnitReading>("powerUnit", simulation, (state) => ({
    batterySoC: state.batterySoC,
    engineRPM: state.engineRPM,
    torqueNm: state.torqueNm,
    temperatureC: state.temperatureC,
    systemEfficiency: state.systemEfficiency,
    estimatedRangeKm: state.estimatedRangeKm,
    thermalHealth: state.thermalHealth,
    engineStatus: state.engineStatus,
    speedKmh: state.speedKmh
  }));

export const createSimulatedEnergyStorage = (simulation: Simulation) =>
  project<EnergyStorageReading>("energyStorage", simulation, (state) => ({
    batterySoC: state.batterySoC,
    batterySoH: state.batterySoH,
    voltageV: state.voltageV,
    currentA: state.currentA,
    temperatureC: state.temperatureC
  }));

export const createSimulatedControlActuator = (simulation: Simulation): ActuatorSource => ({
  ...project("controlActuator", simulation, (state) => ({
    driveMode: state.driveMode,
    regenIntensity: state.regenIntensity
  })),
  setDriveMode: simulation.setDriveMode,
  setRegenIntensity: simulation.setRegenIntensity
});

/** Configurazione di default: gemello interamente simulato. */
export const createSimulatedSources = (simulation: Simulation): TwinSources => ({
  powerUnit: createSimulatedPowerUnit(simulation),
  energyStorage: createSimulatedEnergyStorage(simulation),
  controlActuator: createSimulatedControlActuator(simulation)
});
