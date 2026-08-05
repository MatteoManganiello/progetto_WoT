# WoT-ProActiveDrive

Digital Twin di un propulsore ibrido (motore a combustione interna + motore
elettrico + pacco batteria) realizzato secondo lo standard W3C Web of Things.

## Requisiti

Node.js 18 o superiore. Nessun broker MQTT da installare: se non ne trova uno
in ascolto, il progetto ne avvia uno embedded.

## Avvio

```bash
npm install
npm run dev
```

Una volta avviato:

| | Indirizzo |
|---|---|
| Dashboard web | `http://localhost:8091` |
| Thing Description (HTTP) | `http://localhost:8080/powerunit` · `/energystorage` · `/controlactuator` |
| Thing (MQTT) | topic `PowerUnit/*` · `EnergyStorage/*` · `ControlActuator/*` su `mqtt://localhost:1883` |

Esempi di interazione:

```bash
# lettura di una proprieta'
curl http://localhost:8080/powerunit/properties/batterySoC

# invocazione di un'azione
curl -X POST http://localhost:8080/controlactuator/actions/setDriveMode \
     -H "Content-Type: application/json" -d '"Sport"'
```

## Avviare un componente fisico

Per sostituire un componente simulato con un dispositivo reale, si avvia il
gemello dichiarando quali componenti sono presenti come parte fisica e poi si
avvia l'emulatore del dispositivo in un secondo terminale:

```bash
REAL_COMPONENTS=energyStorage npm run dev    # terminale 1
npm run device -- energyStorage              # terminale 2
```

Componenti disponibili: `powerUnit`, `energyStorage`, `controlActuator`.

## Test

```bash
npm test
```

## Build

```bash
npm run build
npm start
```

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `HTTP_PORT` | `8080` | porta delle Thing |
| `DASHBOARD_PORT` | `8091` | porta della dashboard |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | broker del binding MQTT |
| `MQTT_ENABLED` | `true` | `false` per la sola modalita' HTTP |
| `MQTT_SELF_HOST` | `true` | avvia un broker embedded se nessuno risponde |
| `REAL_COMPONENTS` | *(vuoto)* | componenti presenti come parte reale, separati da virgola |
| `DEVICE_STALENESS_MS` | `6000` | oltre questo silenzio la parte reale e' considerata assente |
| `STRESS_MODE` | `false` | forza rapidamente le soglie critiche |
