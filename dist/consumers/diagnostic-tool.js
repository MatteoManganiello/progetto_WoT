"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDiagnosticTool = void 0;
const wot_client_1 = require("./wot-client");
/**
 * DIAGNOSTIC TOOL — consumer WoT.
 *
 * Non conosce URL di proprieta' ne' topic MQTT. Consuma le Thing Description e
 * usa `subscribeEvent` / `readProperty`: e' node-wot a risolvere le form e a
 * scegliere il binding. Sottoscrive anche `physicalLinkChanged`, cosi' la
 * diagnosi distingue un guasto reale da un dato prodotto dal modello.
 */
const startDiagnosticTool = async (config) => {
    const intervalMs = config.intervalMs ?? 6000;
    const { wot, servient } = await (0, wot_client_1.createConsumerServient)();
    const powerUnit = await (0, wot_client_1.consumeThing)(wot, config.powerUnitTd);
    const energyStorage = await (0, wot_client_1.consumeThing)(wot, config.energyStorageTd);
    const powerUnitTd = powerUnit.getThingDescription();
    console.log(`[Diagnostic] TD consumate. Eventi PowerUnit via: ${(0, wot_client_1.describeForms)(powerUnitTd, "events").join(", ") || "n/d"}`);
    console.log(`[Diagnostic] Proprieta' PowerUnit via: ${(0, wot_client_1.describeForms)(powerUnitTd, "properties").join(", ") || "n/d"}`);
    const subscriptions = [];
    // Gli eventi arrivano per sottoscrizione, non per polling.
    const subscribe = async (name, format) => {
        try {
            const subscription = await powerUnit.subscribeEvent(name, async (output) => {
                try {
                    const data = await output.value();
                    console.warn(`[Diagnostic] ${format(data)}`);
                }
                catch (error) {
                    console.warn(`[Diagnostic] evento ${name} non leggibile`, error);
                }
            });
            subscriptions.push(subscription);
            console.log(`[Diagnostic] sottoscritto evento '${name}'`);
        }
        catch (error) {
            console.warn(`[Diagnostic] sottoscrizione a '${name}' fallita`, error);
        }
    };
    await subscribe("criticalOverheat", (data) => {
        const payload = data;
        return `SURRISCALDAMENTO ${payload.temperatureC?.toFixed(1)}C (fonte: ${payload.source})`;
    });
    await subscribe("lowEnergyWarning", (data) => {
        const payload = data;
        return `AUTONOMIA BASSA ${payload.estimatedRangeKm?.toFixed(1)} km (fonte: ${payload.source})`;
    });
    await subscribe("anomalyDetected", (data) => {
        const payload = data;
        return `ANOMALIA CONSUMI ${payload.systemEfficiency?.toFixed(2)} km/kWh (fonte: ${payload.source})`;
    });
    await subscribe("physicalLinkChanged", (data) => {
        const payload = data;
        const detail = (payload.changes ?? [])
            .map((change) => `'${change.deviceId}' ${change.live ? "COLLEGATO" : "ASSENTE"}`)
            .join(", ");
        return `sorgente dati cambiata: ${detail} — parti fisiche attive ${payload.physicalDevices}/${payload.totalDevices}`;
    });
    // Il polling resta solo per le grandezze lente, che non giustificano un evento.
    const lastFlags = { sohLow: false, thermalLow: false, modelOnly: false };
    const tick = async () => {
        try {
            const [thermalHealth, batterySoH, powerStatus, batteryStatus] = await Promise.all([
                (0, wot_client_1.readValue)(powerUnit, "thermalHealth"),
                (0, wot_client_1.readValue)(energyStorage, "batterySoH"),
                (0, wot_client_1.readValue)(powerUnit, "twinStatus"),
                (0, wot_client_1.readValue)(energyStorage, "twinStatus")
            ]);
            const thermalLow = thermalHealth < 40;
            const sohLow = batterySoH < 85;
            const modelOnly = !powerStatus.live && !batteryStatus.live;
            if (thermalLow && !lastFlags.thermalLow) {
                console.warn(`[Diagnostic] Salute termica bassa: ${thermalHealth.toFixed(0)}% (fonte: ${powerStatus.source})`);
            }
            if (sohLow && !lastFlags.sohLow) {
                console.warn(`[Diagnostic] SoH batteria degradato: ${batterySoH.toFixed(0)}% (fonte: ${batteryStatus.source})`);
            }
            // Una diagnosi su dati simulati non e' una diagnosi: va dichiarato.
            if (modelOnly !== lastFlags.modelOnly) {
                console.log(modelOnly
                    ? "[Diagnostic] nessuna parte fisica collegata: le valutazioni sono su dati simulati"
                    : "[Diagnostic] parte fisica collegata: valutazioni su misure reali");
            }
            lastFlags.thermalLow = thermalLow;
            lastFlags.sohLow = sohLow;
            lastFlags.modelOnly = modelOnly;
        }
        catch (error) {
            console.warn("[Diagnostic] lettura fallita", error);
        }
    };
    const timer = setInterval(tick, intervalMs);
    void tick();
    return async () => {
        clearInterval(timer);
        await Promise.all(subscriptions.map((subscription) => subscription.stop().catch(() => undefined)));
        await servient.shutdown();
    };
};
exports.startDiagnosticTool = startDiagnosticTool;
