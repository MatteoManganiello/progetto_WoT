export type DriveMode = "Full Electric" | "Hybrid" | "Sport" | "Save";
export type EngineStatus = "Off" | "Idle" | "Running";
export type ControlMode = "Manual";
export type RegenMode = "Manual";

export type SimulationState = {
  batterySoC: number;
  batterySoH: number;
  engineRPM: number;
  torqueNm: number;
  temperatureC: number;
  thermalHealth: number;
  systemEfficiency: number;
  engineStatus: EngineStatus;
  driveMode: DriveMode;
  controlMode: ControlMode;
  regenIntensity: number;
  regenMode: RegenMode;
  speedKmh: number;
  distanceKm: number;
  energyUsedKwh: number;
  estimatedRangeKm: number;
  voltageV: number;
  currentA: number;
  lastEfficiency: number;
};

export type SimulationEvents = {
  criticalOverheat: boolean;
  lowEnergyWarning: boolean;
  anomalyDetected: boolean;
};

export const DRIVE_MODES: DriveMode[] = ["Full Electric", "Hybrid", "Sport", "Save"];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createSimulation = () => {
  const stressMode = (process.env.STRESS_MODE ?? "false").toLowerCase() === "true";
  const stressFactor = stressMode ? 2 : 1;
  const state: SimulationState = {
    batterySoC: 78,
    batterySoH: 96,
    engineRPM: 1100,
    torqueNm: 120,
    temperatureC: 62,
    thermalHealth: 92,
    systemEfficiency: 5.2,
    engineStatus: "Idle",
    driveMode: "Hybrid",
    controlMode: "Manual",
    regenIntensity: 0,
    regenMode: "Manual",
    speedKmh: 38,
    distanceKm: 0,
    energyUsedKwh: 0.2,
    estimatedRangeKm: 60,
    voltageV: 360,
    currentA: 40,
    lastEfficiency: 5.2
  };

  let tick = 0;
  let lastSpeed = state.speedKmh;
  let anomalyStreak = 0;
  const ambientTemp = 32;

  const update = (): SimulationEvents => {
    tick += 1;
    const dtSeconds = 2;

    const baseSpeed = 42 + 12 * Math.sin(tick / 12);
    const modeOffset = state.driveMode === "Sport" ? 25 : state.driveMode === "Full Electric" ? -5 : 0;
    state.speedKmh = clamp(baseSpeed + modeOffset, 10, 130);

    const accel = (state.speedKmh - lastSpeed) / dtSeconds;
    const regenActive = accel < -0.2;

    const demandFactor = 1 + state.speedKmh / 180;
    const driveFactor = state.driveMode === "Sport" ? 1.35 : state.driveMode === "Save" ? 0.75 : 1;
    const torque = 110 * demandFactor * driveFactor;
    state.torqueNm = clamp(torque, 80, 360);

    if (state.driveMode === "Full Electric" && state.batterySoC > 18) {
      state.engineStatus = "Off";
    } else if (state.driveMode === "Hybrid" && state.speedKmh < 35 && state.batterySoC > 28) {
      state.engineStatus = "Idle";
    } else {
      state.engineStatus = "Running";
    }

    state.engineRPM = state.engineStatus === "Off"
      ? 0
      : clamp(900 + state.speedKmh * 22 + (state.driveMode === "Sport" ? 400 : 0), 800, 6200);

    const drainBase = state.driveMode === "Full Electric" ? 0.45 : state.driveMode === "Hybrid" ? 0.32 : state.driveMode === "Save" ? 0.2 : 0.55;
    const socGuard = state.batterySoC < 20 ? 0.7 : 1;
    const drain = drainBase * demandFactor * socGuard * driveFactor * stressFactor;
    const regenBoost = state.regenIntensity > 0 && regenActive ? state.regenIntensity * 0.45 : 0;
    state.batterySoC = clamp(state.batterySoC - drain + regenBoost, 0, 100);

    const sportHeat = state.driveMode === "Sport" ? 0.6 : 0;
    const loadHeat = Math.max(0, state.torqueNm - 220) * 0.002;
    const speedHeat = Math.max(0, state.speedKmh - 80) * 0.02;
    const engineHeat = (state.engineStatus === "Running" ? 0.55 + state.speedKmh / 260 : 0.1)
      + sportHeat
      + loadHeat
      + speedHeat;
    const regenCooling = regenActive && state.regenIntensity > 0 ? 0.35 + state.regenIntensity * 0.1 : 0.1;
    const coolingPenalty = state.driveMode === "Sport" ? 0.14 : 0;
    const airflowCooling = 0.12 + Math.max(0, state.temperatureC - ambientTemp)
      * (state.engineStatus === "Running" ? 0.018 : 0.03);
    const effectiveCooling = Math.max(0, airflowCooling - coolingPenalty);
    state.temperatureC = clamp(
      state.temperatureC + engineHeat * stressFactor - regenCooling - effectiveCooling,
      ambientTemp,
      120
    );
    state.thermalHealth = clamp(100 - Math.max(0, state.temperatureC - 70) * 1.8, 0, 100);

    const batteryWear = state.temperatureC > 90 ? 0.01 : 0.001;
    state.batterySoH = clamp(state.batterySoH - batteryWear, 70, 100);

    const distanceDelta = state.speedKmh * (dtSeconds / 3600);
    state.distanceKm += distanceDelta;
    const energyDelta = Math.max(0, drain - regenBoost) * 0.04 + (state.engineStatus === "Running" ? 0.015 : 0);
    state.energyUsedKwh += energyDelta;

    state.systemEfficiency = state.distanceKm / Math.max(state.energyUsedKwh, 0.1);
    state.estimatedRangeKm = clamp(state.batterySoC * 0.85, 0, 130);

    state.voltageV = 320 + state.batterySoC * 0.8;
    state.currentA = regenActive && state.regenIntensity > 0 ? -30 * state.regenIntensity : 80 * driveFactor;

    const efficiencyDrop = state.lastEfficiency - state.systemEfficiency;
    const lowEfficiency = state.systemEfficiency < 1.2;
    const suddenDrop = efficiencyDrop > 1.2 && state.torqueNm > 280;

    if (tick < 8) {
      anomalyStreak = 0;
    } else if (lowEfficiency || suddenDrop) {
      anomalyStreak += 1;
    } else {
      anomalyStreak = 0;
    }

    const anomalyDetected = anomalyStreak >= 3;
    state.lastEfficiency = state.systemEfficiency;

    lastSpeed = state.speedKmh;

    return {
      criticalOverheat: state.temperatureC > 90,
      lowEnergyWarning: state.estimatedRangeKm < 10,
      anomalyDetected
    };
  };

  const resetTripData = () => {
    state.distanceKm = 0;
    state.energyUsedKwh = 0.2;
  };

  const setDriveMode = (mode: DriveMode) => {
    state.driveMode = mode;
    state.controlMode = "Manual";
  };

  const setControlMode = (mode: ControlMode) => {
    state.controlMode = mode;
  };

  const setRegenIntensity = (intensity: number) => {
    if (!Number.isFinite(intensity)) {
      return;
    }
    state.regenIntensity = clamp(intensity, 1, 3);
    state.regenMode = "Manual";
  };

  return { state, update, resetTripData, setDriveMode, setControlMode, setRegenIntensity };
};
