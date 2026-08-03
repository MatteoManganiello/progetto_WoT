"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@node-wot/core");
const binding_http_1 = require("@node-wot/binding-http");
const mqtt_1 = __importDefault(require("mqtt"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const path_1 = __importDefault(require("path"));
const sim_state_1 = require("./sim-state");
const thing_1 = require("./thing");
const energy_storage_1 = require("./energy-storage");
const control_actuator_1 = require("./control-actuator");
const diagnostic_tool_1 = require("./consumers/diagnostic-tool");
/**
 * RUNTIME DEL GEMELLO DIGITALE.
 *
 * Un solo processo che:
 *  1. fa avanzare il modello di simulazione del powertrain (`src/sim-state.ts`);
 *  2. espone tre Thing WoT auto-descrittive via HTTP con node-wot;
 *  3. pubblica la telemetria in streaming su MQTT, con fallback HTTP-only;
 *  4. serve la dashboard web e avvia il Diagnostic Tool.
 *
 * Disaccoppiamento dei protocolli: HTTP per le interazioni sincrone
 * (lettura proprieta' e invocazione azioni), MQTT per lo streaming asincrono.
 */
const httpPort = Number(process.env.HTTP_PORT ?? "8080");
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? "8091");
const mqttBrokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const mqttEnabled = (process.env.MQTT_ENABLED ?? "true").toLowerCase() === "true";
/** Topic unico su cui viaggia la telemetria in streaming. */
const TELEMETRY_TOPIC = "wot/proactivedrive/telemetry";
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});
/**
 * Un gemello digitale che si spegne non serve a niente: e' proprio la continuita'
 * del servizio la sua ragione d'essere. Un client che chiude la connessione a
 * meta' di un long-poll non deve poter fermare la telemetria di tutti gli altri.
 */
process.on("uncaughtException", (error) => {
    console.error("[Twin] eccezione non gestita, il gemello resta attivo:", error);
});
const simulation = (0, sim_state_1.createSimulation)();
// ---------------------------------------------------------------------------
// Storico su file locale
// ---------------------------------------------------------------------------
const historyFile = path_1.default.join(__dirname, "..", "data", "history.json");
const history = [];
const loadHistory = () => {
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(historyFile, "utf-8"));
        if (Array.isArray(parsed)) {
            history.push(...parsed.slice(-300));
        }
    }
    catch {
        // storico assente o illeggibile: si riparte da vuoto
    }
};
const saveHistory = () => {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(historyFile), { recursive: true });
        fs_1.default.writeFileSync(historyFile, JSON.stringify(history.slice(-300), null, 2));
    }
    catch (error) {
        console.warn("Salvataggio dello storico fallito", error);
    }
};
// ---------------------------------------------------------------------------
// Streaming MQTT della telemetria (opzionale)
// ---------------------------------------------------------------------------
let telemetryClient;
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
/**
 * Il broker e' opzionale. Se non risponde il sistema degrada in modo controllato
 * alla sola modalita' HTTP: la dashboard e i consumer continuano a funzionare.
 */
