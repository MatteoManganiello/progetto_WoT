# WoT-ProActiveDrive

Digital Twin di un propulsore ibrido (motore termico + motore elettrico + batteria)
basato su W3C Web of Things.

## Architettura: parte fisica e parte digitale separate

Il progetto e' diviso in due processi che non condividono memoria e comunicano
solo attraverso un broker MQTT. E' questa separazione a rendere il sistema un
Digital Twin e non un simulatore con sopra un'interfaccia web.

```
┌──────────── PARTE FISICA ──────────────┐
│  npm run sim                           │   Non conosce la libreria WoT.
│  src/physical/simulator.ts             │   Un dispositivo reale al suo posto
│  banco prova dei tre dispositivi       │   parlerebbe lo stesso protocollo.
└────────────────────────────────────────┘
        │  pad/physical/<device>/telemetry   (misure)
        │  pad/physical/<device>/command     (comandi)
        ▼  contratto: src/physical/protocol.ts
┌──────────── PARTE DIGITALE ────────────┐
│  npm run dev                           │
│  src/twin/shadow.ts    ombra per       │   Per ogni dispositivo: misura reale
│                        dispositivo     │   se fresca, altrimenti modello.
│  src/twin/registry.ts  fusione e       │   Indicatori derivati calcolati qui.
│                        indicatori      │
│  src/thing.ts, energy-storage.ts,      │   Tre Thing WoT che leggono dal
│  control-actuator.ts                   │   gemello, mai dalla fisica.
│  servient: HttpServer + MqttBrokerServer
└────────────────────────────────────────┘
        │  binding WoT (HTTP + MQTT), form generate dalla TD
        ▼
   src/consumers/*   (WoT.consume + subscribeEvent)
   dashboard/        (consumer TD-driven nel browser)
```

### Il sistema funziona con zero, una o tutte le parti fisiche

Ogni dispositivo ha la propria ombra digitale con un TTL (`TWIN_STALE_MS`,
default 5000 ms). Finche' arrivano misure il gemello serve quelle e le dichiara
come `physical`; quando smettono di arrivare degrada sul modello e lo dichiara
come `model`, continuando dall'ultimo valore reale noto. La transizione e'
pubblicata come evento WoT `physicalLinkChanged`.

La proprieta' `twinStatus`, esposta da tutte e tre le Thing, rende la cosa
verificabile da qualsiasi client:

```bash
curl http://localhost:8080/energystorage/properties/twinStatus
# {"deviceId":"battery","source":"physical","live":true,"samples":7,"ageMs":437}
```

## Avvio rapido

```bash
npm install

# Terminale 1 — parte digitale (broker MQTT integrato, nessuna installazione)
MQTT_SELF_HOST=true npm run dev

# Terminale 2 — parte fisica
npm run sim
```

Senza `MQTT_SELF_HOST` serve un broker esterno su `mqtt://localhost:1883`
(configurabile con `MQTT_BROKER_URL`).

- Thing Description: `http://localhost:8080/powerunit`, `/energystorage`, `/controlactuator`
- Dashboard: `http://localhost:8091`
- Stato del gemello: `http://localhost:8091/api/twin-status`
- Storico: `http://localhost:8091/api/history` (persistito in `data/history.json`)

### Dimostrare la separazione fisico/digitale

```bash
# Solo la batteria e' "reale": le altre due parti restano coperte dal modello
SIM_DEVICES=battery npm run sim

# Staccare la parte fisica a caldo: la telemetria non si interrompe,
# twinStatus passa da "physical" a "model" ed esce l'evento physicalLinkChanged
# (Ctrl+C sul terminale del simulatore)

# Nessuna parte fisica e nessun broker: il gemello lavora sul solo modello
MQTT_ENABLED=false npm run dev
```

## Uso della libreria WoT e dei binding templates

Tutta la comunicazione WoT passa da node-wot. Non esistono topic MQTT scritti a
mano ne' URL cablati nei client.

**Lato server** — il servient monta due binding:

```ts
servient.addServer(new HttpServer({ port: 8080, ... }));
servient.addServer(new MqttBrokerServer({ uri: mqttBrokerUrl, selfHost }));
```

Le form vengono generate dalla TD. Con MQTT attivo, `GET /powerunit` include:

```json
{ "href": "mqtt://localhost:1883/PowerUnit/events/criticalOverheat",
  "contentType": "application/json", "mqv:qos": "2",
  "op": ["subscribeevent", "unsubscribeevent"] }
```

