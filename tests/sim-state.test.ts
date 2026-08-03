import assert from "node:assert/strict";
import { DRIVE_MODES, createSimulation } from "../src/sim-state";
import { suite, test } from "./harness";

export const run = () => {
  suite("Modello di simulazione");

  test("stato iniziale coerente", () => {
    const simulation = createSimulation();
    assert.ok(DRIVE_MODES.includes(simulation.state.driveMode));
    assert.equal(simulation.state.regenIntensity, 0);
    assert.ok(simulation.state.batterySoC > 0 && simulation.state.batterySoC <= 100);
  });

  test("il cambio di modalita' e' una variabile di controllo del modello", () => {
    const simulation = createSimulation();
    simulation.setDriveMode("Sport");
    assert.equal(simulation.state.driveMode, "Sport");
  });

  test("la rigenerazione resta nell'intervallo 1-3 dichiarato dalla TD", () => {
    const simulation = createSimulation();
    simulation.setRegenIntensity(3);
    assert.equal(simulation.state.regenIntensity, 3);

    simulation.setRegenIntensity(99);
    assert.equal(simulation.state.regenIntensity, 3);

    simulation.setRegenIntensity(Number.NaN);
    assert.equal(simulation.state.regenIntensity, 3, "un valore non numerico non altera lo stato");
  });

  test("il modello resta entro limiti fisici plausibili", () => {
    const simulation = createSimulation();
    for (let i = 0; i < 200; i += 1) {
      simulation.update();
    }

    assert.ok(simulation.state.batterySoC >= 0 && simulation.state.batterySoC <= 100);
    assert.ok(simulation.state.temperatureC >= 32 && simulation.state.temperatureC <= 120);
    assert.ok(simulation.state.thermalHealth >= 0 && simulation.state.thermalHealth <= 100);
    assert.ok(simulation.state.engineRPM >= 0);
    assert.ok(simulation.state.batterySoH >= 70 && simulation.state.batterySoH <= 100);
  });

  test("la frenata rigenerativa recupera carica in decelerazione", () => {
    const withRegen = createSimulation();
    const withoutRegen = createSimulation();
    withRegen.setRegenIntensity(3);

    for (let i = 0; i < 60; i += 1) {
      withRegen.update();
      withoutRegen.update();
    }

    assert.ok(
      withRegen.state.batterySoC > withoutRegen.state.batterySoC,
      "con rigenerazione attiva il consumo netto e' inferiore"
    );
  });

  test("lo stress termico accelera l'usura del pacco batteria", () => {
    const simulation = createSimulation();
    simulation.setDriveMode("Sport");
    for (let i = 0; i < 120; i += 1) {
      simulation.update();
    }

    assert.ok(simulation.state.temperatureC > 90, "in Sport il propulsore supera la soglia critica");
    assert.ok(simulation.state.batterySoH < 96, "il SoH degrada sotto stress termico");
  });

  test("l'efficienza filtrata con EMA non ha transitori all'avvio", () => {
    const simulation = createSimulation();

    let maxStep = 0;
    let previous = simulation.state.systemEfficiency;
    for (let i = 0; i < 60; i += 1) {
      simulation.update();
      maxStep = Math.max(maxStep, Math.abs(simulation.state.systemEfficiency - previous));
      previous = simulation.state.systemEfficiency;
    }

    assert.ok(maxStep < 1, `la EMA non produce salti bruschi (max ${maxStep.toFixed(2)} km/kWh)`);
    assert.ok(simulation.state.systemEfficiency > 0);
  });

  test("in condizioni nominali non si osservano falsi positivi sulle anomalie", () => {
    const simulation = createSimulation();
    let anomalies = 0;
    for (let i = 0; i < 120; i += 1) {
      if (simulation.update().anomalyDetected) {
        anomalies += 1;
      }
    }
    assert.equal(anomalies, 0, "in modalita' Hybrid nominale l'evento di anomalia non scatta");
  });
};
