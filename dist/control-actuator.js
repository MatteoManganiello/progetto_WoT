"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createControlActuatorThing = exports.CONTROL_ACTUATOR_TD = void 0;
const sim_state_1 = require("./sim-state");
exports.CONTROL_ACTUATOR_TD = {
    "@context": ["https://www.w3.org/2019/wot/td/v1"],
    title: "ControlActuator",
    securityDefinitions: {
        nosec_sc: { scheme: "nosec" }
    },
    security: ["nosec_sc"],
    properties: {
        driveMode: { type: "string", enum: sim_state_1.DRIVE_MODES, observable: true, readOnly: true },
        controlMode: { type: "string", enum: ["Manual"], observable: true, readOnly: true },
        regenIntensity: { type: "number", minimum: 0, maximum: 3, observable: true, readOnly: true },
        regenMode: { type: "string", enum: ["Manual"], observable: true, readOnly: true }
    },
    actions: {
        setDriveMode: {
            input: { type: "string", enum: sim_state_1.DRIVE_MODES }
        },
        triggerRegen: {
            input: { type: "number", minimum: 1, maximum: 3 }
        }
    }
};
const createControlActuatorThing = async (wot, simulation) => {
    const state = simulation.state;
    const thing = await wot.produce(exports.CONTROL_ACTUATOR_TD);
    const resolveInput = async (value) => {
        if (value && typeof value === "object") {
            if ("arrayBuffer" in value && typeof value.arrayBuffer === "function") {
                const buffer = Buffer.from(await value.arrayBuffer());
                const text = buffer.toString();
                if (text.length === 0) {
                    return undefined;
                }
                try {
                    return JSON.parse(text);
                }
                catch {
                    return text;
                }
            }
            if ("value" in value && typeof value.value === "function") {
                return value.value();
            }
        }
        return value;
    };
    const readStringInput = (value, keys) => {
        if (typeof value === "string") {
            let text = value.trim();
            text = text.replace(/\\"/g, "\"");
            if (text.startsWith("\"") && text.endsWith("\"")) {
                text = text.slice(1, -1);
            }
            return text;
        }
        if (value && typeof value === "object") {
            for (const key of keys) {
                if (key in value) {
                    return String(value[key]);
                }
            }
            if ("value" in value) {
                return String(value.value);
            }
        }
        return String(value);
    };
    const readNumberInput = (value, keys) => {
        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "string") {
            const normalized = value.replace(/\\"/g, "\"").replace(/^(\")|(\")$/g, "").trim();
            return Number(normalized);
        }
        if (value && typeof value === "object") {
            for (const key of keys) {
                if (key in value) {
                    return Number(value[key]);
                }
            }
            if ("value" in value) {
                return Number(value.value);
            }
        }
        return Number(value);
    };
    thing.setPropertyReadHandler("driveMode", async () => state.driveMode);
    thing.setPropertyReadHandler("controlMode", async () => state.controlMode);
    thing.setPropertyReadHandler("regenIntensity", async () => state.regenIntensity);
    thing.setPropertyReadHandler("regenMode", async () => state.regenMode);
    thing.setActionHandler("setDriveMode", async (value) => {
        const resolved = await resolveInput(value);
        const mode = readStringInput(resolved, ["mode", "driveMode"]);
        if (!sim_state_1.DRIVE_MODES.includes(mode)) {
            throw new Error("Invalid drive mode");
        }
        simulation.setDriveMode(mode);
        console.log(`[ControlActuator] driveMode -> ${state.driveMode}`);
        return { activeMode: state.driveMode };
    });
    thing.setActionHandler("triggerRegen", async (value) => {
        const resolved = await resolveInput(value);
        const intensity = readNumberInput(resolved, ["intensity", "regenIntensity"]);
        if (!Number.isFinite(intensity)) {
            throw new Error("Invalid regen intensity");
        }
        simulation.setRegenIntensity(intensity);
        console.log(`[ControlActuator] regenIntensity -> ${state.regenIntensity}`);
        return { regenIntensity: state.regenIntensity };
    });
    return thing;
};
exports.createControlActuatorThing = createControlActuatorThing;
