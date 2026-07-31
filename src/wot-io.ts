/**
 * Lettura degli input di una interazione WoT.
 *
 * node-wot consegna agli handler un `InteractionOutput`: e' lui a occuparsi del
 * content-type e della deserializzazione, in base alla form scelta dal client.
 * Basta chiamare `value()`. Prima qui c'era un parser JSON scritto a mano,
 * duplicato in due file: era la spia di un uso improprio della libreria.
 */
export const readInteractionInput = async (params: unknown): Promise<unknown> => {
  if (
    params !== null &&
    typeof params === "object" &&
    "value" in params &&
    typeof (params as { value?: unknown }).value === "function"
  ) {
    return (params as { value: () => Promise<unknown> }).value();
  }
  return params;
};

/**
 * Schema riusato dalle tre Thing per dichiarare, dentro la TD stessa, se il
 * valore servito viene da un sensore reale o dal modello di fallback.
 * E' il metadato che rende osservabile la separazione fisico/digitale.
 */
export const TWIN_STATUS_SCHEMA: WoT.DataSchema = {
  type: "object",
  description: "Origine e freschezza dei dati serviti dal gemello digitale.",
  properties: {
    deviceId: { type: "string", description: "Dispositivo fisico corrispondente." },
    source: {
      type: "string",
      enum: ["physical", "model"],
      description: "physical = misura reale; model = valore ricostruito dal gemello."
    },
    live: { type: "boolean", description: "true se la parte fisica sta pubblicando." },
    lastSeen: { type: "string", description: "Timestamp dell'ultima misura reale; assente se mai ricevuta." },
    ageMs: { type: "number", unit: "ms", description: "Eta' dell'ultima misura reale; assente se mai ricevuta." },
    samples: { type: "number", description: "Numero di misure reali ricevute." }
  },
  required: ["deviceId", "source", "live", "samples"]
};
