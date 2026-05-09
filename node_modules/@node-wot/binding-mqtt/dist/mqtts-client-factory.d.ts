import { ProtocolClientFactory, ProtocolClient } from "@node-wot/core";
import { MqttClientConfig } from "./mqtt";
export default class MqttsClientFactory implements ProtocolClientFactory {
    private readonly config;
    readonly scheme: string;
    private readonly clients;
    constructor(config: MqttClientConfig);
    getClient(): ProtocolClient;
    init(): boolean;
    destroy(): boolean;
}
