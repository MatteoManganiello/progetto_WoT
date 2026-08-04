import assert from "node:assert/strict";
import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import { MqttBrokerServer } from "@node-wot/binding-mqtt";
import { createSimulation } from "../src/sim-state";
import { createSimulatedSources } from "../src/sources";
import { createConsumerServient } from "../src/consumers/wot-client";
import { createPowerUnitThing } from "../src/thing";
import { createControlActuatorThing } from "../src/control-actuator";
import { suite, testAsync } from "./harness";

/**
 * BINDING TEMPLATE MQTT.
 *
 * Verifica che le stesse affordance, dichiarate una volta sola nella Thing
 * Description, siano raggiungibili su due protocolli: le `forms` generate da
 * node-wot devono comprendere sia HTTP sia MQTT, e un consumer deve poterle
 * usare senza cambiare una riga di codice.
 *
 * Il broker e' quello embedded del binding (aedes), su una porta dedicata: i
 * test non richiedono alcun broker installato.
 */
const HTTP_PORT = 8124;
const BROKER_PORT = 1884;
const BROKER_URI = `mqtt://localhost:${BROKER_PORT}`;

type Form = { href: string; op?: string | string[]; contentType?: string };

const formsOf = (interaction: { forms?: Form[] } | undefined): Form[] => interaction?.forms ?? [];

const indexOfScheme = (forms: Form[], scheme: string) =>
  forms.findIndex((form) => typeof form.href === "string" && form.href.startsWith(`${scheme}://`));

/** Attende che una condizione si verifichi, senza bloccare il test all'infinito. */
const waitFor = async (label: string, predicate: () => boolean, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timeout in attesa di: ${label}`);
};

export const run = async () => {
  suite("Binding template MQTT (broker embedded)");

  const simulation = createSimulation();
  const sources = createSimulatedSources(simulation);

  const servient = new Servient();
  servient.addServer(new HttpServer({ port: HTTP_PORT }));
  servient.addServer(new MqttBrokerServer({ uri: BROKER_URI, selfHost: true }));
  const wot = await servient.start();

  const powerUnit = await createPowerUnitThing(wot, sources);
  const controlActuator = await createControlActuatorThing(wot, sources);
  await Promise.all([powerUnit.expose(), controlActuator.expose()]);

  const consumer = await createConsumerServient();

  try {
    await testAsync("la stessa proprieta' e' esposta su HTTP e su MQTT", async () => {
      const td = powerUnit.getThingDescription() as {
        properties?: Record<string, { forms?: Form[] }>;
      };
      const forms = formsOf(td.properties?.batterySoC);

      assert.ok(indexOfScheme(forms, "http") >= 0, "manca la form HTTP");
      assert.ok(indexOfScheme(forms, "mqtt") >= 0, "manca la form MQTT");
    });

    await testAsync("azioni ed eventi dichiarano la propria form MQTT", async () => {
      const td = powerUnit.getThingDescription() as {
        actions?: Record<string, { forms?: Form[] }>;
        events?: Record<string, { forms?: Form[] }>;
      };

      for (const action of ["setDriveMode", "triggerRegen"]) {
        assert.ok(
          indexOfScheme(formsOf(td.actions?.[action]), "mqtt") >= 0,
          `azione '${action}' senza form MQTT`
        );
      }
      for (const event of ["criticalOverheat", "lowEnergyWarning", "anomalyDetected"]) {
        assert.ok(
          indexOfScheme(formsOf(td.events?.[event]), "mqtt") >= 0,
          `evento '${event}' senza form MQTT`
        );
      }
    });

    await testAsync("le form MQTT usano il vocabolario 'mqv' dei binding template", async () => {
      const td = powerUnit.getThingDescription() as {
        events?: Record<string, { forms?: Array<Form & { "mqv:qos"?: string }> }>;
      };
      const forms = formsOf(td.events?.criticalOverheat) as Array<Form & { "mqv:qos"?: string }>;
      const mqttForm = forms[indexOfScheme(forms, "mqtt")];

      assert.ok(mqttForm["mqv:qos"] !== undefined, "la form MQTT non dichiara 'mqv:qos'");
      assert.ok(
        mqttForm.href.includes("/events/criticalOverheat"),
        `topic inatteso: ${mqttForm.href}`
      );
    });

    await testAsync("un consumer invoca la stessa azione sui due binding", async () => {
      const td = controlActuator.getThingDescription();
      const consumed = await consumer.wot.consume(td);
      const forms = formsOf(
        (td as { actions?: Record<string, { forms?: Form[] }> }).actions?.setDriveMode
      );

      // Stessa chiamata, due protocolli: cambia solo la form scelta nella TD.
      await consumed.invokeAction("setDriveMode", "Save", {
        formIndex: indexOfScheme(forms, "http")
      });
      assert.equal(simulation.state.driveMode, "Save", "invocazione via HTTP");

      await consumed.invokeAction("setDriveMode", "Sport", {
        formIndex: indexOfScheme(forms, "mqtt")
      });
      await waitFor("comando MQTT applicato", () => simulation.state.driveMode === "Sport");
    });

    await testAsync("un consumer riceve un evento sottoscritto via MQTT", async () => {
      const td = powerUnit.getThingDescription();
      const consumed = await consumer.wot.consume(td);
      const forms = formsOf(
        (td as { events?: Record<string, { forms?: Form[] }> }).events?.criticalOverheat
      );

      let received: unknown;
      const subscription = await consumed.subscribeEvent(
        "criticalOverheat",
        async (data) => {
          received = await data.value();
        },
        undefined,
        { formIndex: indexOfScheme(forms, "mqtt") }
      );

      // Il broker deve aver registrato la sottoscrizione prima dell'emissione.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await powerUnit.emitEvent("criticalOverheat", { temperatureC: 101.4 });

      await waitFor("evento ricevuto su MQTT", () => received !== undefined);
      assert.deepEqual(received, { temperatureC: 101.4 });

      await subscription.stop();
    });
  } finally {
    /*
     * node-wot 0.9.2 chiude il pool MQTT senza attendere le disiscrizioni in
     * volo (`mqtt-message-pool.end()`): la connessione cade prima che il broker
     * risponda e la promise pendente viene rifiutata. Si lascia loro il tempo di
     * completare, cosi' la chiusura resta pulita e `npm test` non eredita un
     * errore che non appartiene al progetto.
     */
    await new Promise((resolve) => setTimeout(resolve, 300));
    await consumer.servient.shutdown();
    await servient.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
};
