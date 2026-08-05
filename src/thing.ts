import { ACTUATOR_ACTIONS, bindActuatorActions } from "./actuator-actions";
import { TwinSources } from "./sources";
import { bindReadHandlers } from "./wot-io";

/**
 * Thing "PowerUnit": gruppo propulsore ibrido (motore termico + elettrico).
 * Stato osservabile come Properties, controllo come Actions, diagnostica come
 * Events. Sicurezza `nosec`, sufficiente per una demo locale.
 *
 * Non sa se il propulsore sia simulato o reale: legge da `sources.powerUnit` e
 * inoltra i comandi a `sources.controlActuator`.
 */
export const POWER_UNIT_TD: WoT.ExposedThingInit = {
  "@context": "https://www.w3.org/2022/wot/td/v1.1",
  "@type": "Thing",
  id: "urn:dev:ops:proactivedrive-powerunit",
  title: "PowerUnit",
  description:
    "Gemello digitale del gruppo propulsore ibrido (motore termico + motore elettrico).",
  securityDefinitions: {
    nosec_sc: { scheme: "nosec" }
  },
  security: ["nosec_sc"],
  properties: {
    batterySoC: {
      type: "number",
      unit: "%",
      observable: true,
      readOnly: true,
      description: "Stato di carica del pacco batteria."
    },
    engineRPM: { type: "number", unit: "rpm", observable: true, readOnly: true },
    torqueNm: { type: "number", unit: "Nm", observable: true, readOnly: true },
    temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true },
    systemEfficiency: {
      type: "number",
      unit: "km/kWh",
      observable: true,
      readOnly: true,
      description: "Efficienza istantanea filtrata con media mobile esponenziale."
    },
    estimatedRangeKm: {
      type: "number",
      unit: "km",
      observable: true,
      readOnly: true,
      description: "Autonomia residua stimata dallo stato di carica."
    }
  },
  actions: ACTUATOR_ACTIONS,
  events: {
    criticalOverheat: {
      description: "Temperatura oltre la soglia critica su inverter o motore.",
      data: {
        type: "object",
        properties: { temperatureC: { type: "number", unit: "celsius" } }
      }
    },
    lowEnergyWarning: {
      description: "Autonomia stimata sotto i 10 km.",
      data: {
        type: "object",
        properties: { estimatedRangeKm: { type: "number", unit: "km" } }
      }
    },
    anomalyDetected: {
      description: "Consumi anomali persistenti: possibile guasto.",
      data: {
        type: "object",
        properties: {
          systemEfficiency: { type: "number", unit: "km/kWh" },
          torqueNm: { type: "number", unit: "Nm" }
        }
      }
    }
  }
};

export const createPowerUnitThing = async (wot: typeof WoT, sources: TwinSources) => {
  const thing = await wot.produce(POWER_UNIT_TD);

  bindReadHandlers(thing, sources.powerUnit, [
    "batterySoC", "engineRPM", "torqueNm", "temperatureC", "systemEfficiency", "estimatedRangeKm"
  ]);
  bindActuatorActions(thing, sources.controlActuator, "PowerUnit");

  return thing;
};
