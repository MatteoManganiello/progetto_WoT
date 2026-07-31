import { DeviceShadow, ShadowStatus, ValueSource } from "./shadow";
import {
  ActuatorReadings,
  BatteryReadings,
  DeviceId,
  DeviceTelemetry,
  PowerUnitReadings
} from "../physical/protocol";
import {
  ControlMode,
  DriveMode,
  EngineStatus,
  RegenMode,
  Simulation,
  createSimulation
} from "../sim-state";

export type TwinSnapshot = {
  // Grandezze del gruppo propulsore (dispositivo `powerunit`).
  engineRPM: number;
  torqueNm: number;
  temperatureC: number;
  speedKmh: number;
  engineStatus: EngineStatus;
  distanceKm: number;
  energyUsedKwh: number;
  // Grandezze del pacco batteria (dispositivo `battery`).
  batterySoC: number;
  batterySoH: number;
  voltageV: number;
  currentA: number;
  batteryTemperatureC: number;
  // Stato dell'attuatore (dispositivo `actuator`).
  driveMode: DriveMode;
  regenIntensity: number;
  // Stato di supervisione: esiste solo nel gemello, nessun sensore lo misura.
  controlMode: ControlMode;
  regenMode: RegenMode;
  // Indicatori calcolati dal gemello a partire dalle misure.
  systemEfficiency: number;
  thermalHealth: number;
  estimatedRangeKm: number;
};

export type TwinEvents = {
  criticalOverheat: boolean;
  lowEnergyWarning: boolean;
  anomalyDetected: boolean;
};

export type LinkChange = {
  deviceId: DeviceId;
  live: boolean;
  source: ValueSource;
  at: string;
};

export type TwinStatus = {
  devices: ShadowStatus[];
  physicalDevices: number;
  modelDevices: number;
  degraded: boolean;
};

