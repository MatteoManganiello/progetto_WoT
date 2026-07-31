import assert from "node:assert/strict";
import { createTwinRegistry } from "../src/twin/registry";
import { DeviceId, DeviceTelemetry } from "../src/physical/protocol";
import { createClock, suite, test } from "./harness";

const batteryTelemetry = (soc: number, seq: number, at: number): DeviceTelemetry => ({
  deviceId: "battery",
  timestamp: new Date(at).toISOString(),
  seq,
  readings: { batterySoC: soc, batterySoH: 99, voltageV: 383, currentA: 11, temperatureC: 38 }
});

const actuatorTelemetry = (mode: string, seq: number, at: number): DeviceTelemetry => ({
  deviceId: "actuator",
  timestamp: new Date(at).toISOString(),
  seq,
  readings: { driveMode: mode as "Sport", regenIntensity: 2 }
});

export const run = () => {
  suite("TwinRegistry - il gemello funziona con 0, 1 o N parti reali");

  test("senza alcun dispositivo fisico il gemello resta operativo", () => {
    const twin = createTwinRegistry();
    const { view } = twin.update();

    assert.ok(Number.isFinite(view.batterySoC), "SoC disponibile anche senza hardware");
    assert.ok(Number.isFinite(view.systemEfficiency));
    assert.equal(twin.status().physicalDevices, 0);
    assert.equal(twin.status().degraded, true);
    assert.equal(twin.status().devices.every((device) => device.source === "model"), true);
  });

  test("una sola parte reale: quel dispositivo passa a 'physical', gli altri no", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 5000, now: clock.now });

    twin.ingestTelemetry(batteryTelemetry(88, 1, clock.now()));
    const { view } = twin.update();

    assert.equal(view.batterySoC, 88, "la batteria reale sovrascrive il modello");
    assert.equal(twin.deviceStatus("battery").source, "physical");
    assert.equal(twin.deviceStatus("powerunit").source, "model");
    assert.equal(twin.deviceStatus("actuator").source, "model");
    assert.equal(twin.status().physicalDevices, 1);
    assert.ok(Number.isFinite(view.engineRPM), "le grandezze del propulsore restano coperte dal modello");
  });

  test("quando la parte reale cade, il modello riparte dall'ultimo valore vero", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 5000, now: clock.now });

    twin.ingestTelemetry(batteryTelemetry(42, 1, clock.now()));
    twin.update();
    assert.equal(twin.snapshot().batterySoC, 42);

    clock.advance(6000);
    const { view } = twin.update();

    assert.equal(twin.deviceStatus("battery").source, "model", "misura scaduta");
    assert.ok(
      Math.abs(view.batterySoC - 42) < 5,
      `il modello continua da ~42, non da uno stato divergente (letto ${view.batterySoC.toFixed(1)})`
    );
  });

  test("il cambio di sorgente genera un evento di link", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 5000, now: clock.now });
    const changes: Array<{ deviceId: DeviceId; live: boolean }> = [];
    twin.onLinkChange((change) => changes.push({ deviceId: change.deviceId, live: change.live }));

    twin.ingestTelemetry(batteryTelemetry(50, 1, clock.now()));
    twin.update();
    clock.advance(6000);
    twin.update();

    assert.deepEqual(changes, [
      { deviceId: "battery", live: true },
      { deviceId: "battery", live: false }
    ]);
  });

  suite("TwinRegistry - instradamento dei comandi");

  test("senza attuatore reale il comando viene applicato al modello", () => {
    const sent: string[] = [];
    const twin = createTwinRegistry({ sendCommand: (device) => sent.push(device) });

    const result = twin.setDriveMode("Sport");

    assert.equal(result.target, "model");
    assert.equal(sent.length, 0, "nessun comando sul bus: non c'e' nessuno che lo esegua");
    assert.equal(twin.snapshot().driveMode, "Sport");
  });

  test("con attuatore reale il comando esce sul bus verso il dispositivo", () => {
    const clock = createClock();
    const sent: Array<{ deviceId: DeviceId; command: string }> = [];
    const twin = createTwinRegistry({
      staleAfterMs: 5000,
      now: clock.now,
      sendCommand: (deviceId, command) => sent.push({ deviceId, command: command.command })
    });

    twin.ingestTelemetry(actuatorTelemetry("Hybrid", 1, clock.now()));
    const result = twin.setDriveMode("Save");

    assert.equal(result.target, "physical");
    assert.deepEqual(sent, [{ deviceId: "actuator", command: "setDriveMode" }]);
  });

  test("l'attuatore reale resta l'autorita' sullo stato riportato", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 5000, now: clock.now, sendCommand: () => undefined });

    twin.ingestTelemetry(actuatorTelemetry("Hybrid", 1, clock.now()));
    twin.setDriveMode("Sport");

    assert.equal(
      twin.snapshot().driveMode,
      "Hybrid",
      "finche' il dispositivo non conferma, il gemello riporta cio' che il dispositivo dice"
    );

    twin.ingestTelemetry(actuatorTelemetry("Sport", 2, clock.now()));
    assert.equal(twin.snapshot().driveMode, "Sport", "dopo l'eco del dispositivo lo stato si allinea");
  });

  test("il comando manuale riporta il controllo in Manual", () => {
    const twin = createTwinRegistry();
    twin.setControlMode("Auto");
    assert.equal(twin.getControlMode(), "Auto");

    twin.setDriveMode("Sport", "manual");
    assert.equal(twin.getControlMode(), "Manual", "l'utente riprende il controllo");
  });

  test("il comando automatico non toglie il modo Auto", () => {
    const twin = createTwinRegistry();
    twin.setControlMode("Auto");

    twin.setDriveMode("Save", "auto");
    assert.equal(twin.getControlMode(), "Auto");
    assert.equal(twin.snapshot().driveMode, "Save");
  });

  test("regenIntensity resta nell'intervallo 1-3", () => {
    const twin = createTwinRegistry();
    assert.equal(twin.setRegenIntensity(9).applied, 3);
    assert.equal(twin.setRegenIntensity(-4).applied, 1);
  });

  suite("TwinRegistry - indicatori derivati e eventi");

  test("gli indicatori derivati sono calcolati dal gemello, non misurati", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 5000, now: clock.now });

    twin.ingestTelemetry({
      deviceId: "powerunit",
      timestamp: new Date(clock.now()).toISOString(),
      seq: 1,
      readings: {
        engineRPM: 2000, torqueNm: 150, temperatureC: 100, speedKmh: 60,
        engineStatus: "Running", distanceKm: 20, energyUsedKwh: 4
      }
    });
    twin.ingestTelemetry(batteryTelemetry(10, 1, clock.now()));

    const view = twin.snapshot();

    assert.equal(view.systemEfficiency, 5, "20 km / 4 kWh");
    assert.equal(view.thermalHealth, 46, "100 - (100-70)*1.8");
    assert.equal(view.estimatedRangeKm, 8.5, "10% * 0.85");
  });

  test("gli eventi scattano sui dati reali come su quelli del modello", () => {
    const clock = createClock();
    const twin = createTwinRegistry({ staleAfterMs: 60000, now: clock.now });

    twin.ingestTelemetry({
      deviceId: "powerunit",
      timestamp: new Date(clock.now()).toISOString(),
      seq: 1,
      readings: {
        engineRPM: 5000, torqueNm: 300, temperatureC: 105, speedKmh: 120,
        engineStatus: "Running", distanceKm: 20, energyUsedKwh: 4
      }
    });
    twin.ingestTelemetry(batteryTelemetry(5, 1, clock.now()));

    const { events } = twin.update();

    assert.equal(events.criticalOverheat, true, "105C su misura reale");
    assert.equal(events.lowEnergyWarning, true, "autonomia 4.25 km");
  });
};
