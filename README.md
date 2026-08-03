# WoT-ProActiveDrive

Digital Twin di un propulsore ibrido (motore a combustione interna + motore
elettrico + pacco batteria) realizzato secondo lo standard W3C Web of Things.

Il sistema simula in tempo reale la dinamica del powertrain, ne espone lo stato
attraverso Thing Description interoperabili e ne consente il controllo remoto
tramite una dashboard web.

## Avvio

```bash
npm install
npm run dev
```

- Thing WoT (HTTP): `http://localhost:8080/powerunit` · `/energystorage` · `/controlactuator`
- Dashboard web (telemetria live, grafici, controllo guida/rigenerazione): `http://localhost:8091`

Esempi di interazione:

```bash
# Lettura di una proprieta'
curl http://localhost:8080/powerunit/properties/batterySoC

# Invocazione di un'azione
curl -X POST http://localhost:8080/controlactuator/actions/setDriveMode \
     -H "Content-Type: application/json" -d '"Sport"'
```

Esecuzione dei test: `npm test`

## Architettura

Il sistema e' composto da tre Thing WoT, ciascuna con la propria Thing
Description auto-descrittiva in JSON-LD (`@context` W3C WoT 1.1, schema di
sicurezza `nosec` adeguato al contesto dimostrativo).

| Thing | Ruolo | Espone |
|---|---|---|
| `PowerUnit` | motore ibrido (ICE + elettrico) | SoC, RPM, coppia, temperatura, efficienza, autonomia + azioni + eventi |
| `EnergyStorage` | pacco batteria | SoC, SoH, tensione, corrente, temperatura |
| `ControlActuator` | attuatore di controllo | modalita' di guida, frenata rigenerativa + azioni di comando |

Sono usati tutti e tre i tipi di interaction affordance previsti dallo standard:

| Affordance | Semantica | Uso nel progetto |
|---|---|---|
| Properties | stato osservabile e leggibile | SoC, SoH, RPM, coppia, temperatura, efficienza, autonomia, modalita' |
| Actions | invocazione di funzioni che modificano lo stato | `setDriveMode`, `triggerRegen` |
| Events | notifiche asincrone su condizioni | `criticalOverheat`, `lowEnergyWarning`, `anomalyDetected` |

### Consumer WoT

- **Diagnostic Tool** (`src/consumers/diagnostic-tool.ts`) — legge periodicamente
  le proprieta' via HTTP e segnala i rischi (surriscaldamento, degrado del SoH,
  autonomia bassa) applicando soglie diagnostiche.
- **Predictive Dashboard** (`dashboard/`) — interfaccia web che interroga via
  HTTP le proprieta' di `PowerUnit` e `ControlActuator`, ne mostra l'andamento
  storico e invia i comandi di controllo.
- **Energy Orchestrator** (`src/consumers/energy-orchestrator.ts`) — consumer di
  riferimento per la gestione automatica della coppia. Incluso a scopo
  architetturale, disattivato in favore del controllo manuale da dashboard.

### Comunicazione

- **HTTP** (sincrono, request/response) — espone le Thing Description, la lettura
  delle proprieta' e l'invocazione delle azioni.
- **MQTT** (asincrono, publish/subscribe) — pubblica la telemetria in streaming
  sul topic `wot/proactivedrive/telemetry`. Il broker e' opzionale: se non
  raggiungibile, il sistema effettua un fallback automatico in modalita'
  HTTP-only, garantendo la continuita' del servizio.

## Modello di simulazione

Il gemello digitale e' guidato da un modello a tempo discreto (passo di 2 s) che,
a ogni ciclo, aggiorna in modo accoppiato:

- **Cinematica** — velocita' con andamento sinusoidale modulato dalla modalita'
  di guida (offset per Sport / Full Electric).
- **Coppia e regime motore** — funzione della domanda di velocita' e della
  modalita'; determinano lo stato del motore termico (Off / Idle / Running).
- **Bilancio energetico della batteria** — consumo dipendente da modalita',
  domanda e stato di carica, con recupero da frenata rigenerativa in
  decelerazione.
- **Modello termico** — riscaldamento per carico, velocita' e modalita' Sport;
  raffreddamento per flusso d'aria e rigenerazione. Da esso derivano
  `thermalHealth` e l'usura (SoH) della batteria.
- **Efficienza di sistema** — efficienza istantanea (km/kWh) filtrata con una
  media mobile esponenziale (EMA), per riflettere il consumo reale evitando
  transitori all'avvio.

Le modalita' di guida (Full Electric, Hybrid, Sport, Save) e l'intensita' di
rigenerazione (1–3) sono le variabili di controllo esposte tramite azioni.

## Validazione

`npm test` esegue 33 verifiche: test automatici sul modello e sulle regole dei
consumer, simulazioni parametriche per modalita' di guida (120 cicli, circa
4 minuti di simulazione) e verifica end-to-end dell'interfaccia WoT via HTTP
(lettura proprieta', invocazione azioni, generazione della TD).

| Modalita' | Efficienza (km/kWh) | Comportamento osservato |
|---|---|---|
| Save | 6,2 – 10,0 | massima efficienza, sistema stabile |
| Hybrid | 4,4 – 5,8 | funzionamento nominale bilanciato |
| Full Electric | 2,8 – 5,4 | scarica batteria piu' rapida |
| Sport | 2,9 – 5,1 | surriscaldamento e `criticalOverheat` attivato |

In `STRESS_MODE` la temperatura raggiunge la soglia massima (120 °C) attivando
ripetutamente l'evento di surriscaldamento, mentre la scarica progressiva della
batteria genera l'evento di bassa autonomia. In condizioni nominali non si
osservano falsi positivi sugli eventi di anomalia.

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `HTTP_PORT` | `8080` | porta delle Thing |
| `DASHBOARD_PORT` | `8091` | porta della dashboard |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | broker per lo streaming di telemetria |
| `MQTT_ENABLED` | `true` | `false` per la sola modalita' HTTP |
| `STRESS_MODE` | `false` | forza rapidamente le soglie critiche |

## Tecnologie

Node.js · TypeScript · node-wot (implementazione di riferimento W3C WoT) ·
HTTP · MQTT (formato JSON) · HTML5 · CSS3 · JavaScript · Chart.js
