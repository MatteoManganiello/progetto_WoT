import assert from "node:assert/strict";
import { createSimulation, DRIVE_MODES } from "../src/sim-state";

const simulation = createSimulation();

assert.equal(simulation.state.controlMode, "Manual");
assert.equal(simulation.state.regenMode, "Manual");

simulation.setDriveMode("Sport");
assert.equal(simulation.state.controlMode, "Manual");
assert.equal(simulation.state.driveMode, "Sport");

simulation.setControlMode("Manual");
assert.equal(simulation.state.controlMode, "Manual");

simulation.setRegenIntensity(3);
assert.equal(simulation.state.regenMode, "Manual");
assert.equal(simulation.state.regenIntensity, 3);

simulation.update();
assert.ok(DRIVE_MODES.includes(simulation.state.driveMode));

console.log("sim-state tests passed");
