import { ACTUATOR_ACTIONS, bindActuatorActions } from "./actuator-actions";
import { DRIVE_MODES } from "./sim-state";
import { TwinSources } from "./sources";
import { bindReadHandlers } from "./wot-io";

/**
 * Thing "ControlActuator": centralina di controllo del powertrain. Le due
 * variabili di controllo come Properties, i comandi che le modificano come
 * Actions.
 *
 * E' il punto in cui si chiude il verso digitale -> fisico: se l'attuatore
 * reale c'e' il comando va a lui, altrimenti al modello.
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
