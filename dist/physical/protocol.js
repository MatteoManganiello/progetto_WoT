"use strict";
/**
 * Contratto di comunicazione fra la PARTE FISICA e la PARTE DIGITALE.
 *
 * Questo file e' l'unico punto di contatto fra i due mondi: un dispositivo reale
 * e un dispositivo simulato sono intercambiabili purche' rispettino questi topic
 * e questi payload. Il gemello digitale non sa (e non deve sapere) quale dei due
 * si trova dall'altra parte del broker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCommand = exports.parseTelemetry = exports.deviceFromTopic = exports.TELEMETRY_WILDCARD = exports.commandTopic = exports.telemetryTopic = exports.DEVICE_IDS = void 0;
exports.DEVICE_IDS = ["powerunit", "battery", "actuator"];
const NAMESPACE = "pad/physical";
/** Il dispositivo pubblica qui le sue misure. */
const telemetryTopic = (deviceId) => `${NAMESPACE}/${deviceId}/telemetry`;
exports.telemetryTopic = telemetryTopic;
/** Il gemello digitale pubblica qui i comandi diretti al dispositivo. */
const commandTopic = (deviceId) => `${NAMESPACE}/${deviceId}/command`;
exports.commandTopic = commandTopic;
/** Topic wildcard usato dal gemello per ascoltare tutti i dispositivi. */
exports.TELEMETRY_WILDCARD = `${NAMESPACE}/+/telemetry`;
const deviceFromTopic = (topic) => {
    const segments = topic.split("/");
    const candidate = segments[2];
    return exports.DEVICE_IDS.includes(candidate) ? candidate : undefined;
};
exports.deviceFromTopic = deviceFromTopic;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
/**
 * Validazione difensiva: la telemetria arriva da un processo esterno (o da hardware
 * reale) e non ci si puo' fidare della sua forma.
 */
const parseTelemetry = (raw) => {
    if (typeof raw !== "object" || raw === null) {
        return undefined;
    }
    const message = raw;
    if (!exports.DEVICE_IDS.includes(String(message.deviceId))) {
        return undefined;
    }
    if (typeof message.timestamp !== "string" || Number.isNaN(Date.parse(message.timestamp))) {
        return undefined;
    }
    if (typeof message.readings !== "object" || message.readings === null) {
        return undefined;
    }
    return {
        deviceId: message.deviceId,
        timestamp: message.timestamp,
        seq: isFiniteNumber(message.seq) ? message.seq : 0,
        readings: message.readings
    };
};
exports.parseTelemetry = parseTelemetry;
const parseCommand = (raw) => {
    if (typeof raw !== "object" || raw === null) {
        return undefined;
    }
    const message = raw;
    if (message.command === "setDriveMode" && typeof message.value === "string") {
        return { command: "setDriveMode", value: message.value, issuedAt: String(message.issuedAt ?? new Date().toISOString()) };
    }
    if (message.command === "triggerRegen" && isFiniteNumber(message.value)) {
        return { command: "triggerRegen", value: message.value, issuedAt: String(message.issuedAt ?? new Date().toISOString()) };
    }
    return undefined;
};
exports.parseCommand = parseCommand;
