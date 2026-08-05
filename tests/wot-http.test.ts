import assert from "node:assert/strict";
import { Servient } from "@node-wot/core";
import { HttpServer } from "@node-wot/binding-http";
import { createSimulation } from "../src/sim-state";
import { createSimulatedSources } from "../src/sources";
import { createPowerUnitThing } from "../src/thing";
import { createEnergyStorageThing } from "../src/energy-storage";
import { createControlActuatorThing } from "../src/control-actuator";
import { suite, testAsync } from "./harness";

/**
 * Espone davvero le tre Thing su una porta e le interroga come farebbe un
 * consumer esterno: scarica la TD, ne ricava le `forms` e passa solo da quelle.
 */
const PORT = 8123;
const BASE_URL = `http://localhost:${PORT}`;

// node-wot genera le href con l'indirizzo con cui il server si e' annunciato,
// che sotto test puo' non essere raggiungibile: si tiene il percorso della TD
// e si riallinea solo l'origine.
const alignOrigin = (href: string) => {
  const url = new URL(href);
  return `${BASE_URL}${url.pathname}${url.search}`;
};

type Form = { href: string; op?: string | string[]; contentType?: string };
type ThingDescription = {
  "@context"?: unknown;
  id?: string;
  title?: string;
  securityDefinitions?: Record<string, { scheme: string }>;
  security?: string[];
  properties?: Record<string, { forms?: Form[] }>;
  actions?: Record<string, { forms?: Form[] }>;
  events?: Record<string, { forms?: Form[] }>;
};

const fetchTd = async (name: string): Promise<ThingDescription> => {
  const response = await fetch(`${BASE_URL}/${name}`, { headers: { Accept: "application/json" } });
  assert.equal(response.status, 200, `TD di '${name}' non servita`);
  return response.json() as Promise<ThingDescription>;
};

const hasOp = (form: Form, op: string) => {
  const ops = form.op;
  return Array.isArray(ops) ? ops.includes(op) : ops === op;
};

const pickForm = (forms: Form[] | undefined, op: string): Form => {
  const form = (forms ?? []).find((candidate) => hasOp(candidate, op)) ?? (forms ?? [])[0];
  assert.ok(form, `nessuna form con operazione '${op}'`);
  return form;
};

const readProperty = async (td: ThingDescription, name: string) => {
  const form = pickForm(td.properties?.[name]?.forms, "readproperty");
  const response = await fetch(alignOrigin(form.href), { headers: { Accept: "application/json" } });
  assert.equal(response.status, 200, `lettura di '${name}' fallita`);
  return response.json();
};

const invokeAction = async (td: ThingDescription, name: string, input: unknown) => {
  const form = pickForm(td.actions?.[name]?.forms, "invokeaction");
  const response = await fetch(alignOrigin(form.href), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input)
  });
  assert.equal(response.status, 200, `invocazione di '${name}' fallita`);
  return response.json();
};

