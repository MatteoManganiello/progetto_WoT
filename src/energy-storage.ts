import { TwinSources } from "./sources";
import { bindReadHandlers } from "./wot-io";

/**
 * Thing WoT "EnergyStorage": pacco batteria ad alta tensione.
 *
 * Espone solo Properties: e' un sottosistema osservabile, non attuabile.
 * Legge dalla porta `sources.energyStorage`, indifferente al fatto che il pacco
 * sia simulato o un dispositivo reale collegato al sistema.
 */
export const ENERGY_STORAGE_TD: WoT.ExposedThingInit = {
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

export const createEnergyStorageThing = async (wot: typeof WoT, sources: TwinSources) => {
  const thing = await wot.produce(ENERGY_STORAGE_TD);

  bindReadHandlers(thing, sources.energyStorage, [
    "batterySoC", "batterySoH", "voltageV", "currentA", "temperatureC"
  ]);

  return thing;
};
