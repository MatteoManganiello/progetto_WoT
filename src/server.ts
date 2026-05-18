import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import { MqttBrokerServer } from "@node-wot/binding-mqtt";
import http from "http";
import fs from "fs";
import net from "net";
import path from "path";
import { createPowerUnitThing } from "./thing";
import { createEnergyStorageThing } from "./energy-storage";
import { createControlActuatorThing } from "./control-actuator";
import { createSimulation, SimulationEvents } from "./sim-state";
import { startTelemetryPublisher } from "./telemetry-publisher";
import { startDiagnosticTool } from "./consumers/diagnostic-tool";

const httpPort = Number(process.env.HTTP_PORT ?? "8080");
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? "8091");
const mqttBrokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const mqttEnabled = (process.env.MQTT_ENABLED ?? "true").toLowerCase() === "true";
let mqttServerActive = false;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

const historyFile = path.join(__dirname, "..", "data", "history.json");
const history: Array<{ timestamp: string; batterySoC: number; systemEfficiency: number; temperatureC: number }> = [];

const ensureHistoryDir = () => {
  const dir = path.dirname(historyFile);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore directory creation errors
  }
};

const loadHistory = () => {
  try {
    const content = fs.readFileSync(historyFile, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      history.push(...parsed.slice(-300));
    }
  } catch {
    // ignore missing or invalid history
  }
};

const saveHistory = () => {
  try {
    ensureHistoryDir();
    fs.writeFileSync(historyFile, JSON.stringify(history.slice(-300), null, 2));
  } catch (error) {
    console.warn("Failed to save history", error);
  }
};

const dashboardDir = path.join(__dirname, "..", "dashboard");

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css"
};

const startDashboardServer = () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/history") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(history));
      return;
    }
    const urlPath = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
    const safePath = path.normalize(urlPath).replace(/^([/\\])+/, "");
    const filePath = path.join(dashboardDir, safePath);

    if (!filePath.startsWith(dashboardDir)) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath);
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

const servient = new Servient();
// HTTP exposes the TD and interactions; MQTT publishes updates via broker.
servient.addServer(new HttpServer({
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

const isMqttBrokerReachable = async (brokerUrl: string) => {
  try {
    const url = new URL(brokerUrl);
    return await new Promise((resolve) => {
      const socket = net.connect({ host: url.hostname, port: Number(url.port) || 1883 }, () => {
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
  } catch {
    return false;
  }
};

const startServient = async () => {
  if (mqttEnabled) {
    const reachable = await isMqttBrokerReachable(mqttBrokerUrl);
    if (reachable) {
      mqttServerActive = true;
      servient.addServer(new MqttBrokerServer({ uri: mqttBrokerUrl }));
    } else {
      mqttServerActive = false;
      console.warn(`MQTT broker not reachable at ${mqttBrokerUrl}. Starting in HTTP-only mode.`);
    }
  }

  try {
    return await servient.start();
  } catch (error) {
    console.error("Failed to start WoT servient", error);
    process.exit(1);
  }
};

startServient()
  .then(async (wot) => {
    const simulation = createSimulation();
    loadHistory();
    const powerUnit = await createPowerUnitThing(wot, simulation);
    const energyStorage = await createEnergyStorageThing(wot, simulation);
    const controlActuator = await createControlActuatorThing(wot, simulation);

    await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);

    console.log(`PowerUnit TD exposed over HTTP on http://localhost:${httpPort}/powerunit`);
    console.log(`EnergyStorage TD exposed over HTTP on http://localhost:${httpPort}/energystorage`);
    console.log(`ControlActuator TD exposed over HTTP on http://localhost:${httpPort}/controlactuator`);
    if (mqttServerActive) {
      console.log(`MQTT broker URL configured for events: ${mqttBrokerUrl}`);
    } else if (mqttEnabled) {
      console.log(`MQTT enabled, but broker is unavailable. Running without MQTT events.`);
    } else {
      console.log("MQTT disabled (set MQTT_ENABLED=true to enable).");
    }

    startDashboardServer();

    if (mqttServerActive) {
      startTelemetryPublisher(simulation, mqttBrokerUrl);
    }

    startDiagnosticTool({ baseUrl: `http://localhost:${httpPort}` });

    const intervalMs = 2000;
    let tickCount = 0;
    let lastEvents: SimulationEvents = {
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
        console.log(
          `[Telemetry] SoC ${simulation.state.batterySoC.toFixed(1)}% | ` +
          `Eff ${simulation.state.systemEfficiency.toFixed(2)} km/kWh | ` +
          `Temp ${simulation.state.temperatureC.toFixed(1)}C | ` +
          `Mode ${simulation.state.driveMode}`
        );
      }
    }, intervalMs);
  })
  .catch((error) => {
    console.error("Failed to start WoT servient", error);
    process.exit(1);
  });