type RegistryOptions = {
  /** Oltre questa eta' una misura fisica scade e subentra il modello. */
  staleAfterMs?: number;
  /** Invio del comando alla parte fisica; assente in test o senza broker. */
  sendCommand?: (deviceId: DeviceId, command: { command: "setDriveMode"; value: DriveMode; issuedAt: string } | { command: "triggerRegen"; value: number; issuedAt: string }) => void;
  now?: () => number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * REGISTRO DEL GEMELLO DIGITALE.
 *
 * Unico proprietario dello stato digitale. Fonde le misure dei dispositivi fisici
 * con un modello di fallback e presenta alle Thing WoT una vista sempre completa.
 * Le Thing non sanno se un valore arriva da un sensore o dal modello: lo leggono
 * da qui, insieme al metadato che dice quale delle due cose e'.
 */
export const createTwinRegistry = (options: RegistryOptions = {}) => {
  const staleAfterMs = options.staleAfterMs ?? 5000;
  const now = options.now ?? (() => Date.now());

  // Modello di fallback: la stessa fisica del banco prova, ma girata dal lato digitale.
  const model: Simulation = createSimulation();

  const shadowOptions = (deviceId: DeviceId) => ({ deviceId, ttlMs: staleAfterMs, now });

  const powerUnitShadow = new DeviceShadow<PowerUnitReadings>(shadowOptions("powerunit"), {
    engineRPM: model.state.engineRPM,
    torqueNm: model.state.torqueNm,
    temperatureC: model.state.temperatureC,
    speedKmh: model.state.speedKmh,
    engineStatus: model.state.engineStatus,
    distanceKm: model.state.distanceKm,
    energyUsedKwh: model.state.energyUsedKwh
  });

  const batteryShadow = new DeviceShadow<BatteryReadings>(shadowOptions("battery"), {
    batterySoC: model.state.batterySoC,
    batterySoH: model.state.batterySoH,
    voltageV: model.state.voltageV,
    currentA: model.state.currentA,
    temperatureC: model.state.temperatureC
  });

  const actuatorShadow = new DeviceShadow<ActuatorReadings>(shadowOptions("actuator"), {
    driveMode: model.state.driveMode,
    regenIntensity: model.state.regenIntensity
  });

  const shadows: Record<DeviceId, DeviceShadow<never>> = {
    powerunit: powerUnitShadow as unknown as DeviceShadow<never>,
    battery: batteryShadow as unknown as DeviceShadow<never>,
    actuator: actuatorShadow as unknown as DeviceShadow<never>
  };

  // Stato di supervisione: vive solo nel gemello, nessun dispositivo lo pubblica.
  let controlMode: ControlMode = "Manual";
  let regenMode: RegenMode = "Manual";

  let anomalyStreak = 0;
  let lastEfficiency = 0;
  let tick = 0;

  const linkListeners: Array<(change: LinkChange) => void> = [];
  const lastLinkState = new Map<DeviceId, boolean>();
  // I cambi di link vengono accumulati e consegnati una volta per tick: emettere
  // due volte lo stesso evento WoT nello stesso giro chiude due volte la stessa
  // risposta long-poll del binding HTTP.
  let pendingLinkChanges: LinkChange[] = [];

  /**
   * Finche' un dispositivo e' vivo il modello lo insegue. Cosi', quando il
   * dispositivo si spegne, la simulazione riparte dall'ultimo valore reale
   * invece che da uno stato ormai divergente.
   */
  const realignModel = () => {
    if (powerUnitShadow.isLive()) {
      const readings = powerUnitShadow.values();
      model.applyExternal({
        engineRPM: readings.engineRPM,
        torqueNm: readings.torqueNm,
        temperatureC: readings.temperatureC,
        speedKmh: readings.speedKmh,
        engineStatus: readings.engineStatus,
        distanceKm: readings.distanceKm,
        energyUsedKwh: readings.energyUsedKwh
      });
    }
    if (batteryShadow.isLive()) {
      const readings = batteryShadow.values();
      model.applyExternal({
        batterySoC: readings.batterySoC,
        batterySoH: readings.batterySoH,
        voltageV: readings.voltageV,
        currentA: readings.currentA
      });
    }
    if (actuatorShadow.isLive()) {
      const readings = actuatorShadow.values();
      model.applyExternal({
        driveMode: readings.driveMode,
        regenIntensity: readings.regenIntensity
      });
    }
  };

  const refreshModelShadows = () => {
    powerUnitShadow.updateModel({
      engineRPM: model.state.engineRPM,
      torqueNm: model.state.torqueNm,
      temperatureC: model.state.temperatureC,
      speedKmh: model.state.speedKmh,
      engineStatus: model.state.engineStatus,
      distanceKm: model.state.distanceKm,
      energyUsedKwh: model.state.energyUsedKwh
    });
    batteryShadow.updateModel({
      batterySoC: model.state.batterySoC,
      batterySoH: model.state.batterySoH,
      voltageV: model.state.voltageV,
      currentA: model.state.currentA,
      temperatureC: model.state.temperatureC
    });
    actuatorShadow.updateModel({
      driveMode: model.state.driveMode,
      regenIntensity: model.state.regenIntensity
    });
  };

  const snapshot = (): TwinSnapshot => {
    const powerUnit = powerUnitShadow.values();
    const battery = batteryShadow.values();
    const actuator = actuatorShadow.values();

    // Indicatori derivati: sono il valore aggiunto del gemello, non misure.
    const systemEfficiency = powerUnit.distanceKm / Math.max(powerUnit.energyUsedKwh, 0.1);
    const thermalHealth = clamp(100 - Math.max(0, powerUnit.temperatureC - 70) * 1.8, 0, 100);
    const estimatedRangeKm = clamp(battery.batterySoC * 0.85, 0, 130);

    return {
      engineRPM: powerUnit.engineRPM,
      torqueNm: powerUnit.torqueNm,
      temperatureC: powerUnit.temperatureC,
      speedKmh: powerUnit.speedKmh,
      engineStatus: powerUnit.engineStatus,
      distanceKm: powerUnit.distanceKm,
      energyUsedKwh: powerUnit.energyUsedKwh,
      batterySoC: battery.batterySoC,
      batterySoH: battery.batterySoH,
      voltageV: battery.voltageV,
      currentA: battery.currentA,
      batteryTemperatureC: battery.temperatureC,
      driveMode: actuator.driveMode,
      regenIntensity: actuator.regenIntensity,
      controlMode,
      regenMode,
      systemEfficiency,
      thermalHealth,
      estimatedRangeKm
    };
  };

  /**
   * Gli eventi sono valutati sulla vista fusa, non sul modello: scattano allo
   * stesso modo che il dato provenga da un sensore reale o dalla simulazione.
   */
  const evaluateEvents = (view: TwinSnapshot): TwinEvents => {
    tick += 1;

    const efficiencyDrop = lastEfficiency - view.systemEfficiency;
    const lowEfficiency = view.systemEfficiency < 1.2;
    const suddenDrop = efficiencyDrop > 1.2 && view.torqueNm > 280;

    if (tick < 8) {
      anomalyStreak = 0;
    } else if (lowEfficiency || suddenDrop) {
      anomalyStreak += 1;
    } else {
      anomalyStreak = 0;
    }
    lastEfficiency = view.systemEfficiency;

    return {
      criticalOverheat: view.temperatureC > 90,
      lowEnergyWarning: view.estimatedRangeKm < 10,
      anomalyDetected: anomalyStreak >= 3
    };
  };

  const detectLinkChanges = () => {
    for (const shadow of [powerUnitShadow, batteryShadow, actuatorShadow]) {
      const live = shadow.isLive();
      const previous = lastLinkState.get(shadow.deviceId);
      if (previous === live) {
        continue;
      }
      lastLinkState.set(shadow.deviceId, live);
      if (previous === undefined && !live) {
        // Stato iniziale senza parte fisica: non e' una transizione da segnalare.
        continue;
      }
      const change: LinkChange = {
        deviceId: shadow.deviceId,
        live,
        source: live ? "physical" : "model",
        at: new Date().toISOString()
      };
      pendingLinkChanges.push(change);
      linkListeners.forEach((listener) => listener(change));
    }
  };

  return {
    /** Ingresso della telemetria dalla parte fisica. */
    ingestTelemetry(telemetry: DeviceTelemetry): boolean {
      const shadow = shadows[telemetry.deviceId];
      if (!shadow) {
        return false;
      }
      const accepted = (shadow as unknown as DeviceShadow<Record<string, unknown>>).ingest(
        telemetry.readings as Record<string, unknown>,
        telemetry.timestamp,
        telemetry.seq
      );
      if (accepted) {
        detectLinkChanges();
      }
      return accepted;
    },

    /** Un passo del gemello: riallinea, avanza il modello, ricalcola la vista. */
    update(): { view: TwinSnapshot; events: TwinEvents } {
      realignModel();
      model.update();
      refreshModelShadows();
      detectLinkChanges();

      const view = snapshot();
      return { view, events: evaluateEvents(view) };
    },

    snapshot,

    status(): TwinStatus {
      const devices = [powerUnitShadow.status(), batteryShadow.status(), actuatorShadow.status()];
      const physicalDevices = devices.filter((device) => device.live).length;
      return {
        devices,
        physicalDevices,
        modelDevices: devices.length - physicalDevices,
        degraded: physicalDevices < devices.length
      };
    },

    deviceStatus(deviceId: DeviceId): ShadowStatus {
      return (shadows[deviceId] as unknown as DeviceShadow<Record<string, unknown>>).status();
    },

    onLinkChange(listener: (change: LinkChange) => void) {
      linkListeners.push(listener);
    },

    /**
     * Preleva e azzera i cambi di sorgente accumulati. Chi pubblica l'evento WoT
     * lo fa una volta sola per tick, con l'elenco completo.
     */
    drainLinkChanges(): LinkChange[] {
      const drained = pendingLinkChanges;
      pendingLinkChanges = [];
      return drained;
    },

    /**
     * Instrada un comando. Se l'attuatore fisico e' collegato il comando esce sul bus
     * ed e' il dispositivo a decidere; il modello viene comunque aggiornato in modo
     * ottimistico per non perdere continuita' se il link cade subito dopo.
     */
    setDriveMode(mode: DriveMode, origin: "manual" | "auto" = "manual"): { applied: DriveMode; target: ValueSource } {
      model.setDriveMode(mode, origin);
      if (origin === "manual") {
        controlMode = "Manual";
      }
      const actuatorLive = actuatorShadow.isLive();
      if (actuatorLive && options.sendCommand) {
        options.sendCommand("actuator", { command: "setDriveMode", value: mode, issuedAt: new Date().toISOString() });
      } else {
        actuatorShadow.updateModel({ driveMode: mode, regenIntensity: model.state.regenIntensity });
      }
      return { applied: mode, target: actuatorLive ? "physical" : "model" };
    },

    setRegenIntensity(intensity: number, origin: "manual" | "auto" = "manual"): { applied: number; target: ValueSource } {
      model.setRegenIntensity(intensity, origin);
      regenMode = origin === "manual" ? "Manual" : "Auto";
      const actuatorLive = actuatorShadow.isLive();
      if (actuatorLive && options.sendCommand) {
        options.sendCommand("actuator", { command: "triggerRegen", value: model.state.regenIntensity, issuedAt: new Date().toISOString() });
      } else {
        actuatorShadow.updateModel({ driveMode: model.state.driveMode, regenIntensity: model.state.regenIntensity });
      }
      return { applied: model.state.regenIntensity, target: actuatorLive ? "physical" : "model" };
    },

    setControlMode(mode: ControlMode) {
      controlMode = mode;
      model.setControlMode(mode);
      return controlMode;
    },

    getControlMode: () => controlMode
  };
};

export type TwinRegistry = ReturnType<typeof createTwinRegistry>;
