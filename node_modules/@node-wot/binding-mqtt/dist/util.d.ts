import { MqttQoS } from "./mqtt";
import { IClientPublishOptions } from "mqtt";
export declare function mapQoS(qos: MqttQoS | undefined): Required<IClientPublishOptions>["qos"];