e node-wot pubblica di conseguenza:

```
PowerUnit/properties/batterySoC          64.88
EnergyStorage/properties/batterySoH      95.97
ControlActuator/properties/driveMode     "Hybrid"
```

**Lato client** — i consumer registrano le client factory e poi consumano la TD:

```ts
servient.addClientFactory(new HttpClientFactory());
servient.addClientFactory(new MqttClientFactory());
const td = await wot.requestThingDescription(url);
const thing = await wot.consume(td);
await thing.subscribeEvent("criticalOverheat", handler);
await thing.invokeAction("setDriveMode", "Sport");
```

Il protocollo lo sceglie la libreria leggendo le form. Se il broker non c'e', le
TD espongono solo form HTTP e i consumer si adattano senza modifiche al codice.

## Componenti

### Things (parte digitale)

| Thing | Ruolo | Dispositivo fisico |
|---|---|---|
| `PowerUnit` | propulsore ibrido, eventi diagnostici | `powerunit` |
| `EnergyStorage` | pacco batteria | `battery` |
| `ControlActuator` | unico punto di attuazione | `actuator` |

**Proprieta'** — misurate: `engineRPM`, `torqueNm`, `temperatureC`, `speedKmh`,
`engineStatus`, `batterySoC`, `batterySoH`, `voltageV`, `currentA`.
Calcolate dal gemello: `systemEfficiency`, `thermalHealth`, `estimatedRangeKm`.
Di supervisione: `controlMode`, `regenMode`, `commandTarget`, `twinStatus`.

**Azioni** (solo su `ControlActuator`): `setDriveMode(mode)`,
`triggerRegen(1-3)`, `setControlMode(Manual|Auto)`.

**Eventi** (su `PowerUnit`): `criticalOverheat`, `lowEnergyWarning`,
`anomalyDetected`, `physicalLinkChanged`.

### Consumer WoT

- **Energy Orchestrator** (`src/consumers/energy-orchestrator.ts`) — attivo solo
  con `controlMode = Auto`. Legge SoC e velocita' dalle Thing consumate e chiama
  `invokeAction("setDriveMode", ...)`. Le regole sono in `computeDriveMode`,
  funzione pura coperta da test.
- **Diagnostic Tool** (`src/consumers/diagnostic-tool.ts`) — sottoscrive i
  quattro eventi e distingue una diagnosi su misure reali da una su dati
  simulati, perche' legge anche `twinStatus`.
- **Dashboard** (`dashboard/app.js`) — consumer nel browser: scarica le tre TD,
  ricava le form di proprieta', azioni ed eventi, e usa il sottoprotocollo
  `longpoll` dichiarato dalla TD per gli eventi.

### Instradamento dei comandi

Un'azione WoT non tocca mai la fisica direttamente. Il registro decide:

- attuatore fisico collegato → il comando esce su `pad/physical/actuator/command`
  e il dispositivo resta l'autorita' sullo stato riportato;
- attuatore assente → il comando e' applicato al modello.

L'esito e' nel valore di ritorno dell'azione:

```bash
curl -X POST http://localhost:8080/controlactuator/actions/setDriveMode \
  -H "Content-Type: application/json" -d '"Sport"'
# {"activeMode":"Sport","target":"physical"}   oppure   "target":"model"
```

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `HTTP_PORT` | `8080` | porta delle Thing |
| `DASHBOARD_PORT` | `8091` | porta della dashboard |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | broker |
| `MQTT_ENABLED` | `true` | disattiva del tutto MQTT |
| `MQTT_SELF_HOST` | `false` | broker integrato in node-wot |
| `TWIN_STALE_MS` | `5000` | scadenza di una misura fisica |
| `CONSUMERS_ENABLED` | `true` | avvio dei consumer |
| `SIM_DEVICES` | tutti | dispositivi simulati (`battery`, `powerunit`, `actuator`) |
| `SIM_INTERVAL_MS` | `1000` | periodo di pubblicazione |
| `STRESS_MODE` | `false` | accelera il raggiungimento delle soglie critiche |

## Test

```bash
npm test
```

34 test su modello fisico, protocollo, ombre digitali (TTL, degrado, pacchetti
fuori ordine, riavvio dispositivo), registro del gemello (0/1/N parti reali,
instradamento comandi, indicatori derivati) e regole dell'orchestratore.

## Tecnologie

Node.js, TypeScript, `@node-wot/core`, `@node-wot/binding-http`,
`@node-wot/binding-mqtt`, MQTT, Chart.js.
