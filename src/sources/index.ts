import { Simulation } from "../sim-state";
import { connectDeviceTransport, createMqttActuatorSource, createMqttDeviceSource } from "./mqtt-device";
import { createSimulatedSources } from "./simulated";
import { COMPONENT_NAMES, ComponentName, TwinSources } from "./types";

export * from "./types";
export { DeviceSource, ActuatorDeviceSource } from "./device-source";
export { createSimulatedSources } from "./simulated";
export { DEVICE_TOPIC_ROOT, commandTopic, telemetryTopic } from "./mqtt-device";

/**
 * Decide componente per componente se lo stato viene dal modello o da un
 * dispositivo fisico. La scelta sta fuori dal codice (`REAL_COMPONENTS`),
 * cosi' il livello WoT non cambia quando una parte diventa reale.
 */

/** Legge `REAL_COMPONENTS`, ignorando i nomi non riconosciuti. */
export const parseRealComponents = (raw: string | undefined): ComponentName[] => {
  if (!raw) {
    return [];
  }
  const requested = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  const valid: ComponentName[] = [];
  for (const entry of requested) {
    const match = COMPONENT_NAMES.find((name) => name.toLowerCase() === entry.toLowerCase());
    if (match) {
      valid.push(match);
    } else {
      console.warn(`[Devices] componente '${entry}' sconosciuto, ignorato. Attesi: ${COMPONENT_NAMES.join(", ")}`);
    }
  }
  return valid;
};

export type TwinSourcesConfig = {
  simulation: Simulation;
  /** Broker su cui i dispositivi fisici pubblicano. Assente = tutto simulato. */
  brokerUrl?: string;
  realComponents?: ComponentName[];
  stalenessMs?: number;
};

export type ComposedTwinSources = {
  sources: TwinSources;
  /** Componenti per cui e' stato predisposto un collegamento al dispositivo reale. */
  realComponents: ComponentName[];
  close: () => Promise<void>;
};

export const createTwinSources = (config: TwinSourcesConfig): ComposedTwinSources => {
  const simulated = createSimulatedSources(config.simulation);
  const realComponents = config.realComponents ?? [];

  // Senza componenti reali dichiarati, o senza broker, il gemello resta
  // interamente simulato: e' il comportamento di default del progetto.
  if (realComponents.length === 0 || !config.brokerUrl) {
    if (realComponents.length > 0) {
      console.warn("[Devices] nessun broker disponibile: i componenti reali restano simulati.");
    }
    return { sources: simulated, realComponents: [], close: async () => undefined };
  }

  const transport = connectDeviceTransport(config.brokerUrl);
  const sources: TwinSources = { ...simulated };

  if (realComponents.includes("powerUnit")) {
    sources.powerUnit = createMqttDeviceSource(transport, simulated.powerUnit, config.stalenessMs);
  }
  if (realComponents.includes("energyStorage")) {
    sources.energyStorage = createMqttDeviceSource(transport, simulated.energyStorage, config.stalenessMs);
  }
  if (realComponents.includes("controlActuator")) {
    sources.controlActuator = createMqttActuatorSource(transport, simulated.controlActuator, config.stalenessMs);
  }

  console.log(`[Devices] componenti collegati alla parte reale: ${realComponents.join(", ")}`);
  return { sources, realComponents, close: transport.close };
};

/** Riepilogo leggibile dell'origine corrente di ogni componente. */
export const describeOrigins = (sources: TwinSources) =>
  COMPONENT_NAMES.map((name) => `${name}=${sources[name].origin()}`).join(" ");
