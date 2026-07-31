"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createControlActuatorThing = exports.CONTROL_ACTUATOR_TD = void 0;
const sim_state_1 = require("./sim-state");
const wot_io_1 = require("./wot-io");
/**
 * Thing WoT "ControlActuator": unico punto di attuazione del sistema.
 *
 * Le azioni non toccano la fisica direttamente. Le passano al registro del
 * gemello, che le inoltra all'attuatore reale quando e' collegato oppure le
 * applica al modello quando non lo e'.
 */
exports.CONTROL_ACTUATOR_TD = {
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        { mqv: "https://www.w3.org/2019/wot/mqtt#" }
    ],
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
        controlMode: {
            type: "string",
            enum: ["Manual", "Auto"],
            observable: true,
            readOnly: true,
            description: "Auto delega la scelta della modalita' all'Energy Orchestrator."
        },
        regenIntensity: { type: "number", minimum: 0, maximum: 3, observable: true, readOnly: true },
        regenMode: { type: "string", enum: ["Manual", "Auto"], observable: true, readOnly: true },
        commandTarget: {
            type: "string",
            enum: ["physical", "model"],
            observable: true,
            readOnly: true,
            description: "Destinatario attuale dei comandi: attuatore reale o modello."
        },
        twinStatus: { ...wot_io_1.TWIN_STATUS_SCHEMA, observable: true, readOnly: true }
    },
    actions: {
        setDriveMode: {
            description: "Imposta la modalita' di propulsione.",
            idempotent: true,
            input: { type: "string", enum: sim_state_1.DRIVE_MODES },
            output: {
                type: "object",
                properties: {
                    activeMode: { type: "string", enum: sim_state_1.DRIVE_MODES },
                    target: { type: "string", enum: ["physical", "model"] }
                }
            }
        },
        triggerRegen: {
            description: "Imposta l'intensita' della frenata rigenerativa.",
            idempotent: true,
            input: { type: "number", minimum: 1, maximum: 3 },
            output: {
                type: "object",
                properties: {
                    regenIntensity: { type: "number" },
                    target: { type: "string", enum: ["physical", "model"] }
                }
            }
        },
        setControlMode: {
            description: "Passa fra controllo manuale e controllo automatico.",
            idempotent: true,
            input: { type: "string", enum: ["Manual", "Auto"] },
            output: {
                type: "object",
                properties: {
                    controlMode: { type: "string", enum: ["Manual", "Auto"] }
                }
            }
        }
    }
};
const isDriveMode = (value) => typeof value === "string" && sim_state_1.DRIVE_MODES.includes(value);
const createControlActuatorThing = async (wot, twin) => {
    const thing = await wot.produce(exports.CONTROL_ACTUATOR_TD);
    thing.setPropertyReadHandler("driveMode", async () => twin.snapshot().driveMode);
    thing.setPropertyReadHandler("controlMode", async () => twin.snapshot().controlMode);
    thing.setPropertyReadHandler("regenIntensity", async () => twin.snapshot().regenIntensity);
    thing.setPropertyReadHandler("regenMode", async () => twin.snapshot().regenMode);
    thing.setPropertyReadHandler("commandTarget", async () => twin.deviceStatus("actuator").live ? "physical" : "model");
    thing.setPropertyReadHandler("twinStatus", async () => twin.deviceStatus("actuator"));
    thing.setActionHandler("setDriveMode", async (params) => {
        const mode = await (0, wot_io_1.readInteractionInput)(params);
        if (!isDriveMode(mode)) {
            throw new Error(`Modalita' non valida: ${String(mode)}`);
        }
        // L'origine distingue il comando dell'utente da quello dell'orchestratore.
        const origin = twin.getControlMode() === "Auto" ? "auto" : "manual";
        const result = twin.setDriveMode(mode, origin);
        console.log(`[ControlActuator] setDriveMode(${mode}) -> ${result.target}`);
        return { activeMode: result.applied, target: result.target };
    });
    thing.setActionHandler("triggerRegen", async (params) => {
        const raw = await (0, wot_io_1.readInteractionInput)(params);
        const intensity = Number(raw);
        if (!Number.isFinite(intensity)) {
            throw new Error(`Intensita' rigenerazione non valida: ${String(raw)}`);
        }
        const result = twin.setRegenIntensity(intensity);
        console.log(`[ControlActuator] triggerRegen(${intensity}) -> ${result.target}`);
        return { regenIntensity: result.applied, target: result.target };
    });
    thing.setActionHandler("setControlMode", async (params) => {
        const raw = await (0, wot_io_1.readInteractionInput)(params);
        if (raw !== "Manual" && raw !== "Auto") {
            throw new Error(`Modo di controllo non valido: ${String(raw)}`);
        }
        const controlMode = twin.setControlMode(raw);
        console.log(`[ControlActuator] setControlMode(${controlMode})`);
        return { controlMode };
    });
    return thing;
};
exports.createControlActuatorThing = createControlActuatorThing;
