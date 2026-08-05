/**
 * node-wot consegna agli handler un `InteractionOutput` e si occupa lui di
 * content-type e deserializzazione, in base alla form scelta dal client:
 * qui basta chiamare `value()`.
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
 * Collega le proprieta' della Thing all'ultimo stato noto del componente. I
 * nomi coincidono con quelli della lettura, quindi il giro e' meccanico.
 */
export const bindReadHandlers = <TReading extends object>(
  thing: WoT.ExposedThing,
  source: { snapshot: () => TReading },
  properties: Array<keyof TReading & string>
): void => {
  for (const property of properties) {
    thing.setPropertyReadHandler(property, async () =>
      source.snapshot()[property] as WoT.InteractionInput
    );
  }
};
