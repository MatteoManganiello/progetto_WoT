"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEnergyOrchestrator = exports.computeDriveMode = void 0;
const wot_client_1 = require("./wot-client");
/**
 * Regole a soglia per la gestione automatica della coppia: dalla modalita' di
 * guida discendono coppia richiesta e ripartizione fra i due motori.
 * Funzione pura, cosi' e' verificabile dai test senza avviare un servient.
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
 * ENERGY ORCHESTRATOR — consumer WoT di riferimento.
 *
 * Incluso a scopo architetturale: mostra come un consumer possa chiudere l'anello
 * di controllo leggendo le proprieta' e agendo con `invokeAction`, senza conoscere
 * ne' URL ne' protocollo. Non viene avviato dal runtime: il controllo della
 * modalita' di guida resta manuale, dalla dashboard.
 */
const startEnergyOrchestrator = async (config) => {
    const intervalMs = config.intervalMs ?? 4000;
    const { wot, servient } = await (0, wot_client_1.createConsumerServient)();
    const powerUnit = await (0, wot_client_1.consumeThing)(wot, config.powerUnitTd);
    const controlActuator = await (0, wot_client_1.consumeThing)(wot, config.controlActuatorTd);
    let lastAppliedMode;
    const tick = async () => {
        try {
            const [batterySoC, driveMode] = await Promise.all([
                (0, wot_client_1.readValue)(powerUnit, "batterySoC"),
                (0, wot_client_1.readValue)(controlActuator, "driveMode")
            ]);
            // La velocita' non e' esposta: si usa il regime motore come proxy della domanda.
            const engineRPM = await (0, wot_client_1.readValue)(powerUnit, "engineRPM");
            const speedKmh = Math.max(0, (engineRPM - 900) / 22);
            const target = (0, exports.computeDriveMode)({ batterySoC, speedKmh });
            if (target === driveMode || target === lastAppliedMode) {
                return;
            }
            await controlActuator.invokeAction("setDriveMode", target);
            lastAppliedMode = target;
            console.log(`[Orchestrator] SoC ${batterySoC.toFixed(1)}% @ ${speedKmh.toFixed(0)} km/h -> ${target}`);
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