export const run = async () => {
  suite("Interfaccia WoT end-to-end via HTTP");

  const simulation = createSimulation();
  const sources = createSimulatedSources(simulation);
  const servient = new Servient();
  servient.addServer(new HttpServer({ port: PORT }));
  const wot = await servient.start();

  const powerUnit = await createPowerUnitThing(wot, sources);
  const energyStorage = await createEnergyStorageThing(wot, sources);
  const controlActuator = await createControlActuatorThing(wot, sources);
  await Promise.all([powerUnit.expose(), energyStorage.expose(), controlActuator.expose()]);

  try {
    await testAsync("le tre Thing servono la propria Thing Description", async () => {
      const [power, storage, actuator] = await Promise.all([
        fetchTd("powerunit"),
        fetchTd("energystorage"),
        fetchTd("controlactuator")
      ]);

      assert.equal(power.title, "PowerUnit");
      assert.equal(storage.title, "EnergyStorage");
      assert.equal(actuator.title, "ControlActuator");
    });

    await testAsync("la TD e' conforme: @context W3C, id, securityDefinitions nosec", async () => {
      for (const name of ["powerunit", "energystorage", "controlactuator"]) {
        const td = await fetchTd(name);
        const context = Array.isArray(td["@context"]) ? td["@context"][0] : td["@context"];
        assert.equal(context, "https://www.w3.org/2022/wot/td/v1.1", `@context di '${name}'`);
        assert.ok(td.id?.startsWith("urn:dev:ops:"), `id di '${name}'`);
        assert.equal(td.securityDefinitions?.nosec_sc?.scheme, "nosec", `security di '${name}'`);
        assert.deepEqual(td.security, ["nosec_sc"]);
      }
    });

    await testAsync("la TD dichiara le affordance previste", async () => {
      const power = await fetchTd("powerunit");
      const storage = await fetchTd("energystorage");
      const actuator = await fetchTd("controlactuator");

      assert.deepEqual(Object.keys(power.properties ?? {}).sort(), [
        "batterySoC", "engineRPM", "estimatedRangeKm", "systemEfficiency", "temperatureC", "torqueNm"
      ]);
      assert.deepEqual(Object.keys(power.actions ?? {}).sort(), ["setDriveMode", "triggerRegen"]);
      assert.deepEqual(Object.keys(power.events ?? {}).sort(), [
        "anomalyDetected", "criticalOverheat", "lowEnergyWarning"
      ]);

      assert.deepEqual(Object.keys(storage.properties ?? {}).sort(), [
        "batterySoC", "batterySoH", "currentA", "temperatureC", "voltageV"
      ]);
      assert.equal(storage.actions, undefined, "il pacco batteria non e' attuabile");

      assert.deepEqual(Object.keys(actuator.properties ?? {}).sort(), ["driveMode", "regenIntensity"]);
      assert.deepEqual(Object.keys(actuator.actions ?? {}).sort(), ["setDriveMode", "triggerRegen"]);
    });

    await testAsync("lettura delle proprieta' seguendo le form della TD", async () => {
      const power = await fetchTd("powerunit");
      const storage = await fetchTd("energystorage");

      const batterySoC = await readProperty(power, "batterySoC");
      const temperatureC = await readProperty(power, "temperatureC");
      const batterySoH = await readProperty(storage, "batterySoH");

      assert.equal(typeof batterySoC, "number");
      assert.ok((batterySoC as number) >= 0 && (batterySoC as number) <= 100);
      assert.equal(typeof temperatureC, "number");
      assert.ok((batterySoH as number) > 0);
    });

    await testAsync("invocazione di setDriveMode e verifica sulla proprieta'", async () => {
      const actuator = await fetchTd("controlactuator");

      const result = await invokeAction(actuator, "setDriveMode", "Sport");
      assert.deepEqual(result, { activeMode: "Sport" });

      const driveMode = await readProperty(actuator, "driveMode");
      assert.equal(driveMode, "Sport");
      assert.equal(simulation.state.driveMode, "Sport");
    });

    await testAsync("invocazione di triggerRegen e verifica sulla proprieta'", async () => {
      const actuator = await fetchTd("controlactuator");

      const result = await invokeAction(actuator, "triggerRegen", 3);
      assert.deepEqual(result, { regenIntensity: 3 });
      assert.equal(await readProperty(actuator, "regenIntensity"), 3);
    });

    await testAsync("le azioni sono disponibili anche su PowerUnit", async () => {
      const power = await fetchTd("powerunit");

      assert.deepEqual(await invokeAction(power, "setDriveMode", "Save"), { activeMode: "Save" });
      assert.equal(simulation.state.driveMode, "Save");
    });

    await testAsync("un input fuori dai valori dichiarati viene rifiutato", async () => {
      const actuator = await fetchTd("controlactuator");
      const form = pickForm(actuator.actions?.setDriveMode?.forms, "invokeaction");

      const response = await fetch(alignOrigin(form.href), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("Teletrasporto")
      });

      assert.ok(response.status >= 400, `atteso un errore, ricevuto ${response.status}`);
      assert.equal(simulation.state.driveMode, "Save", "lo stato non viene alterato");
    });
  } finally {
    await servient.shutdown();
  }
};
