import assert from "node:assert/strict";
import { DRIVE_MODES, createSimulation } from "../src/sim-state";
import { suite, test } from "./harness";

export const run = () => {
  suite("Modello fisico (banco prova e fallback del gemello)");

  test("stato iniziale coerente", () => {
    const simulation = createSimulation();
    assert.equal(simulation.state.controlMode, "Manual");
    assert.equal(simulation.state.regenMode, "Manual");
    assert.ok(DRIVE_MODES.includes(simulation.state.driveMode));
  });

  test("il cambio modalita' manuale riporta il controllo all'utente", () => {
    const simulation = createSimulation();
    simulation.setControlMode("Auto");
    simulation.setDriveMode("Sport");

    assert.equal(simulation.state.driveMode, "Sport");
    assert.equal(simulation.state.controlMode, "Manual");
  });

  test("il cambio modalita' automatico non tocca il modo di controllo", () => {
    const simulation = createSimulation();
    simulation.setControlMode("Auto");
    simulation.setDriveMode("Save", "auto");

    assert.equal(simulation.state.driveMode, "Save");
    assert.equal(simulation.state.controlMode, "Auto");
  });

  test("la rigenerazione resta nell'intervallo dichiarato dalla TD", () => {
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
  });

  test("applyExternal riallinea il modello a una misura reale", () => {
    const simulation = createSimulation();
    simulation.update();

    simulation.applyExternal({ batterySoC: 33, temperatureC: 88 });

    assert.equal(simulation.state.batterySoC, 33);
    assert.equal(simulation.state.temperatureC, 88);

    simulation.update();
    assert.ok(
      Math.abs(simulation.state.batterySoC - 33) < 3,
      "dopo il riallineamento il modello prosegue dal valore reale"
    );
  });
};
