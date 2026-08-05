import { DRIVE_MODES, DriveMode } from "./sim-state";
import { ActuatorSource } from "./sources";
import { readInteractionInput } from "./wot-io";

/**
 * `PowerUnit` e `ControlActuator` espongono gli stessi due comandi: il primo
 * perche' e' l'oggetto del comando, la seconda perche' ne e' l'attuatore. Le
 * Thing restano distinte, la dichiarazione dei comandi sta qui una volta sola.
 */
export const ACTUATOR_ACTIONS: WoT.ExposedThingInit["actions"] = {
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
};

export const isDriveMode = (value: unknown): value is DriveMode =>
  typeof value === "string" && (DRIVE_MODES as string[]).includes(value);

/** Collega i comandi alla porta dell'attuatore, che decide dove farli finire. */
export const bindActuatorActions = (
  thing: WoT.ExposedThing,
  actuator: ActuatorSource,
  label: string
) => {
  thing.setActionHandler("setDriveMode", async (params) => {
    const mode = await readInteractionInput(params);
    if (!isDriveMode(mode)) {
      throw new Error(`Modalita' non valida: ${String(mode)}`);
    }
    actuator.setDriveMode(mode);
    console.log(`[${label}] setDriveMode(${mode})`);
    return { activeMode: actuator.snapshot().driveMode };
  });

  thing.setActionHandler("triggerRegen", async (params) => {
    const raw = await readInteractionInput(params);
    const intensity = Number(raw);
    if (!Number.isFinite(intensity)) {
      throw new Error(`Intensita' rigenerazione non valida: ${String(raw)}`);
    }
    actuator.setRegenIntensity(intensity);
    console.log(`[${label}] triggerRegen(${intensity})`);
    return { regenIntensity: actuator.snapshot().regenIntensity };
  });
};
