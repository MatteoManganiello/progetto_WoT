# WoT-ProActiveDrive

Digital Twin di un propulsore ibrido (motore termico + motore elettrico + batteria) basato su W3C Web of Things.

## Avvio rapido

1. `npm install`
2. `npm run dev`

Le Thing WoT sono esposte via HTTP:
- PowerUnit: `http://localhost:8080/powerunit`
- EnergyStorage: `http://localhost:8080/energystorage`
- ControlActuator: `http://localhost:8080/controlactuator`

La dashboard web e' disponibile su `http://localhost:8091`.
Lo storico e' disponibile su `http://localhost:8091/api/history` e viene salvato in `data/history.json`.

Di default usa `mqtt://localhost:1883`. Per usare un broker MQTT diverso, imposta `MQTT_BROKER_URL`.
Se la porta 8080 e' occupata, imposta `HTTP_PORT`.
Se vuoi cambiare la dashboard, imposta `DASHBOARD_PORT`.

Se la tua rete blocca i broker pubblici, puoi avviare solo HTTP con `MQTT_ENABLED=false`.
Se il broker MQTT non è raggiungibile, il server parte comunque in modalità HTTP-only.

Per testare soglie critiche ed eventi in modo rapido, puoi usare `STRESS_MODE=true`.

La dashboard mostra solo il controllo manuale della guida e della rigenerazione.

Servizi consumer attivi:
- Energy Orchestrator: disabilitato, poiché la gestione è manuale.
- Diagnostic Tool: logga anomalie e rischi.

Telemetria MQTT:
- Topic: `wot/proactivedrive/telemetry`

Esempi rapidi (PowerUnit):
- Leggi la SoC: `curl http://localhost:8080/powerunit/properties/batterySoC`
- Imposta la modalita': `curl -X POST http://localhost:8080/controlactuator/actions/setDriveMode -H "Content-Type: application/json" -d "\"Hybrid\""`

## WoT-ProActiveDrive: Gestione Ibrida Predittiva

### Obiettivo del progetto
Il progetto consiste nello sviluppo di un sistema di monitoraggio e controllo per un propulsore ibrido (motore termico + motore elettrico) basato sullo standard **WoT (Web of Things)**.
L'idea e' creare un **Digital Twin** che mostri i dati in tempo reale e che utilizzi regole/logiche predittive per migliorare l'efficienza energetica e aiutare a prevenire guasti, grazie alla comunicazione tra sensori e attuatori.

### Funzionalita previste
- **Monitoraggio energetico in tempo reale**: visualizzazione dei flussi di potenza tra batteria, motore elettrico e motore a combustione.
- **Ottimizzazione predittiva**: gestione automatica della ripartizione della coppia per consumare meno energia.
- **Manutenzione predittiva**: controllo dello stato di salute (SoH) di batteria e componenti termici, con avvisi in caso di rischio.
- **Ricarica intelligente e recupero energia**: gestione della frenata rigenerativa e dei cicli di ricarica.
- **Dashboard di telemetria**: interfaccia web per vedere dati live, cambiare modalita di guida e analizzare lo storico.

### Architettura del sistema

#### Things (Dispositivi WoT)
- **Power Unit (ICE + Electric)**
	Rileva: giri motore (**RPM**), coppia (**Nm**) e temperatura di funzionamento.
- **Energy Storage (Battery Pack)**
	Rileva: tensione, corrente e stato di carica (**SoC**).
- **Control Actuator**
	Un componente di controllo che gestisce il passaggio tra le modalita di propulsione.

#### Client WoT (Consumer)
- **Energy Orchestrator**
	Applica regole di efficienza (es. *"Se SoC > 20% e velocita < 50 km/h, usa Electric"*).
- **Predictive Dashboard**
	Mostra dati in tempo reale e stime di autonomia futura.
- **Diagnostic Tool**
	Analizza errori/anomalie e suggerisce interventi di manutenzione.

### Thing Description (TD)
Ogni Thing pubblica una **Thing Description**, cioe un documento che descrive cosa puo fare tramite:

#### Proprieta (Properties)
- `systemEfficiency`: rapporto tra energia consumata e km percorsi.
- `batterySoC`: livello di carica della batteria.
- `engineStatus`: stato del motore termico (Spento / Idle / In funzione).
- `thermalHealth`: indice di surriscaldamento dei componenti critici.

#### Azioni (Actions)
- `setDriveMode(mode)`: cambia modalita (Full Electric, Hybrid, Sport, Save).
- `triggerRegen(intensity)`: imposta frenata rigenerativa (1-3).

#### Eventi (Events)
- `criticalOverheat`: supera soglia di temperatura su inverter o batteria.
- `lowEnergyWarning`: autonomia stimata sotto 10 km.
- `anomalyDetected`: consumi anomali (possibile guasto o perdita).

### Comunicazione
- **MQTT** per inviare i dati di telemetria in modo continuo e veloce.
- **HTTP** per inviare comandi (azioni) in modo asincrono.
- I client possono scoprire automaticamente le funzionalita dei dispositivi leggendo la **TD**, facilitando l'aggiunta di nuovi sensori.

### Tecnologie utilizzate
- **Backend / Cose**: Node.js, `node-wot`, TypeScript (controllo e simulazione).
- **Frontend**: HTML5, CSS3 (Tailwind), JavaScript (Chart.js per i grafici).
- **Protocollo dati**: MQTT (Mosquitto), formato JSON.

Test minimi:
- `npm test`
