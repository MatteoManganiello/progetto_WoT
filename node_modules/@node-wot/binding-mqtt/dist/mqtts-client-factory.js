"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@node-wot/core");
const mqtt_client_1 = __importDefault(require("./mqtt-client"));
const debug = (0, core_1.createDebugLogger)("binding-mqtt", "mqtts-client-factory");
class MqttsClientFactory {
    constructor(config) {
        this.config = config;
        this.scheme = "mqtts";
        this.clients = [];
    }
    getClient() {
        const client = new mqtt_client_1.default(this.config, true);
        this.clients.push(client);
        return client;
    }
    init() {
        return true;
    }
    destroy() {
        debug(`MqttClientFactory stopping all clients for '${this.scheme}'`);
        this.clients.forEach((client) => client.stop());
        return true;
    }
}
exports.default = MqttsClientFactory;
//# sourceMappingURL=mqtts-client-factory.js.map