"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTelemetryPublisher = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const startTelemetryPublisher = (simulation, mqttUrl) => {
    const client = mqtt_1.default.connect(mqttUrl);
    client.on("connect", () => {
        console.log(`[Telemetry] MQTT connected to ${mqttUrl}`);
    });
    client.on("error", (error) => {
        console.warn("[Telemetry] MQTT error", error);
    });
    const publishSample = () => {
        const state = simulation.state;
        const sample = {
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
exports.startTelemetryPublisher = startTelemetryPublisher;
