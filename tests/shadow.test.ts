import assert from "node:assert/strict";
import { DeviceShadow } from "../src/twin/shadow";
import { BatteryReadings } from "../src/physical/protocol";
import { createClock, suite, test } from "./harness";

const modelReadings: BatteryReadings = {
  batterySoC: 50,
  batterySoH: 90,
  voltageV: 360,
  currentA: 40,
  temperatureC: 60
};

const physicalReadings: BatteryReadings = {
  batterySoC: 77,
  batterySoH: 99,
  voltageV: 381,
  currentA: 12,
  temperatureC: 41
};

export const run = () => {
  suite("DeviceShadow - separazione fisico/modello");

  test("senza parte fisica serve i valori del modello", () => {
    const shadow = new DeviceShadow<BatteryReadings>({ deviceId: "battery", ttlMs: 5000 }, modelReadings);
    assert.equal(shadow.isLive(), false);
    assert.equal(shadow.values().batterySoC, 50);
    assert.equal(shadow.status().source, "model");
  });

  test("una misura reale ha la precedenza sul modello", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest(physicalReadings, new Date(clock.now()).toISOString(), 1);

    assert.equal(shadow.isLive(), true);
    assert.equal(shadow.values().batterySoC, 77);
    assert.equal(shadow.status().source, "physical");
    assert.equal(shadow.status().samples, 1);
  });

  test("scaduto il TTL il gemello degrada sul modello", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest(physicalReadings, new Date(clock.now()).toISOString(), 1);
    assert.equal(shadow.values().batterySoC, 77);

    clock.advance(5001);

    assert.equal(shadow.isLive(), false, "oltre il TTL la misura non e' piu' valida");
    assert.equal(shadow.values().batterySoC, 50, "torna al modello");
    assert.equal(shadow.status().source, "model");
    assert.notEqual(shadow.status().lastSeen, null, "conserva memoria dell'ultima misura reale");
  });

  test("il dispositivo che torna online riprende la precedenza", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest(physicalReadings, new Date(clock.now()).toISOString(), 1);
    clock.advance(9000);
    assert.equal(shadow.isLive(), false);

    shadow.ingest({ ...physicalReadings, batterySoC: 64 }, new Date(clock.now()).toISOString(), 2);

    assert.equal(shadow.isLive(), true);
    assert.equal(shadow.values().batterySoC, 64);
  });

  test("i pacchetti fuori ordine vengono scartati", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest({ ...physicalReadings, batterySoC: 80 }, new Date(clock.now()).toISOString(), 5);
    const accepted = shadow.ingest({ ...physicalReadings, batterySoC: 10 }, new Date(clock.now()).toISOString(), 3);

    assert.equal(accepted, false);
    assert.equal(shadow.values().batterySoC, 80, "il valore vecchio non sovrascrive il nuovo");
  });

  test("il riavvio del dispositivo (seq che riparte) viene riconosciuto", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest({ ...physicalReadings, batterySoC: 80 }, new Date(clock.now()).toISOString(), 42);
    const accepted = shadow.ingest({ ...physicalReadings, batterySoC: 99 }, new Date(clock.now()).toISOString(), 1);

    assert.equal(accepted, true, "seq=1 dopo seq alto significa dispositivo riavviato");
    assert.equal(shadow.values().batterySoC, 99);
  });

  test("l'aggiornamento del modello non disturba una misura reale viva", () => {
    const clock = createClock();
    const shadow = new DeviceShadow<BatteryReadings>(
      { deviceId: "battery", ttlMs: 5000, now: clock.now },
      modelReadings
    );

    shadow.ingest(physicalReadings, new Date(clock.now()).toISOString(), 1);
    shadow.updateModel({ ...modelReadings, batterySoC: 5 });

    assert.equal(shadow.values().batterySoC, 77, "finche' e' viva, vince la misura reale");

    clock.advance(6000);
    assert.equal(shadow.values().batterySoC, 5, "caduta la misura reale, emerge il modello aggiornato");
  });
};
