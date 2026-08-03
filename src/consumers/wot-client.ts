import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";

/**
 * Servient lato CLIENT.
 *
 * Registra la client factory HTTP: da questo momento il consumer non costruisce
 * piu' URL a mano. E' node-wot a risolvere le `forms` dichiarate nella Thing
 * Description e a scegliere come raggiungere ogni interazione.
 */
export const createConsumerServient = async () => {
  const servient = new Servient();
  servient.addClientFactory(new HttpClientFactory());
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
