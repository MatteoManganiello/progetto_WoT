"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeviceBus = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const protocol_1 = require("./protocol");
const parseJson = (payload) => {
    try {
        return JSON.parse(payload.toString());
    }
    catch {
        return undefined;
    }
};
const createDeviceBus = (options) => {
    const telemetryHandlers = [];
    const commandHandlers = new Map();
    const client = mqtt_1.default.connect(options.brokerUrl, {
        clientId: `${options.clientLabel}-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 2000,
        connectTimeout: 4000
    });
    client.on("connect", () => {
        console.log(`[Bus:${options.clientLabel}] connesso al broker ${options.brokerUrl}`);
        if (options.subscribeTelemetry) {
            client.subscribe(protocol_1.TELEMETRY_WILDCARD, { qos: 0 });
        }
        for (const deviceId of options.subscribeCommandsFor ?? []) {
            client.subscribe((0, protocol_1.commandTopic)(deviceId), { qos: 1 });
        }
    });
    // Il broker puo' essere assente: e' un caso previsto, non un errore fatale.
    // Il gemello digitale continua a funzionare in modalita' modello.
    let warnedOffline = false;
    client.on("error", () => {
        if (!warnedOffline) {
            warnedOffline = true;
            console.warn(`[Bus:${options.clientLabel}] broker non raggiungibile, riprovo in background`);
        }
    });
    client.on("reconnect", () => {
        warnedOffline = false;
    });
    client.on("message", (topic, payload) => {
        const parsed = parseJson(payload);
        if (parsed === undefined) {
            return;
        }
        if (topic.endsWith("/telemetry")) {
            const telemetry = (0, protocol_1.parseTelemetry)(parsed);
            if (telemetry) {
                telemetryHandlers.forEach((handler) => handler(telemetry));
            }
            return;
        }
        if (topic.endsWith("/command")) {
            const deviceId = (0, protocol_1.deviceFromTopic)(topic);
            const command = (0, protocol_1.parseCommand)(parsed);
            if (deviceId && command) {
                (commandHandlers.get(deviceId) ?? []).forEach((handler) => handler(command));
            }
        }
    });
    const sequenceByDevice = new Map();
    return {
        isConnected: () => client.connected,
        publishTelemetry: (deviceId, readings, seq) => {
            if (!client.connected) {
                return;
            }
            sequenceByDevice.set(deviceId, seq);
            const message = {
                deviceId,
                timestamp: new Date().toISOString(),
                seq,
                readings
            };
            client.publish((0, protocol_1.telemetryTopic)(deviceId), JSON.stringify(message), { qos: 0 });
        },
        publishCommand: (deviceId, command) => {
            if (!client.connected) {
                return;
            }
            client.publish((0, protocol_1.commandTopic)(deviceId), JSON.stringify(command), { qos: 1 });
        },
        onTelemetry: (handler) => {
            telemetryHandlers.push(handler);
        },
        onCommand: (deviceId, handler) => {
            const handlers = commandHandlers.get(deviceId) ?? [];
            handlers.push(handler);
            commandHandlers.set(deviceId, handlers);
        },
        close: async () => {
            await new Promise((resolve) => client.end(true, {}, () => resolve()));
        }
    };
};
exports.createDeviceBus = createDeviceBus;
