import assert from "node:assert/strict";
import {
  commandTopic,
  deviceFromTopic,
  parseCommand,
  parseTelemetry,
  telemetryTopic
} from "../src/physical/protocol";
import { suite, test } from "./harness";

export const run = () => {
  suite("Protocollo della parte fisica");

  test("i topic sono derivati dall'identificativo del dispositivo", () => {
    assert.equal(telemetryTopic("battery"), "pad/physical/battery/telemetry");
    assert.equal(commandTopic("actuator"), "pad/physical/actuator/command");
    assert.equal(deviceFromTopic("pad/physical/powerunit/telemetry"), "powerunit");
    assert.equal(deviceFromTopic("pad/physical/sconosciuto/telemetry"), undefined);
  });

  test("la telemetria valida viene accettata", () => {
    const parsed = parseTelemetry({
      deviceId: "battery",
      timestamp: "2026-07-31T10:00:00.000Z",
      seq: 7,
      readings: { batterySoC: 61 }
    });

    assert.equal(parsed?.deviceId, "battery");
    assert.equal(parsed?.seq, 7);
  });

  test("la telemetria malformata viene rifiutata invece di corrompere il gemello", () => {
    assert.equal(parseTelemetry(null), undefined);
    assert.equal(parseTelemetry("stringa"), undefined);
    assert.equal(parseTelemetry({ deviceId: "frigorifero", timestamp: "2026-07-31T10:00:00.000Z", readings: {} }), undefined);
    assert.equal(parseTelemetry({ deviceId: "battery", timestamp: "non-una-data", readings: {} }), undefined);
    assert.equal(parseTelemetry({ deviceId: "battery", timestamp: "2026-07-31T10:00:00.000Z" }), undefined);
  });

  test("i comandi validi vengono riconosciuti", () => {
    assert.equal(parseCommand({ command: "setDriveMode", value: "Sport", issuedAt: "x" })?.command, "setDriveMode");
    assert.equal(parseCommand({ command: "triggerRegen", value: 2, issuedAt: "x" })?.command, "triggerRegen");
  });

  test("i comandi malformati vengono rifiutati", () => {
    assert.equal(parseCommand({ command: "autodistruzione", value: 1 }), undefined);
    assert.equal(parseCommand({ command: "triggerRegen", value: "due" }), undefined);
    assert.equal(parseCommand({ command: "triggerRegen", value: Number.NaN }), undefined);
  });
};
