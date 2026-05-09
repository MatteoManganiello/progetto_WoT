type DiagnosticConfig = {
  baseUrl: string;
  intervalMs?: number;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

export const startDiagnosticTool = (config: DiagnosticConfig) => {
  const intervalMs = config.intervalMs ?? 6000;
  const powerUnit = `${config.baseUrl}/powerunit`;
  const energyStorage = `${config.baseUrl}/energystorage`;

  let timer: NodeJS.Timeout | undefined;
  const lastFlags = {
    overheat: false,
    thermalLow: false,
    sohLow: false,
    rangeLow: false
  };

  const tick = async () => {
    try {
      const [thermalHealth, temperatureC, estimatedRangeKm, batterySoH] = await Promise.all([
        fetchJson(`${powerUnit}/properties/thermalHealth`),
        fetchJson(`${powerUnit}/properties/temperatureC`),
        fetchJson(`${powerUnit}/properties/estimatedRangeKm`),
        fetchJson(`${energyStorage}/properties/batterySoH`)
      ]);

      const overheat = temperatureC > 95;
      const thermalLow = thermalHealth < 40;
      const sohLow = batterySoH < 85;
      const rangeLow = estimatedRangeKm < 10;

      if (overheat && !lastFlags.overheat) {
        console.warn(`[Diagnostic] Overheat risk: ${temperatureC.toFixed(1)}C`);
      }
      if (thermalLow && !lastFlags.thermalLow) {
        console.warn(`[Diagnostic] Low thermal health: ${thermalHealth.toFixed(0)}%`);
      }
      if (sohLow && !lastFlags.sohLow) {
        console.warn(`[Diagnostic] Battery SoH degraded: ${batterySoH.toFixed(0)}%`);
      }
      if (rangeLow && !lastFlags.rangeLow) {
        console.warn(`[Diagnostic] Low range: ${estimatedRangeKm.toFixed(1)} km`);
      }

      lastFlags.overheat = overheat;
      lastFlags.thermalLow = thermalLow;
      lastFlags.sohLow = sohLow;
      lastFlags.rangeLow = rangeLow;
    } catch (error) {
      console.warn("[Diagnostic] update failed", error);
    }
  };

  timer = setInterval(tick, intervalMs);
  void tick();

  return () => {
    if (timer) {
      clearInterval(timer);
    }
  };
};
