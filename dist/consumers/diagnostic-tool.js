"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDiagnosticTool = exports.evaluateRisks = exports.DIAGNOSTIC_THRESHOLDS = void 0;
const wot_client_1 = require("./wot-client");
/** Soglie diagnostiche applicate alle proprieta' lette. */
exports.DIAGNOSTIC_THRESHOLDS = {
    /** Oltre questa temperatura il gruppo propulsore e' in surriscaldamento. */
    overheatC: 90,
    /** Sotto questo stato di salute il pacco batteria e' considerato degradato. */
    degradedSoH: 85,
    /** Sotto questa autonomia residua scatta l'avviso di bassa energia. */
    lowRangeKm: 10
};
/**
 * Regole diagnostiche a soglia. Funzione pura, verificabile senza servient.
 */
const evaluateRisks = (reading) => ({
    overheat: reading.temperatureC > exports.DIAGNOSTIC_THRESHOLDS.overheatC,
    degradedBattery: reading.batterySoH < exports.DIAGNOSTIC_THRESHOLDS.degradedSoH,
    lowRange: reading.estimatedRangeKm < exports.DIAGNOSTIC_THRESHOLDS.lowRangeKm
});
exports.evaluateRisks = evaluateRisks;
/**
 * DIAGNOSTIC TOOL — consumer WoT.
 *
 * Non conosce gli URL delle proprieta': consuma le due Thing Description e legge
 * periodicamente via `readProperty`, lasciando a node-wot la risoluzione delle
 * form. Applica poi le soglie diagnostiche e segnala i rischi.
 */
const startDiagnosticTool = async (config) => {
    const intervalMs = config.intervalMs ?? 6000;
    const { wot, servient } = await (0, wot_client_1.createConsumerServient)();
    const powerUnit = await (0, wot_client_1.consumeThing)(wot, config.powerUnitTd);
    const energyStorage = await (0, wot_client_1.consumeThing)(wot, config.energyStorageTd);
    console.log("[Diagnostic] Thing Description consumate, monitoraggio a soglie avviato");
    // Si segnala il passaggio di soglia, non ogni singola lettura oltre soglia.
    const lastFlags = { overheat: false, degradedBattery: false, lowRange: false };
    const tick = async () => {
        try {
            const [temperatureC, estimatedRangeKm, batterySoH] = await Promise.all([
                (0, wot_client_1.readValue)(powerUnit, "temperatureC"),
                (0, wot_client_1.readValue)(powerUnit, "estimatedRangeKm"),
                (0, wot_client_1.readValue)(energyStorage, "batterySoH")
            ]);
            const risks = (0, exports.evaluateRisks)({ temperatureC, batterySoH, estimatedRangeKm });
            if (risks.overheat && !lastFlags.overheat) {
                console.warn(`[Diagnostic] SURRISCALDAMENTO: ${temperatureC.toFixed(1)} C`);
            }
            if (risks.degradedBattery && !lastFlags.degradedBattery) {
                console.warn(`[Diagnostic] SoH batteria degradato: ${batterySoH.toFixed(1)}%`);
            }
            if (risks.lowRange && !lastFlags.lowRange) {
                console.warn(`[Diagnostic] AUTONOMIA BASSA: ${estimatedRangeKm.toFixed(1)} km`);
            }
            lastFlags.overheat = risks.overheat;
            lastFlags.degradedBattery = risks.degradedBattery;
            lastFlags.lowRange = risks.lowRange;
        }
        catch (error) {
            console.warn("[Diagnostic] lettura fallita", error);
        }
    };
    const timer = setInterval(tick, intervalMs);
    void tick();
    return async () => {
        clearInterval(timer);
        await servient.shutdown();
    };
};
exports.startDiagnosticTool = startDiagnosticTool;
