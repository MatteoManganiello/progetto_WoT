import { consumeThing, createConsumerServient, readValue } from "./wot-client";

type OrchestratorConfig = {
  powerUnitTd: string;
  controlActuatorTd: string;
  intervalMs?: number;
};

type DriveMode = "Full Electric" | "Hybrid" | "Sport" | "Save";

type Snapshot = {
  batterySoC: number;
  speedKmh: number;
  controlMode: string;
  driveMode: DriveMode;
};

/**
 * Regole di efficienza. Restano una funzione pura, cosi' sono verificabili
 * dai test senza avviare ne' broker ne' servient.
 */
export const computeDriveMode = (snapshot: Pick<Snapshot, "batterySoC" | "speedKmh">): DriveMode => {
  if (snapshot.batterySoC < 15) {
    return "Save";
  }
  if (snapshot.batterySoC > 20 && snapshot.speedKmh < 50) {
    return "Full Electric";
  }
  if (snapshot.speedKmh > 90) {
    return "Sport";
  }
  return "Hybrid";
};

/**
 * ENERGY ORCHESTRATOR — consumer WoT.
 *
 * Legge lo stato dalle Thing consumate e agisce con `invokeAction`. Interviene
 * solo quando l'utente ha ceduto il controllo (`controlMode === "Auto"`).
 */
export const startEnergyOrchestrator = async (config: OrchestratorConfig) => {
  const intervalMs = config.intervalMs ?? 4000;
  const { wot, servient } = await createConsumerServient();

  const powerUnit = await consumeThing(wot, config.powerUnitTd);
  const controlActuator = await consumeThing(wot, config.controlActuatorTd);

  console.log("[Orchestrator] TD consumate, in attesa di controlMode=Auto");

  let lastAppliedMode: DriveMode | undefined;

  const tick = async () => {
    try {
      const [batterySoC, speedKmh, controlMode, driveMode] = await Promise.all([
        readValue<number>(powerUnit, "batterySoC"),
        readValue<number>(powerUnit, "speedKmh"),
        readValue<string>(controlActuator, "controlMode"),
        readValue<DriveMode>(controlActuator, "driveMode")
      ]);

      if (controlMode !== "Auto") {
        lastAppliedMode = undefined;
        return;
      }

      const target = computeDriveMode({ batterySoC, speedKmh });
      if (target === driveMode || target === lastAppliedMode) {
        return;
      }

      const output = await controlActuator.invokeAction("setDriveMode", target);
      const result = (await output?.value()) as { target?: string } | undefined;
      lastAppliedMode = target;
      console.log(
        `[Orchestrator] SoC ${batterySoC.toFixed(1)}% @ ${speedKmh.toFixed(0)} km/h -> ${target}` +
        (result?.target ? ` (applicato su: ${result.target})` : "")
      );
    } catch (error) {
      console.warn("[Orchestrator] ciclo fallito", error);
    }
  };

  const timer = setInterval(tick, intervalMs);
  void tick();

  return async () => {
    clearInterval(timer);
    await servient.shutdown();
  };
};
