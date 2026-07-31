"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeForms = exports.readValue = exports.consumeThing = exports.createConsumerServient = void 0;
const core_1 = require("@node-wot/core");
const binding_http_1 = require("@node-wot/binding-http");
const binding_mqtt_1 = require("@node-wot/binding-mqtt");
/**
 * Servient lato CLIENT.
 *
 * Registra le client factory HTTP e MQTT: da questo momento in poi il consumer
 * non decide piu' il protocollo. Sceglie la libreria, leggendo le `forms` della
 * Thing Description. Se la TD espone una form MQTT per un evento, node-wot usa
 * MQTT; se espone solo HTTP, usa HTTP. Nessun URL cablato a mano.
 */
const createConsumerServient = async () => {
    const servient = new core_1.Servient();
    servient.addClientFactory(new binding_http_1.HttpClientFactory());
    servient.addClientFactory(new binding_mqtt_1.MqttClientFactory());
    const wot = await servient.start();
    return { wot, servient };
};
exports.createConsumerServient = createConsumerServient;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Discovery per URL: scarica la TD e la "consuma". Il risultato e' un oggetto
 * che espone proprieta', azioni ed eventi cosi' come li dichiara il dispositivo.
 */
const consumeThing = async (wot, tdUrl, options = {}) => {
    const retries = options.retries ?? 10;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const td = await wot.requestThingDescription(tdUrl);
            return await wot.consume(td);
        }
        catch (error) {
            lastError = error;
            // Le Thing possono non essere ancora esposte quando il consumer parte.
            await delay(retryDelayMs);
        }
    }
    throw new Error(`Impossibile consumare la TD ${tdUrl}: ${String(lastError)}`);
};
exports.consumeThing = consumeThing;
/** Estrae il valore da un InteractionOutput senza ripetere il boilerplate. */
const readValue = async (thing, property) => {
    const output = await thing.readProperty(property);
    return (await output.value());
};
exports.readValue = readValue;
/**
 * Elenca i protocolli dichiarati dalla TD per una data affordance.
 * Serve a rendere visibile nei log quale binding template e' in uso.
 */
const describeForms = (td, kind) => {
    const affordances = td[kind];
    if (!affordances) {
        return [];
    }
    const schemes = new Set();
    for (const affordance of Object.values(affordances)) {
        for (const form of affordance.forms ?? []) {
            if (typeof form.href !== "string") {
                continue;
            }
            const scheme = form.href.split("://")[0];
            schemes.add(form.subprotocol ? `${scheme} (${form.subprotocol})` : scheme);
        }
    }
    return [...schemes];
};
exports.describeForms = describeForms;
