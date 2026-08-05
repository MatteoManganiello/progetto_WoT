import { consumeThing, createConsumerServient, readValue } from "./wot-client";

type OrchestratorConfig = {
  powerUnitTd: string;
  controlActuatorTd: string;
  intervalMs?: number;
};

type DriveMode = "Full Electric" | "Hybrid" | "Sport" | "Save";

/**
 * Regole per la gestione automatica della coppia: dalla modalita' di guida
 * discendono coppia richiesta e ripartizione fra i due motori. Pura, cosi' si
 * testa senza avviare un servient.
 */
export const computeDriveMode = (snapshot: { batterySoC: number; speedKmh: number }): DriveMode => {
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
 * Consumer che chiude l'anello di controllo: legge le proprieta' e agisce con
 * `invokeAction`, senza conoscere ne' URL ne' protocollo.
 *
 * Non viene avviato dal runtime, altrimenti si contenderebbe la modalita' di
 * guida con i comandi manuali della dashboard.
 */
export const startEnergyOrchestrator = async (config: OrchestratorConfig) => {
  const intervalMs = config.intervalMs ?? 4000;
  const { wot, servient } = await createConsumerServient();

  const powerUnit = await consumeThing(wot, config.powerUnitTd);
  const controlActuator = await consumeThing(wot, config.controlActuatorTd);

  let lastAppliedMode: DriveMode | undefined;

  const tick = async () => {
    try {
      const [batterySoC, driveMode] = await Promise.all([
        readValue<number>(powerUnit, "batterySoC"),
        readValue<DriveMode>(controlActuator, "driveMode")
      ]);
      // La velocita' non e' esposta: si usa il regime motore come proxy della domanda.
      const engineRPM = await readValue<number>(powerUnit, "engineRPM");
      const speedKmh = Math.max(0, (engineRPM - 900) / 22);

      const target = computeDriveMode({ batterySoC, speedKmh });
      if (target === driveMode || target === lastAppliedMode) {
        return;
      }

      await controlActuator.invokeAction("setDriveMode", target);
      lastAppliedMode = target;
      console.log(`[Orchestrator] SoC ${batterySoC.toFixed(1)}% @ ${speedKmh.toFixed(0)} km/h -> ${target}`);
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
