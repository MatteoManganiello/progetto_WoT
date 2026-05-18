import { createSimulation, DRIVE_MODES, SimulationState } from "./sim-state";

export const CONTROL_ACTUATOR_TD = {
  "@context": ["https://www.w3.org/2019/wot/td/v1"],
  title: "ControlActuator",
  securityDefinitions: {
    nosec_sc: { scheme: "nosec" }
  },
  security: ["nosec_sc"],
  properties: {
    driveMode: { type: "string", enum: DRIVE_MODES, observable: true, readOnly: true },
    controlMode: { type: "string", enum: ["Manual"], observable: true, readOnly: true },
    regenIntensity: { type: "number", minimum: 0, maximum: 3, observable: true, readOnly: true },
    regenMode: { type: "string", enum: ["Manual"], observable: true, readOnly: true }
  },
  actions: {
    setDriveMode: {
      input: { type: "string", enum: DRIVE_MODES }
    },
    triggerRegen: {
      input: { type: "number", minimum: 1, maximum: 3 }
    }
  }
};

export const createControlActuatorThing = async (wot: any, simulation: ReturnType<typeof createSimulation>) => {
  const state: SimulationState = simulation.state;
  const thing = await wot.produce(CONTROL_ACTUATOR_TD);

  const resolveInput = async (value: unknown): Promise<unknown> => {
    if (value && typeof value === "object") {
      if ("arrayBuffer" in value && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function") {
        const buffer = Buffer.from(await (value as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
        const text = buffer.toString();
        if (text.length === 0) {
          return undefined;
        }
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      if ("value" in value && typeof (value as { value?: unknown }).value === "function") {
        return (value as { value: () => Promise<unknown> }).value();
      }
    }
    return value;
  };

  const readStringInput = (value: unknown, keys: string[]): string => {
    if (typeof value === "string") {
      let text = value.trim();
      text = text.replace(/\\"/g, "\"");
      if (text.startsWith("\"") && text.endsWith("\"")) {
        text = text.slice(1, -1);
      }
      return text;
    }
    if (value && typeof value === "object") {
      for (const key of keys) {
        if (key in value) {
          return String((value as Record<string, unknown>)[key]);
        }
      }
      if ("value" in value) {
        return String((value as Record<string, unknown>).value);
      }
    }
    return String(value);
  };

  const readNumberInput = (value: unknown, keys: string[]): number => {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.replace(/\\"/g, "\"").replace(/^(\")|(\")$/g, "").trim();
      return Number(normalized);
    }
    if (value && typeof value === "object") {
      for (const key of keys) {
        if (key in value) {
          return Number((value as Record<string, unknown>)[key]);
        }
      }
      if ("value" in value) {
        return Number((value as Record<string, unknown>).value);
      }
    }
    return Number(value);
  };

  thing.setPropertyReadHandler("driveMode", async () => state.driveMode);
  thing.setPropertyReadHandler("controlMode", async () => state.controlMode);
  thing.setPropertyReadHandler("regenIntensity", async () => state.regenIntensity);
  thing.setPropertyReadHandler("regenMode", async () => state.regenMode);

  thing.setActionHandler("setDriveMode", async (value: unknown) => {
    const resolved = await resolveInput(value);
    const mode = readStringInput(resolved, ["mode", "driveMode"]) as typeof DRIVE_MODES[number];
    if (!DRIVE_MODES.includes(mode)) {
      throw new Error("Invalid drive mode");
    }
    simulation.setDriveMode(mode);
    console.log(`[ControlActuator] driveMode -> ${state.driveMode}`);
    return { activeMode: state.driveMode };
  });

  thing.setActionHandler("triggerRegen", async (value: unknown) => {
    const resolved = await resolveInput(value);
    const intensity = readNumberInput(resolved, ["intensity", "regenIntensity"]);
    if (!Number.isFinite(intensity)) {
      throw new Error("Invalid regen intensity");
    }
    simulation.setRegenIntensity(intensity);
    console.log(`[ControlActuator] regenIntensity -> ${state.regenIntensity}`);
    return { regenIntensity: state.regenIntensity };
  });

return thing;
};
