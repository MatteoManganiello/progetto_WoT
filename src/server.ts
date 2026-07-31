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
import { createTwinRegistry } from "./twin/registry";
import { createDeviceBus } from "./physical/device-bus";
import { startDiagnosticTool } from "./consumers/diagnostic-tool";
import { startEnergyOrchestrator } from "./consumers/energy-orchestrator";

/**
 * RUNTIME DELLA PARTE DIGITALE.
 *
 * Qui non c'e' fisica. Questo processo:
 *  1. ascolta i dispositivi fisici sul bus MQTT (`src/physical/protocol.ts`);
 *  2. tiene aggiornato il gemello (`src/twin/registry.ts`), che degrada sul
 *     modello per ogni dispositivo assente;
 *  3. espone tre Thing WoT via HTTP e MQTT usando i binding di node-wot;
 *  4. avvia i consumer, che parlano solo tramite Thing Description.
 *
 * Spegnere il simulatore (o staccare una centralina vera) non ferma nulla:
 * cambia solo la sorgente dei dati, dichiarata in `twinStatus`.
 */

const httpPort = Number(process.env.HTTP_PORT ?? "8080");
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? "8091");
const mqttBrokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const mqttEnabled = (process.env.MQTT_ENABLED ?? "true").toLowerCase() === "true";
const mqttSelfHost = (process.env.MQTT_SELF_HOST ?? "false").toLowerCase() === "true";
const staleAfterMs = Number(process.env.TWIN_STALE_MS ?? "5000");
const consumersEnabled = (process.env.CONSUMERS_ENABLED ?? "true").toLowerCase() === "true";

let mqttServerActive = false;

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

const historyFile = path.join(__dirname, "..", "data", "history.json");
type HistorySample = {
  timestamp: string;
  batterySoC: number;
  systemEfficiency: number;
  temperatureC: number;
  /** Registra se il campione veniva da hardware o dal modello. */
  source: "physical" | "model";
};
const history: HistorySample[] = [];

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

// ---------------------------------------------------------------------------
// Parte fisica: bus dei dispositivi
// ---------------------------------------------------------------------------

const deviceBus = mqttEnabled
  ? createDeviceBus({
      brokerUrl: mqttBrokerUrl,
      clientLabel: "digital-twin",
      subscribeTelemetry: true
    })
  : undefined;

const twin = createTwinRegistry({
  staleAfterMs,
  sendCommand: deviceBus ? (deviceId, command) => deviceBus.publishCommand(deviceId, command) : undefined
});

deviceBus?.onTelemetry((telemetry) => {
  twin.ingestTelemetry(telemetry);
});

// ---------------------------------------------------------------------------
// Dashboard statica + API di supporto
// ---------------------------------------------------------------------------

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
    if (req.url === "/api/twin-status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(twin.status()));
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
    console.log(`Dashboard disponibile su http://localhost:${dashboardPort}`);
  });
};

// ---------------------------------------------------------------------------
// Servient WoT: binding HTTP + binding MQTT
// ---------------------------------------------------------------------------

const servient = new Servient();
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
    return await new Promise<boolean>((resolve) => {
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
    // Con MQTT_SELF_HOST=true e' node-wot stesso ad avviare il broker: il progetto
    // resta dimostrabile anche senza Mosquitto installato.
    const reachable = mqttSelfHost || (await isMqttBrokerReachable(mqttBrokerUrl));
    if (reachable) {
      mqttServerActive = true;
      // Il binding MQTT di node-wot pubblica proprieta' ed eventi sui topic
      // derivati dalla TD e iscrive le azioni. Nessun topic scritto a mano.
      servient.addServer(new MqttBrokerServer({ uri: mqttBrokerUrl, selfHost: mqttSelfHost }));
    } else {
      console.warn(`Broker MQTT non raggiungibile su ${mqttBrokerUrl}: avvio in sola modalita' HTTP.`);
      console.warn("Suggerimento: avvia con MQTT_SELF_HOST=true per usare il broker integrato in node-wot.");
    }
  }

  return servient.start();
};

