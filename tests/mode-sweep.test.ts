import assert from "node:assert/strict";
import { DRIVE_MODES, DriveMode, createSimulation } from "../src/sim-state";
import { suite, test } from "./harness";

/**
 * SIMULAZIONI PARAMETRICHE PER MODALITA' DI GUIDA.
 *
 * 120 cicli da 2 s corrispondono a circa 4 minuti di simulazione. I primi cicli
 * sono di assestamento della media mobile e non entrano nella misura: e' il
 * transitorio d'avvio che il filtro esponenziale ha il compito di assorbire.
 */
const CYCLES = 120;
const WARMUP_CYCLES = 30;

/** Bande di efficienza attese, in km/kWh. */
const EXPECTED_EFFICIENCY: Record<DriveMode, [number, number]> = {
  "Save": [6.2, 10.0],
  "Hybrid": [4.4, 5.8],
  "Full Electric": [2.8, 5.4],
  "Sport": [2.9, 5.1]
};

type SweepResult = {
  minEfficiency: number;
  maxEfficiency: number;
  maxTemperatureC: number;
  minRangeKm: number;
  finalSoC: number;
  overheatEvents: number;
  lowEnergyEvents: number;
  anomalyEvents: number;
};

export const sweepMode = (mode: DriveMode, cycles = CYCLES): SweepResult => {
  const simulation = createSimulation();
  simulation.setDriveMode(mode);

  const result: SweepResult = {
    minEfficiency: Infinity,
    maxEfficiency: -Infinity,
    maxTemperatureC: -Infinity,
    minRangeKm: Infinity,
    finalSoC: 0,
    overheatEvents: 0,
    lowEnergyEvents: 0,
    anomalyEvents: 0
  };

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const events = simulation.update();
    if (cycle > WARMUP_CYCLES) {
      result.minEfficiency = Math.min(result.minEfficiency, simulation.state.systemEfficiency);
      result.maxEfficiency = Math.max(result.maxEfficiency, simulation.state.systemEfficiency);
    }
    result.maxTemperatureC = Math.max(result.maxTemperatureC, simulation.state.temperatureC);
    result.minRangeKm = Math.min(result.minRangeKm, simulation.state.estimatedRangeKm);
    if (events.criticalOverheat) {
      result.overheatEvents += 1;
    }
    if (events.lowEnergyWarning) {
      result.lowEnergyEvents += 1;
    }
    if (events.anomalyDetected) {
      result.anomalyEvents += 1;
    }
  }

  result.finalSoC = simulation.state.batterySoC;
  return result;
};

export const run = () => {
  suite("Simulazioni parametriche per modalita' di guida (120 cicli)");

  for (const mode of DRIVE_MODES) {
    const [low, high] = EXPECTED_EFFICIENCY[mode];
    test(`${mode}: efficienza fra ${low} e ${high} km/kWh`, () => {
      const result = sweepMode(mode);
      assert.ok(
        result.minEfficiency >= low && result.maxEfficiency <= high,
        `misurato ${result.minEfficiency.toFixed(1)} - ${result.maxEfficiency.toFixed(1)} km/kWh`
      );
    });
  }

  test("Save: massima efficienza e sistema stabile", () => {
    const save = sweepMode("Save");
    const hybrid = sweepMode("Hybrid");

    assert.ok(save.minEfficiency > hybrid.maxEfficiency, "Save e' la modalita' piu' efficiente");
    assert.equal(save.overheatEvents, 0, "nessun surriscaldamento");
    assert.equal(save.lowEnergyEvents, 0, "nessun avviso di autonomia");
    assert.equal(save.anomalyEvents, 0, "nessun falso positivo di anomalia");
  });

  test("Full Electric: scarica la batteria piu' rapidamente di Hybrid", () => {
    assert.ok(sweepMode("Full Electric").finalSoC < sweepMode("Hybrid").finalSoC);
  });

  test("Sport: surriscaldamento, l'evento criticalOverheat viene attivato", () => {
    const sport = sweepMode("Sport");
    assert.ok(sport.maxTemperatureC > 90, `temperatura massima ${sport.maxTemperatureC.toFixed(1)} C`);
    assert.ok(sport.overheatEvents > 0, "l'evento di surriscaldamento scatta");
  });

  test("STRESS_MODE porta la temperatura alla soglia massima di 120 C", () => {
    const previous = process.env.STRESS_MODE;
    process.env.STRESS_MODE = "true";
    try {
      const stressed = sweepMode("Sport");
      assert.equal(stressed.maxTemperatureC, 120, "la temperatura raggiunge il limite del modello");
      assert.ok(stressed.overheatEvents > 1, "l'evento di surriscaldamento si ripete");
      assert.ok(stressed.lowEnergyEvents > 0, "la scarica progressiva genera l'avviso di bassa autonomia");
    } finally {
      if (previous === undefined) {
        delete process.env.STRESS_MODE;
      } else {
        process.env.STRESS_MODE = previous;
      }
    }
  });
};
