import mqtt from "mqtt";
import { COMPONENT_NAMES, ComponentName, commandTopic, telemetryTopic } from "../src/sources";

/**
 * Emulatore di componente fisico. Sta fuori dal gemello di proposito: qui e'
 * la parte reale, il dispositivo che sarebbe collegato al bus di bordo.
 * Pubblica le proprie misure e, se e' l'attuatore, ascolta i comandi.
 *
 * Uso:
 *   npm run device -- energyStorage
 *   npm run device -- powerUnit
 *   npm run device -- controlActuator
 */

const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const periodMs = Number(process.env.DEVICE_PERIOD_MS ?? "2000");

const requested = process.argv[2];
const component = COMPONENT_NAMES.find(
  (name) => name.toLowerCase() === (requested ?? "").toLowerCase()
);

if (!component) {
  console.error(`Componente non valido: '${requested ?? ""}'. Attesi: ${COMPONENT_NAMES.join(", ")}`);
  process.exit(1);
}

// Valori scelti diversi da quelli del modello, cosi' su dashboard e log si
// vede subito cosa arriva dalla parte reale.
const readings: Record<ComponentName, () => Record<string, unknown>> = {
  energyStorage: () => ({
    // SoH sotto la soglia diagnostica: il Diagnostic Tool deve reagire.
    batterySoH: 81 + Math.sin(Date.now() / 20000),
    voltageV: 402 + Math.sin(Date.now() / 9000) * 3,
    currentA: 118 + Math.sin(Date.now() / 7000) * 12,
    temperatureC: 47 + Math.sin(Date.now() / 15000) * 2
  }),
  powerUnit: () => ({
    engineRPM: 3400 + Math.sin(Date.now() / 8000) * 600,
    torqueNm: 265 + Math.sin(Date.now() / 6000) * 25,
    temperatureC: 96 + Math.sin(Date.now() / 11000) * 4,
    speedKmh: 104 + Math.sin(Date.now() / 10000) * 8
  }),
  controlActuator: () => ({
    driveMode: "Sport",
    regenIntensity: 2
  })
};

const client = mqtt.connect(brokerUrl, { reconnectPeriod: 2000 });
const topic = telemetryTopic(component);

client.on("connect", () => {
  console.log(`[Device:${component}] collegato a ${brokerUrl}`);
  console.log(`[Device:${component}] pubblica su '${topic}' ogni ${periodMs} ms`);

  if (component === "controlActuator") {
    const commands = commandTopic(component);
    client.subscribe(commands, () => console.log(`[Device:${component}] in ascolto comandi su '${commands}'`));
  }
});

client.on("message", (receivedTopic, payload) => {
  console.log(`[Device:${component}] comando ricevuto dal gemello: ${payload.toString()}`);
});

client.on("error", (error) => {
  console.error(`[Device:${component}] errore MQTT:`, error.message);
});

setInterval(() => {
  if (!client.connected) {
    return;
  }
  client.publish(topic, JSON.stringify(readings[component]()));
}, periodMs);

process.on("SIGINT", () => {
  console.log(`\n[Device:${component}] scollegato. Il gemello deve tornare alla simulazione.`);
  client.end(false, {}, () => process.exit(0));
});
