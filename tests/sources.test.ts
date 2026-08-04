import assert from "node:assert/strict";
import { createSimulation } from "../src/sim-state";
import {
  ActuatorDeviceSource,
  DeviceSource,
  EnergyStorageReading,
  createSimulatedSources,
  parseRealComponents
} from "../src/sources";
import { suite, test } from "./harness";

/**
 * SEPARAZIONE FRA PARTE DIGITALE E PARTE FISICA.
 *
 * Verifica la proprieta' che qualifica un gemello digitale: continuare a
 * funzionare qualunque sia la combinazione di componenti reali presenti nel
 * sistema, e degradare sulla simulazione quando la parte reale tace.
 *
 * I test non usano MQTT: la logica di sostituzione vive in `DeviceSource`, che
 * e' agnostica rispetto al trasporto. L'orologio e' iniettato, cosi' la
 * scadenza delle misure e' verificabile senza attese reali.
 */
export const run = () => {
  suite("Sostituzione fra componenti simulati e reali");

  test("senza componenti reali il gemello e' interamente simulato", () => {
    const sources = createSimulatedSources(createSimulation());

    assert.equal(sources.powerUnit.origin(), "simulated");
    assert.equal(sources.energyStorage.origin(), "simulated");
    assert.equal(sources.controlActuator.origin(), "simulated");
    assert.equal(typeof sources.energyStorage.snapshot().batterySoH, "number");
  });

  test("una misura reale fresca prevale sul modello", () => {
    const simulation = createSimulation();
    const simulated = createSimulatedSources(simulation).energyStorage;
    let now = 1_000;
    const device = new DeviceSource<EnergyStorageReading>("energyStorage", simulated, {
      stalenessMs: 5_000,
      now: () => now
    });

    assert.equal(device.origin(), "simulated", "prima di ogni misura resta il modello");

    device.accept({ batterySoH: 81.5 });
    assert.equal(device.origin(), "real");
    assert.equal(device.snapshot().batterySoH, 81.5);
  });

  test("una misura parziale copre solo le grandezze che dichiara", () => {
    const simulation = createSimulation();
    const simulated = createSimulatedSources(simulation).energyStorage;
    const device = new DeviceSource<EnergyStorageReading>("energyStorage", simulated);

    device.accept({ batterySoH: 81.5 });
    const snapshot = device.snapshot();

    assert.equal(snapshot.batterySoH, 81.5, "grandezza misurata dal dispositivo");
    assert.equal(
      snapshot.voltageV,
      simulated.snapshot().voltageV,
      "grandezza non misurata: resta stimata dal modello"
    );
  });

  test("se il dispositivo tace, il gemello torna alla simulazione", () => {
    const simulation = createSimulation();
    const simulated = createSimulatedSources(simulation).energyStorage;
    let now = 1_000;
    const device = new DeviceSource<EnergyStorageReading>("energyStorage", simulated, {
      stalenessMs: 5_000,
      now: () => now
    });

    device.accept({ batterySoH: 81.5 });
    assert.equal(device.origin(), "real");

    now += 5_001;
    assert.equal(device.origin(), "simulated", "la misura e' scaduta");
    assert.equal(
      device.snapshot().batterySoH,
      simulated.snapshot().batterySoH,
      "il gemello continua a rispondere con il valore del modello"
    );

    // Il dispositivo torna a pubblicare: riallineamento senza intervento.
    device.accept({ batterySoH: 80.9 });
    assert.equal(device.origin(), "real");
    assert.equal(device.snapshot().batterySoH, 80.9);
  });

  test("i comandi raggiungono il dispositivo reale e restano allineati al modello", () => {
    const simulation = createSimulation();
    const simulated = createSimulatedSources(simulation).controlActuator;
    const sent: Array<{ name: string; value: unknown }> = [];
    const device = new ActuatorDeviceSource("controlActuator", simulated, (name, value) =>
      sent.push({ name, value })
    );

    device.setDriveMode("Sport");
    device.setRegenIntensity(2);

    assert.deepEqual(sent, [
      { name: "setDriveMode", value: "Sport" },
      { name: "triggerRegen", value: 2 }
    ]);
    assert.equal(simulation.state.driveMode, "Sport", "il fallback resta allineato");
    assert.equal(simulation.state.regenIntensity, 2);
  });

  test("REAL_COMPONENTS accetta i nomi validi e scarta gli altri", () => {
    assert.deepEqual(parseRealComponents(undefined), []);
    assert.deepEqual(parseRealComponents(""), []);
    assert.deepEqual(parseRealComponents("energyStorage"), ["energyStorage"]);
    assert.deepEqual(parseRealComponents(" energystorage , powerUnit "), [
      "energyStorage",
      "powerUnit"
    ]);
    assert.deepEqual(parseRealComponents("turbocompressore"), [], "nome sconosciuto ignorato");
  });
};
