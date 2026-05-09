import { createSimulation, DRIVE_MODES, SimulationState } from "./sim-state";

export const POWER_UNIT_TD = {
  "@context": ["https://www.w3.org/2019/wot/td/v1"],
  title: "PowerUnit",
  securityDefinitions: {
    nosec_sc: { scheme: "nosec" }
  },
  security: ["nosec_sc"],
  properties: {
    systemEfficiency: { type: "number", unit: "km/kWh", observable: true, readOnly: true },
    batterySoC: { type: "number", unit: "%", observable: true, readOnly: true },
    engineStatus: { type: "string", enum: ["Off", "Idle", "Running"], observable: true, readOnly: true },
    thermalHealth: { type: "number", unit: "%", observable: true, readOnly: true },
    engineRPM: { type: "number", unit: "rpm", observable: true, readOnly: true },
    torqueNm: { type: "number", unit: "Nm", observable: true, readOnly: true },
    temperatureC: { type: "number", unit: "celsius", observable: true, readOnly: true },
    estimatedRangeKm: { type: "number", unit: "km", observable: true, readOnly: true },
    speedKmh: { type: "number", unit: "km/h", observable: true, readOnly: true }
  },
  actions: {
    setDriveMode: {
      input: {
        type: "string",
        enum: DRIVE_MODES
      }
    },
    triggerRegen: {
      input: {
        type: "number",
        minimum: 1,
        maximum: 3
      }
    }
  },
  events: {
    criticalOverheat: {
      data: {
        type: "object",
        properties: {
          temperatureC: { type: "number", unit: "celsius" }
        }
      }
    },
    lowEnergyWarning: {
      data: {
        type: "object",
        properties: {
          estimatedRangeKm: { type: "number", unit: "km" }
        }
      }
    },
    anomalyDetected: {
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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createPowerUnitThing = async (wot: any, simulation: ReturnType<typeof createSimulation>) => {
  const state: SimulationState = simulation.state;
  const thing = await wot.produce(POWER_UNIT_TD);

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

  // Handlers expose the live simulation state to WoT clients.
  thing.setPropertyReadHandler("systemEfficiency", async () => state.systemEfficiency);
  thing.setPropertyReadHandler("batterySoC", async () => state.batterySoC);
  thing.setPropertyReadHandler("engineStatus", async () => state.engineStatus);
  thing.setPropertyReadHandler("thermalHealth", async () => state.thermalHealth);
  thing.setPropertyReadHandler("engineRPM", async () => state.engineRPM);
  thing.setPropertyReadHandler("torqueNm", async () => state.torqueNm);
  thing.setPropertyReadHandler("temperatureC", async () => state.temperatureC);
  thing.setPropertyReadHandler("estimatedRangeKm", async () => state.estimatedRangeKm);
  thing.setPropertyReadHandler("speedKmh", async () => state.speedKmh);

  // Drive mode controls the simplified powertrain behavior.
  thing.setActionHandler("setDriveMode", async (value: unknown) => {
    const resolved = await resolveInput(value);
    const mode = readStringInput(resolved, ["mode", "driveMode"]) as typeof DRIVE_MODES[number];
    if (!DRIVE_MODES.includes(mode)) {
      throw new Error("Invalid drive mode");
    }
    simulation.setDriveMode(mode);
    console.log(`[PowerUnit] driveMode -> ${state.driveMode}`);
    return { activeMode: state.driveMode };
  });

  thing.setActionHandler("triggerRegen", async (value: unknown) => {
    const resolved = await resolveInput(value);
    const rawIntensity = readNumberInput(resolved, ["intensity", "regenIntensity"]);
    const intensity = clamp(rawIntensity, 1, 3);
    if (!Number.isFinite(intensity)) {
      throw new Error("Invalid regen intensity");
    }
    simulation.setRegenIntensity(intensity);
    console.log(`[PowerUnit] regenIntensity -> ${state.regenIntensity}`);
    return { regenIntensity: state.regenIntensity };
  });

  return thing;
};
