"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@node-wot/core");
const binding_http_1 = require("@node-wot/binding-http");
const binding_mqtt_1 = require("@node-wot/binding-mqtt");
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const path_1 = __importDefault(require("path"));
const thing_1 = require("./thing");
const energy_storage_1 = require("./energy-storage");
const control_actuator_1 = require("./control-actuator");
const sim_state_1 = require("./sim-state");
const telemetry_publisher_1 = require("./telemetry-publisher");
const diagnostic_tool_1 = require("./consumers/diagnostic-tool");
const httpPort = Number(process.env.HTTP_PORT ?? "8080");
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? "8091");
const mqttBrokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const mqttEnabled = (process.env.MQTT_ENABLED ?? "true").toLowerCase() === "true";
let mqttServerActive = false;
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
const historyFile = path_1.default.join(__dirname, "..", "data", "history.json");
const history = [];
const ensureHistoryDir = () => {
    const dir = path_1.default.dirname(historyFile);
    try {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    catch {
        // ignore directory creation errors
    }
};
const loadHistory = () => {
    try {
        const content = fs_1.default.readFileSync(historyFile, "utf-8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            history.push(...parsed.slice(-300));
        }
    }
    catch {
        // ignore missing or invalid history
    }
};
const saveHistory = () => {
    try {
        ensureHistoryDir();
        fs_1.default.writeFileSync(historyFile, JSON.stringify(history.slice(-300), null, 2));
    }
    catch (error) {
        console.warn("Failed to save history", error);
    }
};
const dashboardDir = path_1.default.join(__dirname, "..", "dashboard");
const contentTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css"
};
const startDashboardServer = () => {
    const server = http_1.default.createServer((req, res) => {
        if (req.url === "/api/history") {
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify(history));
            return;
        }
        const urlPath = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
        const safePath = path_1.default.normalize(urlPath).replace(/^([/\\])+/, "");
        const filePath = path_1.default.join(dashboardDir, safePath);
        if (!filePath.startsWith(dashboardDir)) {
            res.writeHead(400);
            res.end("Bad request");
            return;
        }
        fs_1.default.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end("Not Found");
                return;
            }
            const ext = path_1.default.extname(filePath);
            res.writeHead(200, {
                "Content-Type": contentTypes[ext] ?? "text/plain",
                "Cache-Control": "no-store"
            });
            res.end(data);
        });
    });
    server.listen(dashboardPort, () => {
        console.log(`Dashboard available on http://localhost:${dashboardPort}`);
    });
};
const servient = new core_1.Servient();
// HTTP exposes the TD and interactions; MQTT publishes updates via broker.
servient.addServer(new binding_http_1.HttpServer({
    port: httpPort,
    middleware: async (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        next();
    }
}));
const isMqttBrokerReachable = async (brokerUrl) => {
    try {
        const url = new URL(brokerUrl);
        return await new Promise((resolve) => {
            const socket = net_1.default.connect({ host: url.hostname, port: Number(url.port) || 1883 }, () => {
                socket.destroy();
                resolve(true);
            });
            socket.on("error", () => {
                socket.destroy();
                resolve(false);
            });
            socket.setTimeout(1500, () => {
                socket.destroy();
                resolve(false);
            });
        });
    }
    catch {
        return false;
    }
};
const startServient = async () => {
    if (mqttEnabled) {
        const reachable = await isMqttBrokerReachable(mqttBrokerUrl);
        if (reachable) {
            mqttServerActive = true;
            servient.addServer(new binding_mqtt_1.MqttBrokerServer({ uri: mqttBrokerUrl }));
        }
        else {
            mqttServerActive = false;
            console.warn(`MQTT broker not reachable at ${mqttBrokerUrl}. Starting in HTTP-only mode.`);
        }
    }
    try {
        return await servient.start();
    }
    catch (error) {
        console.error("Failed to start WoT servient", error);
        process.exit(1);
    }
};
startServient()
    .then(async (wot) => {
    const simulation = (0, sim_state_1.createSimulation)();
    loadHistory();
    const powerUnit = await (0, thing_1.createPowerUnitThing)(wot, simulation);
    const energyStorage = await (0, energy_storage_1.createEnergyStorageThing)(wot, simulation);
    const controlActuator = await (0, control_actuator_1.createControlActuatorThing)(wot, simulation);
    await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);
    console.log(`PowerUnit TD exposed over HTTP on http://localhost:${httpPort}/powerunit`);
    console.log(`EnergyStorage TD exposed over HTTP on http://localhost:${httpPort}/energystorage`);
    console.log(`ControlActuator TD exposed over HTTP on http://localhost:${httpPort}/controlactuator`);
    if (mqttServerActive) {
        console.log(`MQTT broker URL configured for events: ${mqttBrokerUrl}`);
    }
    else if (mqttEnabled) {
        console.log(`MQTT enabled, but broker is unavailable. Running without MQTT events.`);
    }
    else {
        console.log("MQTT disabled (set MQTT_ENABLED=true to enable).");
    }
    startDashboardServer();
    if (mqttServerActive) {
        (0, telemetry_publisher_1.startTelemetryPublisher)(simulation, mqttBrokerUrl);
    }
    (0, diagnostic_tool_1.startDiagnosticTool)({ baseUrl: `http://localhost:${httpPort}` });
    const intervalMs = 2000;
    let tickCount = 0;
    let lastEvents = {
        criticalOverheat: false,
        lowEnergyWarning: false,
        anomalyDetected: false
    };
    setInterval(() => {
        tickCount += 1;
        const events = simulation.update();
        history.push({
            timestamp: new Date().toISOString(),
            batterySoC: simulation.state.batterySoC,
            systemEfficiency: simulation.state.systemEfficiency,
            temperatureC: simulation.state.temperatureC
        });
        if (history.length > 300) {
            history.shift();
        }
        if (tickCount % 30 === 0) {
            saveHistory();
        }
        powerUnit.emitPropertyChange("systemEfficiency");
        powerUnit.emitPropertyChange("batterySoC");
        powerUnit.emitPropertyChange("engineStatus");
        powerUnit.emitPropertyChange("thermalHealth");
        powerUnit.emitPropertyChange("engineRPM");
        powerUnit.emitPropertyChange("torqueNm");
        powerUnit.emitPropertyChange("temperatureC");
        powerUnit.emitPropertyChange("estimatedRangeKm");
        powerUnit.emitPropertyChange("speedKmh");
        energyStorage.emitPropertyChange("batterySoC");
        energyStorage.emitPropertyChange("batterySoH");
        energyStorage.emitPropertyChange("voltageV");
        energyStorage.emitPropertyChange("currentA");
        energyStorage.emitPropertyChange("temperatureC");
        energyStorage.emitPropertyChange("estimatedRangeKm");
        controlActuator.emitPropertyChange("driveMode");
        controlActuator.emitPropertyChange("controlMode");
        controlActuator.emitPropertyChange("regenIntensity");
        controlActuator.emitPropertyChange("regenMode");
        if (events.criticalOverheat && !lastEvents.criticalOverheat) {
            powerUnit.emitEvent("criticalOverheat", { temperatureC: simulation.state.temperatureC });
            console.warn(`[Event] criticalOverheat @ ${simulation.state.temperatureC.toFixed(1)}C`);
        }
        if (events.lowEnergyWarning && !lastEvents.lowEnergyWarning) {
            powerUnit.emitEvent("lowEnergyWarning", { estimatedRangeKm: simulation.state.estimatedRangeKm });
            console.warn(`[Event] lowEnergyWarning @ ${simulation.state.estimatedRangeKm.toFixed(1)} km`);
        }
        if (events.anomalyDetected && !lastEvents.anomalyDetected) {
            powerUnit.emitEvent("anomalyDetected", {
                systemEfficiency: simulation.state.systemEfficiency,
                torqueNm: simulation.state.torqueNm
            });
            console.warn(`[Event] anomalyDetected @ ${simulation.state.systemEfficiency.toFixed(2)} km/kWh`);
        }
        lastEvents = events;
        if (tickCount % 10 === 0) {
            console.log(`[Telemetry] SoC ${simulation.state.batterySoC.toFixed(1)}% | ` +
                `Eff ${simulation.state.systemEfficiency.toFixed(2)} km/kWh | ` +
                `Temp ${simulation.state.temperatureC.toFixed(1)}C | ` +
                `Mode ${simulation.state.driveMode}`);
        }
    }, intervalMs);
})
    .catch((error) => {
    console.error("Failed to start WoT servient", error);
    process.exit(1);
});
