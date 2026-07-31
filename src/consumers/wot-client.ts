import { Servient } from "@node-wot/core";
import { HttpClientFactory } from "@node-wot/binding-http";
import { MqttClientFactory } from "@node-wot/binding-mqtt";

/**
 * Servient lato CLIENT.
 *
 * Registra le client factory HTTP e MQTT: da questo momento in poi il consumer
 * non decide piu' il protocollo. Sceglie la libreria, leggendo le `forms` della
 * Thing Description. Se la TD espone una form MQTT per un evento, node-wot usa
 * MQTT; se espone solo HTTP, usa HTTP. Nessun URL cablato a mano.
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
 * che espone proprieta', azioni ed eventi cosi' come li dichiara il dispositivo.
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

/**
 * Elenca i protocolli dichiarati dalla TD per una data affordance.
 * Serve a rendere visibile nei log quale binding template e' in uso.
 */
export const describeForms = (td: WoT.ThingDescription, kind: "properties" | "actions" | "events"): string[] => {
  const affordances = (td as unknown as Record<string, Record<string, { forms?: Array<{ href?: string; subprotocol?: string }> }>>)[kind];
  if (!affordances) {
    return [];
  }
  const schemes = new Set<string>();
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
