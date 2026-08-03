import { consumeThing, createConsumerServient, readValue } from "./wot-client";

type DiagnosticConfig = {
  /** URL delle Thing Description, non degli endpoint: e' la TD a dire dove andare. */
  powerUnitTd: string;
  energyStorageTd: string;
  intervalMs?: number;
};

/** Soglie diagnostiche applicate alle proprieta' lette. */
export const DIAGNOSTIC_THRESHOLDS = {
  /** Oltre questa temperatura il gruppo propulsore e' in surriscaldamento. */
  overheatC: 90,
  /** Sotto questo stato di salute il pacco batteria e' considerato degradato. */
  degradedSoH: 85,
  /** Sotto questa autonomia residua scatta l'avviso di bassa energia. */
  lowRangeKm: 10
};

export type DiagnosticReading = {
  temperatureC: number;
  batterySoH: number;
  estimatedRangeKm: number;
};

/**
 * Regole diagnostiche a soglia. Funzione pura, verificabile senza servient.
 */
export const evaluateRisks = (reading: DiagnosticReading) => ({
  overheat: reading.temperatureC > DIAGNOSTIC_THRESHOLDS.overheatC,
  degradedBattery: reading.batterySoH < DIAGNOSTIC_THRESHOLDS.degradedSoH,
  lowRange: reading.estimatedRangeKm < DIAGNOSTIC_THRESHOLDS.lowRangeKm
});

/**
 * DIAGNOSTIC TOOL — consumer WoT.
 *
 * Non conosce gli URL delle proprieta': consuma le due Thing Description e legge
 * periodicamente via `readProperty`, lasciando a node-wot la risoluzione delle
 * form. Applica poi le soglie diagnostiche e segnala i rischi.
 */
export const startDiagnosticTool = async (config: DiagnosticConfig) => {
  const intervalMs = config.intervalMs ?? 6000;
  const { wot, servient } = await createConsumerServient();

  const powerUnit = await consumeThing(wot, config.powerUnitTd);
  const energyStorage = await consumeThing(wot, config.energyStorageTd);

  console.log("[Diagnostic] Thing Description consumate, monitoraggio a soglie avviato");

  // Si segnala il passaggio di soglia, non ogni singola lettura oltre soglia.
  const lastFlags = { overheat: false, degradedBattery: false, lowRange: false };

  const tick = async () => {
    try {
      const [temperatureC, estimatedRangeKm, batterySoH] = await Promise.all([
        readValue<number>(powerUnit, "temperatureC"),
        readValue<number>(powerUnit, "estimatedRangeKm"),
        readValue<number>(energyStorage, "batterySoH")
      ]);

      const risks = evaluateRisks({ temperatureC, batterySoH, estimatedRangeKm });

      if (risks.overheat && !lastFlags.overheat) {
        console.warn(`[Diagnostic] SURRISCALDAMENTO: ${temperatureC.toFixed(1)} C`);
      }
      if (risks.degradedBattery && !lastFlags.degradedBattery) {
        console.warn(`[Diagnostic] SoH batteria degradato: ${batterySoH.toFixed(1)}%`);
      }
      if (risks.lowRange && !lastFlags.lowRange) {
        console.warn(`[Diagnostic] AUTONOMIA BASSA: ${estimatedRangeKm.toFixed(1)} km`);
      }

      lastFlags.overheat = risks.overheat;
      lastFlags.degradedBattery = risks.degradedBattery;
      lastFlags.lowRange = risks.lowRange;
    } catch (error) {
      console.warn("[Diagnostic] lettura fallita", error);
    }
  };

  const timer = setInterval(tick, intervalMs);
  void tick();

  return async () => {
    clearInterval(timer);
    await servient.shutdown();
  };
};
