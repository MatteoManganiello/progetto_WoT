import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import { MqttBrokerServer } from "@node-wot/binding-mqtt";
import type { MqttBrokerServerConfig } from "@node-wot/binding-mqtt";
import mqtt, { MqttClient } from "mqtt";
import http from "http";
import fs from "fs";
import net from "net";
import path from "path";
import { EVENT_THRESHOLDS, STEP_SECONDS, createSimulation } from "./sim-state";
import { TwinSources, createTwinSources, describeOrigins, parseRealComponents } from "./sources";
import { POWER_UNIT_TD, createPowerUnitThing } from "./thing";
import { ENERGY_STORAGE_TD, createEnergyStorageThing } from "./energy-storage";
import { CONTROL_ACTUATOR_TD, createControlActuatorThing } from "./control-actuator";
import { startDiagnosticTool } from "./consumers/diagnostic-tool";

/**
 * RUNTIME DEL GEMELLO DIGITALE.
 *
 * Un solo processo che:
 *  1. compone le sorgenti del gemello, componente per componente, scegliendo fra
 *     modello simulato e dispositivo fisico (`src/sources/`);
 *  2. espone tre Thing WoT auto-descrittive con node-wot su due binding, HTTP e
 *     MQTT, con fallback controllato quando il broker non e' disponibile;
 *  3. fa avanzare il modello di simulazione del powertrain (`src/sim-state.ts`);
 *  4. serve la dashboard web e avvia il Diagnostic Tool.
 *
 * Le due direzioni del gemello passano da qui: il livello WoT verso i consumer,
 * il canale dei dispositivi verso la parte reale.
 */

const httpPort = Number(process.env.HTTP_PORT ?? "8080");
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? "8091");
const mqttBrokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const mqttEnabled = (process.env.MQTT_ENABLED ?? "true").toLowerCase() === "true";
/** Se nessun broker risponde, il runtime ne ospita uno embedded (aedes). */
const mqttSelfHost = (process.env.MQTT_SELF_HOST ?? "true").toLowerCase() === "true";
/** Componenti presenti nel sistema come parte reale, es. `energyStorage`. */
const realComponents = parseRealComponents(process.env.REAL_COMPONENTS);
/** Oltre questo silenzio, la parte reale e' considerata assente. */
const deviceStalenessMs = Number(process.env.DEVICE_STALENESS_MS ?? "6000");

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

const simulation = createSimulation();

// ---------------------------------------------------------------------------
// Storico su file locale
// ---------------------------------------------------------------------------

const historyFile = path.join(__dirname, "..", "data", "history.json");
type HistorySample = {
  timestamp: string;
  batterySoC: number;
  systemEfficiency: number;
  temperatureC: number;
};
const history: HistorySample[] = [];

const loadHistory = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile, "utf-8"));
    if (Array.isArray(parsed)) {
      history.push(...parsed.slice(-300));
    }
  } catch {
    // storico assente o illeggibile: si riparte da vuoto
  }
};

const saveHistory = () => {
  try {
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(history.slice(-300), null, 2));
  } catch (error) {
    console.warn("Salvataggio dello storico fallito", error);
  }
};

// ---------------------------------------------------------------------------
// Streaming MQTT della telemetria (opzionale)
// ---------------------------------------------------------------------------

let telemetryClient: MqttClient | undefined;

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

/**
 * PIANIFICAZIONE DEL BINDING MQTT.
 *
 * `MqttBrokerServer.start()` fallisce se il broker non risponde, e con esso
 * fallirebbe l'intero servient. Si decide quindi *prima* di costruirlo:
 *
 *  1. broker esterno raggiungibile  -> ci si collega;
 *  2. nessun broker in ascolto      -> se ne ospita uno embedded (aedes);
 *  3. MQTT disabilitato o non avviabile -> si resta in HTTP-only.
 *
 * Il gemello continua a funzionare in tutti e tre i casi: e' la continuita' del
 * servizio a essere la sua ragione d'essere, non un protocollo in particolare.
 */
type MqttPlan = { config: MqttBrokerServerConfig; mode: "esterno" | "embedded" };

