"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEnergyOrchestrator = exports.computeDriveMode = void 0;
const wot_client_1 = require("./wot-client");
/**
 * Regole di efficienza. Restano una funzione pura, cosi' sono verificabili
 * dai test senza avviare ne' broker ne' servient.
 */
const computeDriveMode = (snapshot) => {
    if (snapshot.batterySoC < 15) {
        return "Save";
    }
    if (snapshot.batterySoC > 20 && snapshot.speedKmh < 50) {
        return "Full Electric";
    }
    if (snapshot.speedKmh > 90) {
        return "Sport";
    }
    return "Hybrid";
};
exports.computeDriveMode = computeDriveMode;
/**
 * ENERGY ORCHESTRATOR — consumer WoT.
 *
 * Legge lo stato dalle Thing consumate e agisce con `invokeAction`. Interviene
 * solo quando l'utente ha ceduto il controllo (`controlMode === "Auto"`).
 */
const startEnergyOrchestrator = async (config) => {
    const intervalMs = config.intervalMs ?? 4000;
    const { wot, servient } = await (0, wot_client_1.createConsumerServient)();
    const powerUnit = await (0, wot_client_1.consumeThing)(wot, config.powerUnitTd);
    const controlActuator = await (0, wot_client_1.consumeThing)(wot, config.controlActuatorTd);
    console.log("[Orchestrator] TD consumate, in attesa di controlMode=Auto");
    let lastAppliedMode;
    const tick = async () => {
        try {
            const [batterySoC, speedKmh, controlMode, driveMode] = await Promise.all([
                (0, wot_client_1.readValue)(powerUnit, "batterySoC"),
                (0, wot_client_1.readValue)(powerUnit, "speedKmh"),
                (0, wot_client_1.readValue)(controlActuator, "controlMode"),
                (0, wot_client_1.readValue)(controlActuator, "driveMode")
            ]);
            if (controlMode !== "Auto") {
                lastAppliedMode = undefined;
                return;
            }
            const target = (0, exports.computeDriveMode)({ batterySoC, speedKmh });
            if (target === driveMode || target === lastAppliedMode) {
                return;
            }
            const output = await controlActuator.invokeAction("setDriveMode", target);
            const result = (await output?.value());
            lastAppliedMode = target;
            console.log(`[Orchestrator] SoC ${batterySoC.toFixed(1)}% @ ${speedKmh.toFixed(0)} km/h -> ${target}` +
                (result?.target ? ` (applicato su: ${result.target})` : ""));
        }
        catch (error) {
            console.warn("[Orchestrator] ciclo fallito", error);
        }
    };
    const timer = setInterval(tick, intervalMs);
    void tick();
    return async () => {
        clearInterval(timer);
        await servient.shutdown();
    };
};
exports.startEnergyOrchestrator = startEnergyOrchestrator;
