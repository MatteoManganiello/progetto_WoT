import { DRIVE_MODES, Simulation } from "./sim-state";
import { isDriveMode } from "./thing";
import { readInteractionInput } from "./wot-io";

/**
 * Thing WoT "ControlActuator": attuatore di controllo del powertrain.
 *
 * Espone come Properties le due variabili di controllo (modalita' di guida e
 * intensita' di rigenerazione) e come Actions i comandi che le modificano.
 */
export const CONTROL_ACTUATOR_TD: WoT.ExposedThingInit = {
  "@context": "https://www.w3.org/2022/wot/td/v1.1",
  "@type": "Thing",
  id: "urn:dev:ops:proactivedrive-controlactuator",
  title: "ControlActuator",
  description: "Gemello digitale della centralina che ripartisce la propulsione.",
  securityDefinitions: {
    nosec_sc: { scheme: "nosec" }
  },
  security: ["nosec_sc"],
  properties: {
    driveMode: { type: "string", enum: DRIVE_MODES, observable: true, readOnly: true },
    regenIntensity: {
      type: "number",
      minimum: 0,
      maximum: 3,
      observable: true,
      readOnly: true,
      description: "Intensita' della frenata rigenerativa (0 = mai impostata)."
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
  }
};

export const createControlActuatorThing = async (wot: typeof WoT, simulation: Simulation) => {
  const thing = await wot.produce(CONTROL_ACTUATOR_TD);

  thing.setPropertyReadHandler("driveMode", async () => simulation.state.driveMode);
  thing.setPropertyReadHandler("regenIntensity", async () => simulation.state.regenIntensity);

  thing.setActionHandler("setDriveMode", async (params) => {
    const mode = await readInteractionInput(params);
    if (!isDriveMode(mode)) {
      throw new Error(`Modalita' non valida: ${String(mode)}`);
    }
    simulation.setDriveMode(mode);
    console.log(`[ControlActuator] setDriveMode(${mode})`);
    return { activeMode: simulation.state.driveMode };
  });

  thing.setActionHandler("triggerRegen", async (params) => {
    const raw = await readInteractionInput(params);
    const intensity = Number(raw);
    if (!Number.isFinite(intensity)) {
      throw new Error(`Intensita' rigenerazione non valida: ${String(raw)}`);
    }
    simulation.setRegenIntensity(intensity);
    console.log(`[ControlActuator] triggerRegen(${intensity})`);
    return { regenIntensity: simulation.state.regenIntensity };
  });

  return thing;
};