startServient()
  .then(async (wot) => {
    loadHistory();

    const powerUnit = await createPowerUnitThing(wot, twin);
    const energyStorage = await createEnergyStorageThing(wot, twin);
    const controlActuator = await createControlActuatorThing(wot, twin);

    await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);

    console.log(`PowerUnit TD:        http://localhost:${httpPort}/powerunit`);
    console.log(`EnergyStorage TD:    http://localhost:${httpPort}/energystorage`);
    console.log(`ControlActuator TD:  http://localhost:${httpPort}/controlactuator`);

    if (mqttServerActive) {
      console.log(`Binding MQTT attivo su ${mqttBrokerUrl}: le TD includono le form 'mqtt://'.`);
      console.log(`  es. telemetria WoT -> powerunit/properties/batterySoC`);
      console.log(`  es. eventi WoT     -> powerunit/events/criticalOverheat`);
    } else if (mqttEnabled) {
      console.log("Binding MQTT non attivo (broker assente): le TD espongono solo form HTTP.");
    } else {
      console.log("Binding MQTT disabilitato (MQTT_ENABLED=false).");
    }

    console.log(
      deviceBus
        ? "In ascolto dei dispositivi fisici su pad/physical/+/telemetry"
        : "Bus dispositivi disabilitato: il gemello lavora solo con il modello."
    );

    startDashboardServer();

    // Una parte fisica che entra o esce e' informazione di dominio, non un
    // dettaglio interno: viene tracciata a log e pubblicata come evento WoT.
    twin.onLinkChange((change) => {
      console.log(
        `[Twin] '${change.deviceId}' ${change.live ? "collegato: uso le misure reali" : "assente: passo al modello"}`
      );
    });

    if (consumersEnabled) {
      const base = `http://localhost:${httpPort}`;
      startDiagnosticTool({
        powerUnitTd: `${base}/powerunit`,
        energyStorageTd: `${base}/energystorage`
      }).catch((error) => console.warn("Diagnostic Tool non avviato", error));

      startEnergyOrchestrator({
        powerUnitTd: `${base}/powerunit`,
        controlActuatorTd: `${base}/controlactuator`
      }).catch((error) => console.warn("Energy Orchestrator non avviato", error));
    }

    const intervalMs = 2000;
    let tickCount = 0;
    let lastEvents = {
      criticalOverheat: false,
      lowEnergyWarning: false,
      anomalyDetected: false
    };

    setInterval(() => {
      tickCount += 1;
      const { view, events } = twin.update();
      const status = twin.status();
      const dominantSource = status.physicalDevices > 0 ? "physical" : "model";

      // Un solo evento per ciclo, con tutti i cambi accumulati.
      const linkChanges = twin.drainLinkChanges();
      if (linkChanges.length > 0) {
        powerUnit.emitEvent("physicalLinkChanged", {
          changes: linkChanges,
          physicalDevices: status.physicalDevices,
          totalDevices: status.devices.length
        });
      }

      history.push({
        timestamp: new Date().toISOString(),
        batterySoC: view.batterySoC,
        systemEfficiency: view.systemEfficiency,
        temperatureC: view.temperatureC,
        source: dominantSource
      });
      if (history.length > 300) {
        history.shift();
      }
      if (tickCount % 30 === 0) {
        saveHistory();
      }

      for (const property of [
        "systemEfficiency", "batterySoC", "engineStatus", "thermalHealth",
        "engineRPM", "torqueNm", "temperatureC", "estimatedRangeKm", "speedKmh", "twinStatus"
      ]) {
        powerUnit.emitPropertyChange(property);
      }
      for (const property of [
        "batterySoC", "batterySoH", "voltageV", "currentA", "temperatureC", "estimatedRangeKm", "twinStatus"
      ]) {
        energyStorage.emitPropertyChange(property);
      }
      for (const property of ["driveMode", "controlMode", "regenIntensity", "regenMode", "commandTarget", "twinStatus"]) {
        controlActuator.emitPropertyChange(property);
      }

      if (events.criticalOverheat && !lastEvents.criticalOverheat) {
        powerUnit.emitEvent("criticalOverheat", { temperatureC: view.temperatureC, source: dominantSource });
        console.warn(`[Event] criticalOverheat @ ${view.temperatureC.toFixed(1)}C`);
      }
      if (events.lowEnergyWarning && !lastEvents.lowEnergyWarning) {
        powerUnit.emitEvent("lowEnergyWarning", { estimatedRangeKm: view.estimatedRangeKm, source: dominantSource });
        console.warn(`[Event] lowEnergyWarning @ ${view.estimatedRangeKm.toFixed(1)} km`);
      }
      if (events.anomalyDetected && !lastEvents.anomalyDetected) {
        powerUnit.emitEvent("anomalyDetected", {
          systemEfficiency: view.systemEfficiency,
          torqueNm: view.torqueNm,
          source: dominantSource
        });
        console.warn(`[Event] anomalyDetected @ ${view.systemEfficiency.toFixed(2)} km/kWh`);
      }
      lastEvents = events;

      if (tickCount % 10 === 0) {
        console.log(
          `[Twin] SoC ${view.batterySoC.toFixed(1)}% | ` +
          `Eff ${view.systemEfficiency.toFixed(2)} km/kWh | ` +
          `Temp ${view.temperatureC.toFixed(1)}C | ` +
          `Mode ${view.driveMode} (${view.controlMode}) | ` +
          `fisici ${status.physicalDevices}/${status.devices.length}`
        );
      }
    }, intervalMs);
  })
  .catch((error) => {
    console.error("Avvio del servient WoT fallito", error);
    process.exit(1);
  });
