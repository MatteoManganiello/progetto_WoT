/**
 * ADATTAMENTO FRA node-wot E LE PORTE DEL GEMELLO.
 *
 * Lettura degli input di una interazione WoT: node-wot consegna agli handler un
 * `InteractionOutput`: e' lui a occuparsi del content-type e della
 * deserializzazione, in base alla form scelta dal client. Basta chiamare
 * `value()`.
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
 * Collega le proprieta' della Thing all'ultimo stato noto del componente.
 *
 * I nomi delle proprieta' coincidono con quelli della lettura, quindi il
 * collegamento e' meccanico: dichiararlo una riga per volta aggiungeva
 * ripetizione senza aggiungere informazione.
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
