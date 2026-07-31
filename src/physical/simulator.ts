import { createDeviceBus } from "./device-bus";
import {
  ActuatorReadings,
  BatteryReadings,
  DEVICE_IDS,
  DeviceId,
  PowerUnitReadings
} from "./protocol";
import { DRIVE_MODES, DriveMode, createSimulation } from "../sim-state";

/**
 * PROCESSO DELLA PARTE FISICA.
 *
 * Questo eseguibile NON conosce la libreria WoT: e' un banco prova che si comporta
 * come l'hardware. Parla solo il protocollo di `protocol.ts` sul broker MQTT.
 * Sostituirlo con centraline reali significa spegnere questo processo e collegare
 * dispositivi che pubblichino sugli stessi topic: il gemello digitale non cambia.
 *
 * `SIM_DEVICES` permette di simulare solo un sottoinsieme dei dispositivi
 * (es. `SIM_DEVICES=battery`), cosi' da riprodurre lo scenario in cui una parte
 * del sistema e' reale e il resto no.
 */

const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const publishIntervalMs = Number(process.env.SIM_INTERVAL_MS ?? "1000");

const parseDevices = (): DeviceId[] => {
  const raw = process.env.SIM_DEVICES;
  if (!raw || raw.trim().toLowerCase() === "all") {
    return [...DEVICE_IDS];
  }
  const requested = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is DeviceId => (DEVICE_IDS as readonly string[]).includes(entry));

  if (requested.length === 0) {
    console.warn(`SIM_DEVICES="${raw}" non contiene dispositivi validi, simulo tutto.`);
    return [...DEVICE_IDS];
  }
  return requested;
};

const activeDevices = parseDevices();
const simulatesActuator = activeDevices.includes("actuator");

const simulation = createSimulation();

const bus = createDeviceBus({
  brokerUrl,
  clientLabel: "physical-sim",
  subscribeCommandsFor: simulatesActuator ? ["actuator"] : []
});

// L'attuatore fisico e' l'unico dispositivo che riceve comandi.
if (simulatesActuator) {
  bus.onCommand("actuator", (command) => {
    if (command.command === "setDriveMode") {
      if (!DRIVE_MODES.includes(command.value as DriveMode)) {
        console.warn(`[Device:actuator] modalita' rifiutata: ${command.value}`);
        return;
      }
      simulation.setDriveMode(command.value as DriveMode);
      console.log(`[Device:actuator] driveMode -> ${command.value}`);
      return;
    }
    simulation.setRegenIntensity(command.value);
    console.log(`[Device:actuator] regenIntensity -> ${simulation.state.regenIntensity}`);
  });
}

const powerUnitReadings = (): PowerUnitReadings => ({
  engineRPM: simulation.state.engineRPM,
  torqueNm: simulation.state.torqueNm,
  temperatureC: simulation.state.temperatureC,
  speedKmh: simulation.state.speedKmh,
  engineStatus: simulation.state.engineStatus,
  distanceKm: simulation.state.distanceKm,
  energyUsedKwh: simulation.state.energyUsedKwh
});

const batteryReadings = (): BatteryReadings => ({
  batterySoC: simulation.state.batterySoC,
  batterySoH: simulation.state.batterySoH,
  voltageV: simulation.state.voltageV,
  currentA: simulation.state.currentA,
  temperatureC: simulation.state.temperatureC
});

const actuatorReadings = (): ActuatorReadings => ({
  driveMode: simulation.state.driveMode,
  regenIntensity: simulation.state.regenIntensity
});

console.log(`Simulatore parte fisica avviato su ${brokerUrl}`);
console.log(`Dispositivi simulati: ${activeDevices.join(", ")}`);
console.log("I dispositivi non elencati restano assenti: il gemello digitale li coprira' con il modello.");

let seq = 0;
let lastConnected = false;

const timer = setInterval(() => {
  seq += 1;
  simulation.update();

  if (bus.isConnected() !== lastConnected) {
    lastConnected = bus.isConnected();
    console.log(`[Device] link MQTT ${lastConnected ? "attivo" : "caduto"}`);
  }

  if (activeDevices.includes("powerunit")) {
    bus.publishTelemetry("powerunit", powerUnitReadings(), seq);
  }
  if (activeDevices.includes("battery")) {
    bus.publishTelemetry("battery", batteryReadings(), seq);
  }
  if (simulatesActuator) {
    bus.publishTelemetry("actuator", actuatorReadings(), seq);
  }

  if (seq % 15 === 0 && bus.isConnected()) {
    console.log(
      `[Device] SoC ${simulation.state.batterySoC.toFixed(1)}% | ` +
      `Temp ${simulation.state.temperatureC.toFixed(1)}C | ` +
      `Mode ${simulation.state.driveMode}`
    );
  }
}, publishIntervalMs);

const shutdown = async () => {
  clearInterval(timer);
  await bus.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
