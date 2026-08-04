import { ACTUATOR_ACTIONS, bindActuatorActions } from "./actuator-actions";
import { DRIVE_MODES } from "./sim-state";
import { TwinSources } from "./sources";
import { bindReadHandlers } from "./wot-io";

/**
 * Thing WoT "ControlActuator": attuatore di controllo del powertrain.
 *
 * Espone come Properties le due variabili di controllo (modalita' di guida e
 * intensita' di rigenerazione) e come Actions i comandi che le modificano.
 *
 * E' il punto in cui si chiude il verso digitale -> fisico del gemello: se
 * l'attuatore reale e' presente, la porta inoltra a lui il comando; altrimenti
 * lo applica al modello simulato.
 */
export const CONTROL_ACTUATOR_TD: WoT.ExposedThingInit = {
  "@context": "https://www.w3.org/2022/wot/td/v1.1",
  "@type": "Thing",
  id: "urn:dev:ops:proactivedrive-controlactuator",
  title: "ControlActuator",
  description: "Gemello digitale della centralina che ripartisce la propulsione.",
  securityDefinitions: {
    nosec_sc: { scheme: "nosec" }
  },
  security: ["nosec_sc"],
  properties: {
    driveMode: { type: "string", enum: DRIVE_MODES, observable: true, readOnly: true },
    regenIntensity: {
      type: "number",
      minimum: 0,
      maximum: 3,
      observable: true,
      readOnly: true,
      description: "Intensita' della frenata rigenerativa (0 = mai impostata)."
    }
  },
  actions: ACTUATOR_ACTIONS
};

export const createControlActuatorThing = async (wot: typeof WoT, sources: TwinSources) => {
  const thing = await wot.produce(CONTROL_ACTUATOR_TD);

  bindReadHandlers(thing, sources.controlActuator, ["driveMode", "regenIntensity"]);
  bindActuatorActions(thing, sources.controlActuator, "ControlActuator");

  return thing;
};
