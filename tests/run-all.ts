import { summary } from "./harness";
import { run as runSimState } from "./sim-state.test";
import { run as runModeSweep } from "./mode-sweep.test";
import { run as runDiagnostic } from "./diagnostic-rules.test";
import { run as runOrchestrator } from "./orchestrator-rules.test";
import { run as runWotHttp } from "./wot-http.test";

const main = async () => {
  runSimState();
  runModeSweep();
  runDiagnostic();
  runOrchestrator();
  await runWotHttp();

  summary();
};

void main();