const planMqttBinding = async (): Promise<MqttPlan | undefined> => {
  if (!mqttEnabled) {
    console.log("Binding MQTT disabilitato (MQTT_ENABLED=false): modalita' HTTP-only.");
    return undefined;
  }
  if (await isMqttBrokerReachable(mqttBrokerUrl)) {
    return { config: { uri: mqttBrokerUrl }, mode: "esterno" };
  }
  if (!mqttSelfHost) {
    console.warn(`Broker MQTT non raggiungibile su ${mqttBrokerUrl}: fallback in modalita' HTTP-only.`);
    return undefined;
  }
  console.log(`Nessun broker su ${mqttBrokerUrl}: il runtime ne ospita uno embedded.`);
  return { config: { uri: mqttBrokerUrl, selfHost: true }, mode: "embedded" };
};

/**
 * Streaming aggregato della telemetria su un topic unico.
 *
 * E' un canale di comodo per il monitoraggio, distinto dalle form MQTT che il
 * binding di node-wot genera per ogni singola affordance: quelle sono descritte
 * nelle Thing Description e sono la via interoperabile, questa e' un riassunto
 * dello stato del gemello su un solo topic.
 */
const startTelemetryStream = (brokerUrl: string) => {
  const client = mqtt.connect(brokerUrl, { reconnectPeriod: 2000 });
  client.on("connect", () => {
    console.log(`Telemetria aggregata su ${brokerUrl} → topic '${TELEMETRY_TOPIC}'`);
  });
  client.on("error", (error) => {
    console.warn("[MQTT] errore di connessione:", error.message);
  });
  telemetryClient = client;
};

/**
 * Stato del gemello composto dalle tre sorgenti. Ogni grandezza viene presa dal
 * componente che ne e' titolare — il SoC dal pacco batteria, la temperatura dal
 * gruppo propulsore — cosi' la composizione resta corretta anche quando solo
 * una parte del sistema e' reale.
 */
const composeTelemetry = (sources: TwinSources) => {
  const power = sources.powerUnit.snapshot();
  const storage = sources.energyStorage.snapshot();
  const control = sources.controlActuator.snapshot();

  return {
    timestamp: new Date().toISOString(),
    ...power,
    ...storage,
    ...control,
    // `storage` sovrascrive `power` sui campi in comune: sul pacco batteria e'
    // il pacco a essere titolare del SoC. La temperatura no: quella rilevante
    // per gli eventi e' quella del gruppo propulsore, e va ripristinata.
    temperatureC: power.temperatureC,
    // Provenienza del dato: un consumer sa cosa e' misurato e cosa e' stimato.
    origins: {
      powerUnit: sources.powerUnit.origin(),
      energyStorage: sources.energyStorage.origin(),
      controlActuator: sources.controlActuator.origin()
    }
  };
};

const publishTelemetry = (sample: ReturnType<typeof composeTelemetry>) => {
  if (!telemetryClient?.connected) {
    return;
  }
  telemetryClient.publish(TELEMETRY_TOPIC, JSON.stringify(sample));
};

// ---------------------------------------------------------------------------
// Dashboard statica + API dello storico
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
      res.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath)] ?? "text/plain",
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

/**
 * Un servient, due binding. Le affordance sono dichiarate una volta sola nelle
 * Thing Description: e' node-wot a generare, per ciascuna, una `form` per ogni
 * protocollo attivo. Un consumer legge la TD e sceglie la form che sa parlare,
 * senza che il suo codice cambi. E' la potenzialita' dei binding templates.
 */
const buildServient = (mqttConfig?: MqttBrokerServerConfig) => {
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

  if (mqttConfig) {
    servient.addServer(new MqttBrokerServer(mqttConfig));
  }
  return servient;
};

