import mqtt, { MqttClient } from "mqtt";
import {
  DeviceCommand,
  DeviceId,
  DeviceTelemetry,
  ReadingsFor,
  TELEMETRY_WILDCARD,
  commandTopic,
  deviceFromTopic,
  parseCommand,
  parseTelemetry,
  telemetryTopic
} from "./protocol";

/**
 * Trasporto MQTT del lato fisico. E' volutamente separato dalla libreria WoT:
 * rappresenta il "campo" (sensori e attuatori), non l'interfaccia web semantica.
 * Le Thing WoT vivono sopra il gemello digitale, non qui.
 */
export type DeviceBus = {
  isConnected: () => boolean;
  publishTelemetry: <D extends DeviceId>(deviceId: D, readings: ReadingsFor<D>, seq: number) => void;
  publishCommand: (deviceId: DeviceId, command: DeviceCommand) => void;
  onTelemetry: (handler: (telemetry: DeviceTelemetry) => void) => void;
  onCommand: (deviceId: DeviceId, handler: (command: DeviceCommand) => void) => void;
  close: () => Promise<void>;
};

type DeviceBusOptions = {
  brokerUrl: string;
  clientLabel: string;
  /** Iscrizione alla telemetria di tutti i dispositivi (lato gemello digitale). */
  subscribeTelemetry?: boolean;
  /** Iscrizione ai comandi dei dispositivi indicati (lato dispositivo). */
  subscribeCommandsFor?: DeviceId[];
};

const parseJson = (payload: Buffer): unknown => {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return undefined;
  }
};

export const createDeviceBus = (options: DeviceBusOptions): DeviceBus => {
  const telemetryHandlers: Array<(telemetry: DeviceTelemetry) => void> = [];
  const commandHandlers = new Map<DeviceId, Array<(command: DeviceCommand) => void>>();

  const client: MqttClient = mqtt.connect(options.brokerUrl, {
    clientId: `${options.clientLabel}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 2000,
    connectTimeout: 4000
  });

  client.on("connect", () => {
    console.log(`[Bus:${options.clientLabel}] connesso al broker ${options.brokerUrl}`);
    if (options.subscribeTelemetry) {
      client.subscribe(TELEMETRY_WILDCARD, { qos: 0 });
    }
    for (const deviceId of options.subscribeCommandsFor ?? []) {
      client.subscribe(commandTopic(deviceId), { qos: 1 });
    }
  });

  // Il broker puo' essere assente: e' un caso previsto, non un errore fatale.
  // Il gemello digitale continua a funzionare in modalita' modello.
  let warnedOffline = false;
  client.on("error", () => {
    if (!warnedOffline) {
      warnedOffline = true;
      console.warn(`[Bus:${options.clientLabel}] broker non raggiungibile, riprovo in background`);
    }
  });
  client.on("reconnect", () => {
    warnedOffline = false;
  });

  client.on("message", (topic, payload) => {
    const parsed = parseJson(payload);
    if (parsed === undefined) {
      return;
    }

    if (topic.endsWith("/telemetry")) {
      const telemetry = parseTelemetry(parsed);
      if (telemetry) {
        telemetryHandlers.forEach((handler) => handler(telemetry));
      }
      return;
    }

    if (topic.endsWith("/command")) {
      const deviceId = deviceFromTopic(topic);
      const command = parseCommand(parsed);
      if (deviceId && command) {
        (commandHandlers.get(deviceId) ?? []).forEach((handler) => handler(command));
      }
    }
  });

  const sequenceByDevice = new Map<DeviceId, number>();

  return {
    isConnected: () => client.connected,

    publishTelemetry: (deviceId, readings, seq) => {
      if (!client.connected) {
        return;
      }
      sequenceByDevice.set(deviceId, seq);
      const message: DeviceTelemetry = {
        deviceId,
        timestamp: new Date().toISOString(),
        seq,
        readings
      };
      client.publish(telemetryTopic(deviceId), JSON.stringify(message), { qos: 0 });
    },

    publishCommand: (deviceId, command) => {
      if (!client.connected) {
        return;
      }
      client.publish(commandTopic(deviceId), JSON.stringify(command), { qos: 1 });
    },

    onTelemetry: (handler) => {
      telemetryHandlers.push(handler);
    },

    onCommand: (deviceId, handler) => {
      const handlers = commandHandlers.get(deviceId) ?? [];
      handlers.push(handler);
      commandHandlers.set(deviceId, handlers);
    },

    close: async () => {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  };
};
