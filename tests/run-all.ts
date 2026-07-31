import { summary } from "./harness";
import { run as runSimState } from "./sim-state.test";
import { run as runProtocol } from "./protocol.test";
import { run as runShadow } from "./shadow.test";
import { run as runRegistry } from "./twin-registry.test";
import { run as runOrchestrator } from "./orchestrator-rules.test";

runSimState();
runProtocol();
runShadow();
runRegistry();
runOrchestrator();

summary();
