/**
 * Lettura degli input di una interazione WoT.
 *
 * node-wot consegna agli handler un `InteractionOutput`: e' lui a occuparsi del
 * content-type e della deserializzazione, in base alla form scelta dal client.
 * Basta chiamare `value()`.
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
