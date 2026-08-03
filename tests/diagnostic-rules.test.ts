import assert from "node:assert/strict";
import { evaluateRisks } from "../src/consumers/diagnostic-tool";
import { suite, test } from "./harness";

const nominal = { temperatureC: 62, batterySoH: 96, estimatedRangeKm: 60 };

export const run = () => {
  suite("Diagnostic Tool - soglie diagnostiche");

  test("in condizioni nominali non segnala rischi", () => {
    const risks = evaluateRisks(nominal);
    assert.deepEqual(risks, { overheat: false, degradedBattery: false, lowRange: false });
  });

  test("temperatura oltre soglia -> surriscaldamento", () => {
    assert.equal(evaluateRisks({ ...nominal, temperatureC: 95 }).overheat, true);
    assert.equal(evaluateRisks({ ...nominal, temperatureC: 90 }).overheat, false);
  });

  test("SoH sotto soglia -> degrado batteria", () => {
    assert.equal(evaluateRisks({ ...nominal, batterySoH: 80 }).degradedBattery, true);
    assert.equal(evaluateRisks({ ...nominal, batterySoH: 85 }).degradedBattery, false);
  });

  test("autonomia sotto soglia -> bassa energia", () => {
    assert.equal(evaluateRisks({ ...nominal, estimatedRangeKm: 4 }).lowRange, true);
    assert.equal(evaluateRisks({ ...nominal, estimatedRangeKm: 10 }).lowRange, false);
  });

  test("i rischi sono indipendenti fra loro", () => {
    const risks = evaluateRisks({ temperatureC: 110, batterySoH: 72, estimatedRangeKm: 2 });
    assert.deepEqual(risks, { overheat: true, degradedBattery: true, lowRange: true });
  });
};
