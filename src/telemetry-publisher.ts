import mqtt from "mqtt";
import { createSimulation } from "./sim-state";

type TelemetrySample = {
  timestamp: string;
  batterySoC: number;
  batterySoH: number;
  engineRPM: number;
  torqueNm: number;
  temperatureC: number;
  thermalHealth: number;
  systemEfficiency: number;
  driveMode: string;
  speedKmh: number;
  estimatedRangeKm: number;
};

export const startTelemetryPublisher = (
  simulation: ReturnType<typeof createSimulation>,
  mqttUrl: string
) => {
  const client = mqtt.connect(mqttUrl);

  client.on("connect", () => {
    console.log(`[Telemetry] MQTT connected to ${mqttUrl}`);
  });

  client.on("error", (error) => {
    console.warn("[Telemetry] MQTT error", error);
  });

  const publishSample = () => {
    const state = simulation.state;
    const sample: TelemetrySample = {
      timestamp: new Date().toISOString(),
      batterySoC: state.batterySoC,
      batterySoH: state.batterySoH,
      engineRPM: state.engineRPM,
      torqueNm: state.torqueNm,
      temperatureC: state.temperatureC,
      thermalHealth: state.thermalHealth,
      systemEfficiency: state.systemEfficiency,
      driveMode: state.driveMode,
      speedKmh: state.speedKmh,
      estimatedRangeKm: state.estimatedRangeKm
    };

    const payload = JSON.stringify(sample);
    client.publish("wot/proactivedrive/telemetry", payload, { qos: 0 });
  };

  const timer = setInterval(publishSample, 2000);

  return () => {
    clearInterval(timer);
    client.end(true);
  };
};