/** Avvia il servient col binding MQTT se possibile, altrimenti in HTTP-only. */
const startServient = async () => {
  const plan = await planMqttBinding();

  if (plan) {
    try {
      const wot = await buildServient(plan.config).start();
      console.log(`Binding MQTT attivo (broker ${plan.mode}) su ${mqttBrokerUrl}`);
      return { wot, mqttActive: true };
    } catch (error) {
      // Il tentativo comprende anche il binding HTTP: si evita di attribuire a
      // MQTT una causa che potrebbe essere altrove (per esempio, porta occupata).
      // Se il secondo tentativo fallisce a sua volta, l'errore vero risale.
      const cause = error instanceof Error ? error.message : String(error);
      console.warn(`Avvio con binding MQTT fallito (${cause}); nuovo tentativo in sola modalita' HTTP.`);
    }
  }

  return { wot: await buildServient().start(), mqttActive: false };
};

const main = async () => {
  loadHistory();

  const { wot, mqttActive } = await startServient();

  // Le sorgenti si compongono dopo l'avvio del servient: con broker embedded, e'
  // solo a questo punto che i dispositivi fisici hanno un broker a cui parlare.
  const twin = createTwinSources({
    simulation,
    brokerUrl: mqttActive ? mqttBrokerUrl : undefined,
    realComponents,
    stalenessMs: deviceStalenessMs
  });
  const sources = twin.sources;

  if (mqttActive) {
    startTelemetryStream(mqttBrokerUrl);
  }

  const powerUnit = await createPowerUnitThing(wot, sources);
  const energyStorage = await createEnergyStorageThing(wot, sources);
  const controlActuator = await createControlActuatorThing(wot, sources);

  await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);

  /*
   * Le proprieta' da notificare a ogni ciclo si ricavano dalle Thing Description
   * stesse: e' la TD la sola fonte di verita' su cosa la Thing espone, e una
   * seconda lista scritta a mano finirebbe per divergere.
   */
  const propertyFeeds = [
    { thing: powerUnit, properties: Object.keys(POWER_UNIT_TD.properties ?? {}) },
    { thing: energyStorage, properties: Object.keys(ENERGY_STORAGE_TD.properties ?? {}) },
    { thing: controlActuator, properties: Object.keys(CONTROL_ACTUATOR_TD.properties ?? {}) }
  ];

  console.log(`PowerUnit TD:        http://localhost:${httpPort}/powerunit`);
  console.log(`EnergyStorage TD:    http://localhost:${httpPort}/energystorage`);
  console.log(`ControlActuator TD:  http://localhost:${httpPort}/controlactuator`);

  startDashboardServer();

  const base = `http://localhost:${httpPort}`;
  startDiagnosticTool({
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

    // Il modello avanza sempre: e' il fallback delle parti non reali, e deve
    // restare allineato per subentrare quando un dispositivo si scollega.
    const modelEvents = simulation.update();
    const state = composeTelemetry(sources);

    /*
     * Le soglie si valutano sullo stato *effettivo* del gemello, non su quello
     * simulato: se il pacco batteria e' reale, e' la sua temperatura misurata a
     * dover far scattare l'allarme. L'anomalia resta al modello, perche' si
     * basa su una persistenza calcolata al suo interno.
     */
    const events = {
      criticalOverheat: state.temperatureC > EVENT_THRESHOLDS.overheatC,
      lowEnergyWarning: state.estimatedRangeKm < EVENT_THRESHOLDS.lowRangeKm,
      anomalyDetected: modelEvents.anomalyDetected
    };

    publishTelemetry(state);

    history.push({
      timestamp: state.timestamp,
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

    for (const feed of propertyFeeds) {
      for (const property of feed.properties) {
        feed.thing.emitPropertyChange(property);
      }
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
      console.log(
        `[Twin] SoC ${state.batterySoC.toFixed(1)}% | ` +
        `Eff ${state.systemEfficiency.toFixed(2)} km/kWh | ` +
        `Temp ${state.temperatureC.toFixed(1)}C | ` +
        `Mode ${state.driveMode} | ` +
        `Origine ${describeOrigins(sources)}`
      );
    }
  }, STEP_SECONDS * 1000);

  process.on("SIGINT", () => {
    console.log("\n[Twin] arresto richiesto, chiusura del canale dei dispositivi.");
    twin.close().finally(() => process.exit(0));
  });
};

main().catch((error) => {
  console.error("Avvio del gemello digitale fallito", error);
  process.exit(1);
});
