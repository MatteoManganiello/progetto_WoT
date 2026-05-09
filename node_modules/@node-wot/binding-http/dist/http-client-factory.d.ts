import { ProtocolClientFactory, ProtocolClient } from "@node-wot/core";
import { HttpConfig } from "./http";
export default class HttpClientFactory implements ProtocolClientFactory {
    readonly scheme: string;
    private config;
    private oAuthManager;
    constructor(config?: HttpConfig | null);
    getClient(): ProtocolClient;
    init(): boolean;
    destroy(): boolean;
}
