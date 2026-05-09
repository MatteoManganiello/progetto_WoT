type OrchestratorConfig = {
  baseUrl: string;
  intervalMs?: number;
};

type DriveMode = "Full Electric" | "Hybrid" | "Sport" | "Save";

type ControlSnapshot = {
  batterySoC: number;
  speedKmh: number;
  controlMode: string;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const postJson = async (url: string, payload: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
};

const computeDriveMode = (snapshot: ControlSnapshot): DriveMode => {
  if (snapshot.batterySoC > 20 && snapshot.speedKmh < 50) {
    return "Full Electric";
  }
  if (snapshot.batterySoC < 15) {
    return "Save";
  }
  if (snapshot.speedKmh > 90) {
    return "Sport";
  }
  return "Hybrid";
};

export const startEnergyOrchestrator = (config: OrchestratorConfig) => {
  const intervalMs = config.intervalMs ?? 4000;
  const controlActuator = `${config.baseUrl}/controlactuator`;
  const powerUnit = `${config.baseUrl}/powerunit`;

  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    try {
      const [batterySoC, speedKmh, controlMode, driveMode] = await Promise.all([
        fetchJson(`${powerUnit}/properties/batterySoC`),
        fetchJson(`${powerUnit}/properties/speedKmh`),
        fetchJson(`${controlActuator}/properties/controlMode`),
        fetchJson(`${controlActuator}/properties/driveMode`)
      ]);

      const snapshot: ControlSnapshot = {
        batterySoC,
        speedKmh,
        controlMode
      };

      if (snapshot.controlMode !== "Auto") {
        return;
      }

      const targetDriveMode = computeDriveMode(snapshot);
      if (driveMode !== targetDriveMode) {
        await postJson(`${controlActuator}/actions/setDriveMode`, targetDriveMode);
      }
    } catch (error) {
      console.warn("[Orchestrator] update failed", error);
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
