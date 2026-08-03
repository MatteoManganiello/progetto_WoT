"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInteractionInput = void 0;
/**
 * Lettura degli input di una interazione WoT.
 *
 * node-wot consegna agli handler un `InteractionOutput`: e' lui a occuparsi del
 * content-type e della deserializzazione, in base alla form scelta dal client.
 * Basta chiamare `value()`.
 */
const readInteractionInput = async (params) => {
    if (params !== null &&
        typeof params === "object" &&
        "value" in params &&
        typeof params.value === "function") {
        return params.value();
    }
    return params;
};
exports.readInteractionInput = readInteractionInput;
