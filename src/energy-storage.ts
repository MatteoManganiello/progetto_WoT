import { TwinRegistry } from "./twin/registry";
import { TWIN_STATUS_SCHEMA } from "./wot-io";

/** Thing WoT "EnergyStorage": faccia digitale del pacco batteria. */
export const ENERGY_STORAGE_TD: WoT.ExposedThingInit = {
  "@context": [
    "https://www.w3.org/2022/wot/td/v1.1",
    { mqv: "https://www.w3.org/2019/wot/mqtt#" }
  ],
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
    batterySoH: { type: "number", unit: "%", observable: true, readOnly: true },
    voltageV: { type: "number", unit: "V", observable: true, readOnly: true },
    currentA: {
      type: "number",
      unit: "A",
      observable: true,
      readOnly: true,
      description: "Negativa durante la frenata rigenerativa."
    },
    temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true },
    estimatedRangeKm: {
      type: "number",
      unit: "km",
      observable: true,
      readOnly: true,
      description: "Indicatore calcolato dal gemello a partire dallo stato di carica."
    },
    twinStatus: { ...TWIN_STATUS_SCHEMA, observable: true, readOnly: true }
  }
};

export const createEnergyStorageThing = async (wot: typeof WoT, twin: TwinRegistry) => {
  const thing = await wot.produce(ENERGY_STORAGE_TD);

  thing.setPropertyReadHandler("batterySoC", async () => twin.snapshot().batterySoC);
  thing.setPropertyReadHandler("batterySoH", async () => twin.snapshot().batterySoH);
  thing.setPropertyReadHandler("voltageV", async () => twin.snapshot().voltageV);
  thing.setPropertyReadHandler("currentA", async () => twin.snapshot().currentA);
  thing.setPropertyReadHandler("temperatureC", async () => twin.snapshot().batteryTemperatureC);
  thing.setPropertyReadHandler("estimatedRangeKm", async () => twin.snapshot().estimatedRangeKm);
  thing.setPropertyReadHandler("twinStatus", async () => twin.deviceStatus("battery"));

  return thing;
};
