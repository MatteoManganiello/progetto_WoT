"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readValue = exports.consumeThing = exports.createConsumerServient = void 0;
const core_1 = require("@node-wot/core");
const binding_http_1 = require("@node-wot/binding-http");
/**
 * Servient lato CLIENT.
 *
 * Registra la client factory HTTP: da questo momento il consumer non costruisce
 * piu' URL a mano. E' node-wot a risolvere le `forms` dichiarate nella Thing
 * Description e a scegliere come raggiungere ogni interazione.
 */
const createConsumerServient = async () => {
    const servient = new core_1.Servient();
    servient.addClientFactory(new binding_http_1.HttpClientFactory());
    const wot = await servient.start();
    return { wot, servient };
};
exports.createConsumerServient = createConsumerServient;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Discovery per URL: scarica la TD e la "consuma". Il risultato e' un oggetto
 * che espone proprieta' e azioni cosi' come le dichiara il dispositivo, senza
 * conoscenza a priori dell'interfaccia.
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
