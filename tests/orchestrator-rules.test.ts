import assert from "node:assert/strict";
import { computeDriveMode } from "../src/consumers/energy-orchestrator";
import { suite, test } from "./harness";

export const run = () => {
  suite("Energy Orchestrator - regole di efficienza");

  test("batteria carica e bassa velocita' -> Full Electric", () => {
    assert.equal(computeDriveMode({ batterySoC: 80, speedKmh: 30 }), "Full Electric");
  });

  test("batteria quasi scarica -> Save, anche a bassa velocita'", () => {
    assert.equal(
      computeDriveMode({ batterySoC: 10, speedKmh: 30 }),
      "Save",
      "la soglia di riserva ha priorita' sulla regola elettrica"
    );
  });

  test("alta velocita' -> Sport", () => {
    assert.equal(computeDriveMode({ batterySoC: 60, speedKmh: 110 }), "Sport");
  });

  test("caso intermedio -> Hybrid", () => {
    assert.equal(computeDriveMode({ batterySoC: 60, speedKmh: 70 }), "Hybrid");
  });
};
