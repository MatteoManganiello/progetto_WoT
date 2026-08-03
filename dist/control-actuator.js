"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createControlActuatorThing = exports.CONTROL_ACTUATOR_TD = void 0;
const sim_state_1 = require("./sim-state");
const thing_1 = require("./thing");
const wot_io_1 = require("./wot-io");
/**
 * Thing WoT "ControlActuator": attuatore di controllo del powertrain.
 *
 * Espone come Properties le due variabili di controllo (modalita' di guida e
 * intensita' di rigenerazione) e come Actions i comandi che le modificano.
 */
exports.CONTROL_ACTUATOR_TD = {
    "@context": "https://www.w3.org/2022/wot/td/v1.1",
    "@type": "Thing",
    id: "urn:dev:ops:proactivedrive-controlactuator",
    title: "ControlActuator",
    description: "Gemello digitale della centralina che ripartisce la propulsione.",
    securityDefinitions: {
        nosec_sc: { scheme: "nosec" }
    },
    security: ["nosec_sc"],
    properties: {
        driveMode: { type: "string", enum: sim_state_1.DRIVE_MODES, observable: true, readOnly: true },
        regenIntensity: {
            type: "number",
            minimum: 0,
            maximum: 3,
            observable: true,
            readOnly: true,
            description: "Intensita' della frenata rigenerativa (0 = mai impostata)."
        }
    },
    actions: {
        setDriveMode: {
            description: "Imposta la modalita' di propulsione.",
            idempotent: true,
            input: { type: "string", enum: sim_state_1.DRIVE_MODES },
            output: {
                type: "object",
                properties: { activeMode: { type: "string", enum: sim_state_1.DRIVE_MODES } }
            }
        },
        triggerRegen: {
            description: "Imposta l'intensita' della frenata rigenerativa.",
            idempotent: true,
            input: { type: "number", minimum: 1, maximum: 3 },
            output: {
                type: "object",
                properties: { regenIntensity: { type: "number" } }
            }
        }
    }
};
const createControlActuatorThing = async (wot, simulation) => {
    const thing = await wot.produce(exports.CONTROL_ACTUATOR_TD);
    thing.setPropertyReadHandler("driveMode", async () => simulation.state.driveMode);
    thing.setPropertyReadHandler("regenIntensity", async () => simulation.state.regenIntensity);
    thing.setActionHandler("setDriveMode", async (params) => {
        const mode = await (0, wot_io_1.readInteractionInput)(params);
        if (!(0, thing_1.isDriveMode)(mode)) {
            throw new Error(`Modalita' non valida: ${String(mode)}`);
        }
        simulation.setDriveMode(mode);
        console.log(`[ControlActuator] setDriveMode(${mode})`);
        return { activeMode: simulation.state.driveMode };
    });
    thing.setActionHandler("triggerRegen", async (params) => {
        const raw = await (0, wot_io_1.readInteractionInput)(params);
        const intensity = Number(raw);
        if (!Number.isFinite(intensity)) {
            throw new Error(`Intensita' rigenerazione non valida: ${String(raw)}`);
        }
        simulation.setRegenIntensity(intensity);
        console.log(`[ControlActuator] triggerRegen(${intensity})`);
        return { regenIntensity: simulation.state.regenIntensity };
    });
    return thing;
};
exports.createControlActuatorThing = createControlActuatorThing;