const startTelemetryStream = async () => {
    if (!mqttEnabled) {
        console.log("Streaming MQTT disabilitato (MQTT_ENABLED=false): modalita' HTTP-only.");
        return;
    }
    if (!(await isMqttBrokerReachable(mqttBrokerUrl))) {
        console.warn(`Broker MQTT non raggiungibile su ${mqttBrokerUrl}: fallback in modalita' HTTP-only.`);
        return;
    }
    const client = mqtt_1.default.connect(mqttBrokerUrl, { reconnectPeriod: 2000 });
    client.on("connect", () => {
        console.log(`Telemetria MQTT in streaming su ${mqttBrokerUrl} → topic '${TELEMETRY_TOPIC}'`);
    });
    client.on("error", (error) => {
        console.warn("[MQTT] errore di connessione:", error.message);
    });
    telemetryClient = client;
};
const publishTelemetry = () => {
    if (!telemetryClient?.connected) {
        return;
    }
    const payload = {
        timestamp: new Date().toISOString(),
        batterySoC: simulation.state.batterySoC,
        batterySoH: simulation.state.batterySoH,
        engineRPM: simulation.state.engineRPM,
        torqueNm: simulation.state.torqueNm,
        temperatureC: simulation.state.temperatureC,
        speedKmh: simulation.state.speedKmh,
        engineStatus: simulation.state.engineStatus,
        systemEfficiency: simulation.state.systemEfficiency,
        estimatedRangeKm: simulation.state.estimatedRangeKm,
        thermalHealth: simulation.state.thermalHealth,
        voltageV: simulation.state.voltageV,
        currentA: simulation.state.currentA,
        driveMode: simulation.state.driveMode,
        regenIntensity: simulation.state.regenIntensity
    };
    telemetryClient.publish(TELEMETRY_TOPIC, JSON.stringify(payload));
};
// ---------------------------------------------------------------------------
// Dashboard statica + API dello storico
// ---------------------------------------------------------------------------
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
            res.writeHead(200, {
                "Content-Type": contentTypes[path_1.default.extname(filePath)] ?? "text/plain",
                "Cache-Control": "no-store"
            });
            res.end(data);
        });
    });
    server.listen(dashboardPort, () => {
        console.log(`Dashboard disponibile su http://localhost:${dashboardPort}`);
    });
};
// ---------------------------------------------------------------------------
// Servient WoT: binding HTTP
// ---------------------------------------------------------------------------
const servient = new core_1.Servient();
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
servient.start()
    .then(async (wot) => {
    loadHistory();
    await startTelemetryStream();
    const powerUnit = await (0, thing_1.createPowerUnitThing)(wot, simulation);
    const energyStorage = await (0, energy_storage_1.createEnergyStorageThing)(wot, simulation);
    const controlActuator = await (0, control_actuator_1.createControlActuatorThing)(wot, simulation);
    await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);
    console.log(`PowerUnit TD:        http://localhost:${httpPort}/powerunit`);
    console.log(`EnergyStorage TD:    http://localhost:${httpPort}/energystorage`);
    console.log(`ControlActuator TD:  http://localhost:${httpPort}/controlactuator`);
    startDashboardServer();
    const base = `http://localhost:${httpPort}`;
    (0, diagnostic_tool_1.startDiagnosticTool)({
        powerUnitTd: `${base}/powerunit`,
        energyStorageTd: `${base}/energystorage`
    }).catch((error) => console.warn("Diagnostic Tool non avviato", error));
    let tickCount = 0;
    let lastEvents = {
        criticalOverheat: false,
        lowEnergyWarning: false,
        anomalyDetected: false
    };
    setInterval(() => {
        tickCount += 1;
        const events = simulation.update();
        const state = simulation.state;
        publishTelemetry();
        history.push({
            timestamp: new Date().toISOString(),
            batterySoC: state.batterySoC,
            systemEfficiency: state.systemEfficiency,
            temperatureC: state.temperatureC
        });
        if (history.length > 300) {
            history.shift();
        }
        if (tickCount % 30 === 0) {
            saveHistory();
        }
        for (const property of [
            "batterySoC", "engineRPM", "torqueNm", "temperatureC", "systemEfficiency", "estimatedRangeKm"
        ]) {
            powerUnit.emitPropertyChange(property);
        }
        for (const property of ["batterySoC", "batterySoH", "voltageV", "currentA", "temperatureC"]) {
            energyStorage.emitPropertyChange(property);
        }
        for (const property of ["driveMode", "regenIntensity"]) {
            controlActuator.emitPropertyChange(property);
        }
        // Gli eventi sono notifiche di transizione: si emettono sul fronte di salita.
        if (events.criticalOverheat && !lastEvents.criticalOverheat) {
            powerUnit.emitEvent("criticalOverheat", { temperatureC: state.temperatureC });
            console.warn(`[Event] criticalOverheat @ ${state.temperatureC.toFixed(1)}C`);
        }
        if (events.lowEnergyWarning && !lastEvents.lowEnergyWarning) {
            powerUnit.emitEvent("lowEnergyWarning", { estimatedRangeKm: state.estimatedRangeKm });
            console.warn(`[Event] lowEnergyWarning @ ${state.estimatedRangeKm.toFixed(1)} km`);
        }
        if (events.anomalyDetected && !lastEvents.anomalyDetected) {
            powerUnit.emitEvent("anomalyDetected", {
                systemEfficiency: state.systemEfficiency,
                torqueNm: state.torqueNm
            });
            console.warn(`[Event] anomalyDetected @ ${state.systemEfficiency.toFixed(2)} km/kWh`);
        }
        lastEvents = events;
        if (tickCount % 10 === 0) {
            console.log(`[Twin] SoC ${state.batterySoC.toFixed(1)}% | ` +
                `Eff ${state.systemEfficiency.toFixed(2)} km/kWh | ` +
                `Temp ${state.temperatureC.toFixed(1)}C | ` +
                `Mode ${state.driveMode}`);
        }
    }, sim_state_1.STEP_SECONDS * 1000);
})
    .catch((error) => {
    console.error("Avvio del servient WoT fallito", error);
    process.exit(1);
});
