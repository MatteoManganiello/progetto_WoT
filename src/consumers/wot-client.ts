import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";
import { MqttClientFactory } from "@node-wot/binding-mqtt";

/**
 * Servient lato CLIENT.
 *
 * Registra le client factory dei protocolli che il consumer sa parlare: da
 * questo momento non costruisce piu' URL a mano. E' node-wot a risolvere le
 * `forms` dichiarate nella Thing Description e a scegliere come raggiungere
 * ogni interazione.
 *
 * Registrare anche MQTT accanto a HTTP e' esattamente il valore dei binding
 * templates: il codice del consumer resta identico, e' la TD a determinare su
 * quale protocollo l'interazione viaggia.
 */
export const createConsumerServient = async () => {
  const servient = new Servient();
  servient.addClientFactory(new HttpClientFactory());
  servient.addClientFactory(new MqttClientFactory());
  const wot = await servient.start();
  return { wot, servient };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Discovery per URL: scarica la TD e la "consuma". Il risultato e' un oggetto
 * che espone proprieta' e azioni cosi' come le dichiara il dispositivo, senza
 * conoscenza a priori dell'interfaccia.
 */
export const consumeThing = async (
  wot: typeof WoT,
  tdUrl: string,
  options: { retries?: number; retryDelayMs?: number } = {}
): Promise<WoT.ConsumedThing> => {
  const retries = options.retries ?? 10;
  const retryDelayMs = options.retryDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const td = await wot.requestThingDescription(tdUrl);
      return await wot.consume(td);
    } catch (error) {
      lastError = error;
      // Le Thing possono non essere ancora esposte quando il consumer parte.
      await delay(retryDelayMs);
    }
  }
  throw new Error(`Impossibile consumare la TD ${tdUrl}: ${String(lastError)}`);
};

/** Estrae il valore da un InteractionOutput senza ripetere il boilerplate. */
export const readValue = async <T>(thing: WoT.ConsumedThing, property: string): Promise<T> => {
  const output = await thing.readProperty(property);
  return (await output.value()) as T;
};
