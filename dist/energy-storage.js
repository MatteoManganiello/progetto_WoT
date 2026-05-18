"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEnergyStorageThing = exports.ENERGY_STORAGE_TD = void 0;
exports.ENERGY_STORAGE_TD = {
    "@context": ["https://www.w3.org/2019/wot/td/v1"],
    title: "EnergyStorage",
    securityDefinitions: {
        nosec_sc: { scheme: "nosec" }
    },
    security: ["nosec_sc"],
    properties: {
        batterySoC: { type: "number", unit: "%", observable: true, readOnly: true },
        batterySoH: { type: "number", unit: "%", observable: true, readOnly: true },
        voltageV: { type: "number", unit: "V", observable: true, readOnly: true },
        currentA: { type: "number", unit: "A", observable: true, readOnly: true },
        temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true },
        estimatedRangeKm: { type: "number", unit: "km", observable: true, readOnly: true }
    }
};
const createEnergyStorageThing = async (wot, simulation) => {
    const state = simulation.state;
    const thing = await wot.produce(exports.ENERGY_STORAGE_TD);
    thing.setPropertyReadHandler("batterySoC", async () => state.batterySoC);
    thing.setPropertyReadHandler("batterySoH", async () => state.batterySoH);
    thing.setPropertyReadHandler("voltageV", async () => state.voltageV);
    thing.setPropertyReadHandler("currentA", async () => state.currentA);
    thing.setPropertyReadHandler("temperatureC", async () => state.temperatureC);
    thing.setPropertyReadHandler("estimatedRangeKm", async () => state.estimatedRangeKm);
    return thing;
};
exports.createEnergyStorageThing = createEnergyStorageThing;
