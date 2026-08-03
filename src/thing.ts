import { DRIVE_MODES, DriveMode, Simulation } from "./sim-state";
import { readInteractionInput } from "./wot-io";

/**
 * Thing WoT "PowerUnit": gruppo propulsore ibrido (motore termico + elettrico).
 *
 * Espone lo stato osservabile del propulsore come Properties, il controllo come
 * Actions e la diagnostica reattiva come Events. La Thing Description e' in
 * JSON-LD secondo il @context W3C WoT 1.1, con schema di sicurezza `nosec`
 * adeguato al contesto dimostrativo.
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
  actions: {
    setDriveMode: {
      description: "Imposta la modalita' di propulsione.",
      idempotent: true,
      input: { type: "string", enum: DRIVE_MODES },
      output: {
        type: "object",
        properties: { activeMode: { type: "string", enum: DRIVE_MODES } }
      }
    },
    triggerRegen: {
      description: "Imposta l'intensita' della frenata rigenerativa.",
      idempotent: true,
      input: { type: "number", minimum: 1, maximum: 3 },
      output: {
        type: "object",
        properties: { regenIntensity: { type: "number" } }
      }
    }
  },
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

export const isDriveMode = (value: unknown): value is DriveMode =>
  typeof value === "string" && (DRIVE_MODES as string[]).includes(value);

export const createPowerUnitThing = async (wot: typeof WoT, simulation: Simulation) => {
  const thing = await wot.produce(POWER_UNIT_TD);

  thing.setPropertyReadHandler("batterySoC", async () => simulation.state.batterySoC);
  thing.setPropertyReadHandler("engineRPM", async () => simulation.state.engineRPM);
  thing.setPropertyReadHandler("torqueNm", async () => simulation.state.torqueNm);
  thing.setPropertyReadHandler("temperatureC", async () => simulation.state.temperatureC);
  thing.setPropertyReadHandler("systemEfficiency", async () => simulation.state.systemEfficiency);
  thing.setPropertyReadHandler("estimatedRangeKm", async () => simulation.state.estimatedRangeKm);

  thing.setActionHandler("setDriveMode", async (params) => {
    const mode = await readInteractionInput(params);
    if (!isDriveMode(mode)) {
      throw new Error(`Modalita' non valida: ${String(mode)}`);
    }
    simulation.setDriveMode(mode);
    console.log(`[PowerUnit] setDriveMode(${mode})`);
    return { activeMode: simulation.state.driveMode };
  });

  thing.setActionHandler("triggerRegen", async (params) => {
    const raw = await readInteractionInput(params);
    const intensity = Number(raw);
    if (!Number.isFinite(intensity)) {
      throw new Error(`Intensita' rigenerazione non valida: ${String(raw)}`);
    }
    simulation.setRegenIntensity(intensity);
    console.log(`[PowerUnit] triggerRegen(${intensity})`);
    return { regenIntensity: simulation.state.regenIntensity };
  });

  return thing;
};
