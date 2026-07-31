"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPowerUnitThing = exports.POWER_UNIT_TD = void 0;
const wot_io_1 = require("./wot-io");
/**
 * Thing WoT "PowerUnit": faccia digitale del gruppo propulsore.
 *
 * Non contiene fisica ne' stato proprio. Legge dal registro del gemello, che
 * a sua volta decide se servire la misura del dispositivo reale o quella del
 * modello di fallback.
 */
exports.POWER_UNIT_TD = {
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        { mqv: "https://www.w3.org/2019/wot/mqtt#" }
    ],
    "@type": "Thing",
    id: "urn:dev:ops:proactivedrive-powerunit",
    title: "PowerUnit",
    description: "Gemello digitale del gruppo propulsore ibrido (motore termico + motore elettrico).",
    securityDefinitions: {
        nosec_sc: { scheme: "nosec" }
    },
    security: ["nosec_sc"],
    properties: {
        systemEfficiency: {
            type: "number",
            unit: "km/kWh",
            observable: true,
            readOnly: true,
            description: "Indicatore calcolato dal gemello: km percorsi per kWh consumato."
        },
        batterySoC: { type: "number", unit: "%", observable: true, readOnly: true },
        engineStatus: { type: "string", enum: ["Off", "Idle", "Running"], observable: true, readOnly: true },
        thermalHealth: {
            type: "number",
            unit: "%",
            observable: true,
            readOnly: true,
            description: "Indicatore calcolato dal gemello a partire dalla temperatura misurata."
        },
        engineRPM: { type: "number", unit: "rpm", observable: true, readOnly: true },
        torqueNm: { type: "number", unit: "Nm", observable: true, readOnly: true },
        temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true },
        estimatedRangeKm: { type: "number", unit: "km", observable: true, readOnly: true },
        speedKmh: { type: "number", unit: "km/h", observable: true, readOnly: true },
        twinStatus: { ...wot_io_1.TWIN_STATUS_SCHEMA, observable: true, readOnly: true }
    },
    events: {
        criticalOverheat: {
            description: "Temperatura oltre la soglia critica su inverter o motore.",
            data: {
                type: "object",
                properties: {
                    temperatureC: { type: "number", unit: "celsius" },
                    source: { type: "string", enum: ["physical", "model"] }
                }
            }
        },
        lowEnergyWarning: {
            description: "Autonomia stimata sotto i 10 km.",
            data: {
                type: "object",
                properties: {
                    estimatedRangeKm: { type: "number", unit: "km" },
                    source: { type: "string", enum: ["physical", "model"] }
                }
            }
        },
        anomalyDetected: {
            description: "Consumi anomali persistenti: possibile guasto.",
            data: {
                type: "object",
                properties: {
                    systemEfficiency: { type: "number", unit: "km/kWh" },
                    torqueNm: { type: "number", unit: "Nm" },
                    source: { type: "string", enum: ["physical", "model"] }
                }
            }
        },
        physicalLinkChanged: {
            description: "Una o piu' parti fisiche si sono collegate o scollegate: il gemello ha cambiato sorgente dati.",
            data: {
                type: "object",
                properties: {
                    changes: {
                        type: "array",
                        description: "Tutti i cambi di sorgente rilevati nello stesso ciclo.",
                        items: {
                            type: "object",
                            properties: {
                                deviceId: { type: "string", enum: ["powerunit", "battery", "actuator"] },
                                live: { type: "boolean" },
                                source: { type: "string", enum: ["physical", "model"] },
                                at: { type: "string" }
                            }
                        }
                    },
                    physicalDevices: { type: "number", description: "Parti fisiche attive dopo il cambio." },
                    totalDevices: { type: "number" }
                },
                required: ["changes", "physicalDevices", "totalDevices"]
            }
        }
    }
};
const createPowerUnitThing = async (wot, twin) => {
    const thing = await wot.produce(exports.POWER_UNIT_TD);
    thing.setPropertyReadHandler("systemEfficiency", async () => twin.snapshot().systemEfficiency);
    thing.setPropertyReadHandler("batterySoC", async () => twin.snapshot().batterySoC);
    thing.setPropertyReadHandler("engineStatus", async () => twin.snapshot().engineStatus);
    thing.setPropertyReadHandler("thermalHealth", async () => twin.snapshot().thermalHealth);
    thing.setPropertyReadHandler("engineRPM", async () => twin.snapshot().engineRPM);
    thing.setPropertyReadHandler("torqueNm", async () => twin.snapshot().torqueNm);
    thing.setPropertyReadHandler("temperatureC", async () => twin.snapshot().temperatureC);
    thing.setPropertyReadHandler("estimatedRangeKm", async () => twin.snapshot().estimatedRangeKm);
    thing.setPropertyReadHandler("speedKmh", async () => twin.snapshot().speedKmh);
    thing.setPropertyReadHandler("twinStatus", async () => twin.deviceStatus("powerunit"));
    return thing;
};
exports.createPowerUnitThing = createPowerUnitThing;
