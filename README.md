# WoT-ProActiveDrive

Digital Twin di un propulsore ibrido (motore a combustione interna + motore
elettrico + pacco batteria) realizzato secondo lo standard W3C Web of Things.

Il sistema simula in tempo reale la dinamica del powertrain, ne espone lo stato
attraverso Thing Description interoperabili su due binding (HTTP e MQTT) e ne
consente il controllo remoto tramite una dashboard web.

La parte digitale e' separata da quella fisica: ogni componente puo' essere
sostituito da un dispositivo reale senza modificare il livello WoT, e il gemello
continua a funzionare qualunque sia la combinazione di parti reali presenti.

## Avvio

```bash
npm install
npm run dev
```

- Thing WoT (HTTP): `http://localhost:8080/powerunit` · `/energystorage` · `/controlactuator`
- Thing WoT (MQTT): topic `PowerUnit/*` · `EnergyStorage/*` · `ControlActuator/*` su `mqtt://localhost:1883`
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

## Separazione fra parte digitale e parte fisica

Il gemello e' costruito in modo che il livello WoT non sappia se un componente
sia simulato o reale. Ogni componente ha una **porta** (`src/sources/types.ts`)
con due implementazioni intercambiabili:

- `SimulatedSource` — proiezione del modello fisico di `sim-state.ts`;
- `DeviceSource` — dispositivo reale, che pubblica le proprie misure via MQTT.

La sostituzione e' **granulare e dichiarata a runtime**: si puo' rendere reale il
solo pacco batteria lasciando simulato tutto il resto.

```bash
REAL_COMPONENTS=energyStorage npm run dev
```

Tre proprieta' rendono il sistema robusto alla presenza di parti reali:

- **misure parziali** — un dispositivo che pubblica solo alcune grandezze copre
  quelle; le altre restano stimate dal modello;
- **degradazione automatica** — se il dispositivo tace oltre la finestra di
  validita' (`DEVICE_STALENESS_MS`), la sorgente torna da sola alla simulazione e
  il gemello continua a rispondere;
- **riallineamento** — quando il dispositivo torna a pubblicare, il gemello si
  riallinea al ciclo successivo senza alcun intervento.

Ogni campione di telemetria dichiara la provenienza del dato nel campo
`origins`, cosi' un consumer sa distinguere cio' che e' misurato da cio' che e'
stimato. Le soglie degli eventi sono valutate sullo stato *effettivo* del
gemello: con il pacco batteria reale collegato, e' la sua temperatura misurata a
far scattare l'allarme.

Per dimostrare la sostituzione senza hardware, `scripts/fake-device.ts` emula un
componente fisico. Sta deliberatamente **fuori** dal gemello: e' la parte reale.

```bash
npm run dev                              # terminale 1: il gemello
npm run device -- energyStorage          # terminale 2: il componente fisico
```

Alla connessione del dispositivo il SoH passa dal valore simulato (~96%) a
quello misurato (~81%), il Diagnostic Tool segnala il degrado, e alla
disconnessione il gemello torna al modello senza interruzione di servizio.

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

### Comunicazione: due binding template

Le affordance sono dichiarate **una sola volta** nelle Thing Description. E'
node-wot a generare, per ciascuna, una `form` per ogni binding attivo: un
consumer legge la TD e sceglie la form che sa parlare, senza che il suo codice
cambi. E' questa la potenzialita' dei binding templates.

| Binding | Semantica | Ruolo |
|---|---|---|
| `@node-wot/binding-http` | sincrono, request/response | lettura proprieta', invocazione azioni, TD |
| `@node-wot/binding-mqtt` | asincrono, publish/subscribe | osservazione proprieta', sottoscrizione eventi, comandi |

La stessa proprieta' risulta cosi' esposta su entrambi:

```
readproperty, observeproperty  ->  http://localhost:8080/powerunit/properties/batterySoC
readproperty, observeproperty  ->  mqtt://localhost:1883/PowerUnit/properties/batterySoC
```

Le form MQTT usano il vocabolario `mqv:` dei binding templates (per esempio
`mqv:qos: 2` sugli eventi). Il servient lato consumer registra entrambe le
client factory (`src/consumers/wot-client.ts`), quindi lo stesso
`invokeAction` viaggia indifferentemente su HTTP o su MQTT.

**Il broker non va installato.** Se nessun broker risponde, il runtime ne ospita
uno embedded (`selfHost`, basato su aedes); se un broker esterno e' presente, vi
si collega; se MQTT e' disabilitato o non avviabile, il sistema degrada in modo
controllato alla sola modalita' HTTP e il gemello continua a funzionare.

Accanto alle form generate dal binding, la telemetria aggregata dell'intero
gemello viaggia su un topic unico `wot/proactivedrive/telemetry`: e' un canale
di comodo per il monitoraggio, distinto dalla via interoperabile descritta
nelle TD.

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

`npm test` esegue 44 verifiche: test automatici sul modello e sulle regole dei
consumer, simulazioni parametriche per modalita' di guida (120 cicli, circa
4 minuti di simulazione), verifica della sostituzione fra componenti simulati e
reali, e due suite end-to-end sull'interfaccia WoT — una via HTTP e una sul
binding MQTT, con broker embedded, che verifica la doppia form nelle TD, il
vocabolario `mqv:`, l'invocazione della stessa azione sui due protocolli e la
ricezione di un evento sottoscritto via MQTT.

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
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | broker del binding MQTT |
| `MQTT_ENABLED` | `true` | `false` per la sola modalita' HTTP |
| `MQTT_SELF_HOST` | `true` | ospita un broker embedded se nessuno risponde |
| `REAL_COMPONENTS` | *(vuoto)* | componenti presenti come parte reale, separati da virgola |
| `DEVICE_STALENESS_MS` | `6000` | oltre questo silenzio la parte reale e' considerata assente |
| `STRESS_MODE` | `false` | forza rapidamente le soglie critiche |

## Tecnologie

Node.js · TypeScript · node-wot (implementazione di riferimento W3C WoT) ·
binding HTTP e MQTT · aedes (broker embedded) · HTML5 · CSS3 · JavaScript ·
Chart.js
