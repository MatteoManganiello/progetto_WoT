"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEnergyStorageThing = exports.ENERGY_STORAGE_TD = void 0;
/**
 * Thing WoT "EnergyStorage": pacco batteria ad alta tensione.
 *
 * Espone solo Properties: e' un sottosistema osservabile, non attuabile.
 */
exports.ENERGY_STORAGE_TD = {
    "@context": "https://www.w3.org/2022/wot/td/v1.1",
    "@type": "Thing",
    id: "urn:dev:ops:proactivedrive-energystorage",
    title: "EnergyStorage",
    description: "Gemello digitale del pacco batteria ad alta tensione.",
    securityDefinitions: {
        nosec_sc: { scheme: "nosec" }
    },
    security: ["nosec_sc"],
    properties: {
        batterySoC: { type: "number", unit: "%", observable: true, readOnly: true },
        batterySoH: {
            type: "number",
            unit: "%",
            observable: true,
            readOnly: true,
            description: "Stato di salute: degrada con lo stress termico."
        },
        voltageV: { type: "number", unit: "V", observable: true, readOnly: true },
        currentA: {
            type: "number",
            unit: "A",
            observable: true,
            readOnly: true,
            description: "Negativa durante la frenata rigenerativa."
        },
        temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true }
    }
};
const createEnergyStorageThing = async (wot, simulation) => {
    const thing = await wot.produce(exports.ENERGY_STORAGE_TD);
    thing.setPropertyReadHandler("batterySoC", async () => simulation.state.batterySoC);
    thing.setPropertyReadHandler("batterySoH", async () => simulation.state.batterySoH);
    thing.setPropertyReadHandler("voltageV", async () => simulation.state.voltageV);
    thing.setPropertyReadHandler("currentA", async () => simulation.state.currentA);
    thing.setPropertyReadHandler("temperatureC", async () => simulation.state.temperatureC);
    return thing;
};
exports.createEnergyStorageThing = createEnergyStorageThing;
