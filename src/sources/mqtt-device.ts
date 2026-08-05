import mqtt, { MqttClient } from "mqtt";
import { ActuatorDeviceSource, DeviceSource } from "./device-source";
import { ActuatorSource, ComponentSource, ControlActuatorReading } from "./types";

/**
 * Canale verso i componenti fisici: i dispositivi reali pubblicano qui le
 * proprie misure e ricevono i comandi, su topic dedicati.
 *
 * Da non confondere con il binding MQTT di node-wot (`server.ts`): quello
 * espone il gemello ai consumer, questo raccoglie il dato dalla parte reale.
 */

/** Radice dei topic riservati ai componenti fisici. */
export const DEVICE_TOPIC_ROOT = "wot/proactivedrive/devices";

export const telemetryTopic = (component: string) => `${DEVICE_TOPIC_ROOT}/${component}/telemetry`;
export const commandTopic = (component: string) => `${DEVICE_TOPIC_ROOT}/${component}/commands`;

export type DeviceTransport = {
  client: MqttClient;
  close: () => Promise<void>;
};

export const connectDeviceTransport = (brokerUrl: string): DeviceTransport => {
  const client = mqtt.connect(brokerUrl, { reconnectPeriod: 2000 });
  client.on("error", (error) => {
    console.warn("[Devices] errore sul canale dei componenti fisici:", error.message);
  });
  return {
    client,
    close: () => new Promise<void>((resolve) => client.end(false, {}, () => resolve()))
  };
};

const subscribeTelemetry = <TReading extends object>(
  client: MqttClient,
  source: DeviceSource<TReading>
) => {
  const topic = telemetryTopic(source.component);
  client.subscribe(topic, (error) => {
    if (error) {
      console.warn(`[Devices] sottoscrizione a '${topic}' fallita:`, error.message);
      return;
    }
    console.log(`[Devices] '${source.component}' reale: in ascolto su '${topic}'`);
  });

  client.on("message", (receivedTopic, payload) => {
    if (receivedTopic !== topic) {
      return;
    }
    try {
      const reading = JSON.parse(payload.toString()) as Partial<TReading>;
      source.accept(reading);
    } catch (error) {
      console.warn(`[Devices] misura non leggibile da '${topic}':`, error);
    }
  });
};

/**
 * Collega un componente reale: le misure arrivano da MQTT, il fallback simulato
 * copre le grandezze mancanti e i periodi di silenzio.
 */
export const createMqttDeviceSource = <TReading extends object>(
  transport: DeviceTransport,
  fallback: ComponentSource<TReading>,
  stalenessMs?: number
): ComponentSource<TReading> => {
  const source = new DeviceSource<TReading>(fallback.component, fallback, { stalenessMs });
  subscribeTelemetry(transport.client, source);
  return source;
};

/** Variante attuabile: i comandi risalgono al dispositivo sul topic dedicato. */
export const createMqttActuatorSource = (
  transport: DeviceTransport,
  fallback: ActuatorSource,
  stalenessMs?: number
): ActuatorSource => {
  const topic = commandTopic(fallback.component);
  const source = new ActuatorDeviceSource(
    fallback.component,
    fallback,
    (name, value) => {
      transport.client.publish(topic, JSON.stringify({ action: name, value }));
      console.log(`[Devices] comando '${name}' inoltrato al dispositivo reale su '${topic}'`);
    },
    { stalenessMs }
  );
  subscribeTelemetry<ControlActuatorReading>(transport.client, source);
  return source;
};
