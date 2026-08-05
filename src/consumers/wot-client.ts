import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";
import { MqttClientFactory } from "@node-wot/binding-mqtt";

/**
 * Servient lato client: registra le factory dei protocolli che il consumer sa
 * parlare, e da qui in poi non si costruisce piu' nessun URL a mano — a
 * risolvere le `forms` della TD ci pensa node-wot.
 *
 * Registrando anche MQTT, lo stesso codice viaggia su HTTP o su MQTT a seconda
 * della form scelta.
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
 * Scarica la TD dall'URL e la consuma: il risultato espone proprieta' e azioni
 * come le dichiara il dispositivo, senza conoscerne prima l'interfaccia.
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
