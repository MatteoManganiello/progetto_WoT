import assert from "node:assert/strict";
import { createSimulation, DRIVE_MODES } from "../src/sim-state";

const simulation = createSimulation();

assert.equal(simulation.state.controlMode, "Auto");
assert.equal(simulation.state.regenMode, "Auto");

simulation.setDriveMode("Sport");
assert.equal(simulation.state.controlMode, "Manual");
assert.equal(simulation.state.driveMode, "Sport");

simulation.setControlMode("Auto");
assert.equal(simulation.state.controlMode, "Auto");

simulation.setRegenIntensity(3);
assert.equal(simulation.state.regenMode, "Manual");
assert.equal(simulation.state.regenIntensity, 3);

simulation.setRegenAuto();
assert.equal(simulation.state.regenMode, "Auto");

simulation.update();
assert.ok(DRIVE_MODES.includes(simulation.state.driveMode));

console.log("sim-state tests passed");
