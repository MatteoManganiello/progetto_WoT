import { Simulation, SimulationState } from "../sim-state";
import {
  ActuatorSource,
  ComponentSource,
  EnergyStorageReading,
  PowerUnitReading,
  TwinSources
} from "./types";

/**
 * Adattatori sul modello di `sim-state`: proiettano lo stato globale della
 * simulazione sulla vista di ciascun componente, e restano il fallback quando
 * la parte reale non c'e'.
 *
 * La proiezione e' esplicita campo per campo: la lettura e' il contratto verso
 * il componente fisico, non deve seguire la forma interna del modello.
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
