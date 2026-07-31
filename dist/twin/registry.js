"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTwinRegistry = void 0;
const shadow_1 = require("./shadow");
const sim_state_1 = require("../sim-state");
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
/**
 * REGISTRO DEL GEMELLO DIGITALE.
 *
 * Unico proprietario dello stato digitale. Fonde le misure dei dispositivi fisici
 * con un modello di fallback e presenta alle Thing WoT una vista sempre completa.
 * Le Thing non sanno se un valore arriva da un sensore o dal modello: lo leggono
 * da qui, insieme al metadato che dice quale delle due cose e'.
 */
const createTwinRegistry = (options = {}) => {
    const staleAfterMs = options.staleAfterMs ?? 5000;
    const now = options.now ?? (() => Date.now());
    // Modello di fallback: la stessa fisica del banco prova, ma girata dal lato digitale.
    const model = (0, sim_state_1.createSimulation)();
    const shadowOptions = (deviceId) => ({ deviceId, ttlMs: staleAfterMs, now });
    const powerUnitShadow = new shadow_1.DeviceShadow(shadowOptions("powerunit"), {
        engineRPM: model.state.engineRPM,
        torqueNm: model.state.torqueNm,
        temperatureC: model.state.temperatureC,
        speedKmh: model.state.speedKmh,
        engineStatus: model.state.engineStatus,
        distanceKm: model.state.distanceKm,
        energyUsedKwh: model.state.energyUsedKwh
    });
    const batteryShadow = new shadow_1.DeviceShadow(shadowOptions("battery"), {
        batterySoC: model.state.batterySoC,
        batterySoH: model.state.batterySoH,
        voltageV: model.state.voltageV,
        currentA: model.state.currentA,
        temperatureC: model.state.temperatureC
    });
    const actuatorShadow = new shadow_1.DeviceShadow(shadowOptions("actuator"), {
        driveMode: model.state.driveMode,
        regenIntensity: model.state.regenIntensity
    });
    const shadows = {
        powerunit: powerUnitShadow,
        battery: batteryShadow,
        actuator: actuatorShadow
    };
    // Stato di supervisione: vive solo nel gemello, nessun dispositivo lo pubblica.
    let controlMode = "Manual";
    let regenMode = "Manual";
    let anomalyStreak = 0;
    let lastEfficiency = 0;
    let tick = 0;
    const linkListeners = [];
    const lastLinkState = new Map();
    // I cambi di link vengono accumulati e consegnati una volta per tick: emettere
    // due volte lo stesso evento WoT nello stesso giro chiude due volte la stessa
    // risposta long-poll del binding HTTP.
    let pendingLinkChanges = [];
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
    const snapshot = () => {
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
    const evaluateEvents = (view) => {
        tick += 1;
        const efficiencyDrop = lastEfficiency - view.systemEfficiency;
        const lowEfficiency = view.systemEfficiency < 1.2;
        const suddenDrop = efficiencyDrop > 1.2 && view.torqueNm > 280;
        if (tick < 8) {
            anomalyStreak = 0;
        }
        else if (lowEfficiency || suddenDrop) {
            anomalyStreak += 1;
        }
        else {
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
            const change = {
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
        ingestTelemetry(telemetry) {
            const shadow = shadows[telemetry.deviceId];
            if (!shadow) {
                return false;
            }
            const accepted = shadow.ingest(telemetry.readings, telemetry.timestamp, telemetry.seq);
            if (accepted) {
                detectLinkChanges();
            }
            return accepted;
        },
        /** Un passo del gemello: riallinea, avanza il modello, ricalcola la vista. */
        update() {
            realignModel();
            model.update();
            refreshModelShadows();
            detectLinkChanges();
            const view = snapshot();
            return { view, events: evaluateEvents(view) };
        },
        snapshot,
        status() {
            const devices = [powerUnitShadow.status(), batteryShadow.status(), actuatorShadow.status()];
            const physicalDevices = devices.filter((device) => device.live).length;
            return {
                devices,
                physicalDevices,
                modelDevices: devices.length - physicalDevices,
                degraded: physicalDevices < devices.length
            };
        },
        deviceStatus(deviceId) {
            return shadows[deviceId].status();
        },
        onLinkChange(listener) {
            linkListeners.push(listener);
        },
        /**
         * Preleva e azzera i cambi di sorgente accumulati. Chi pubblica l'evento WoT
         * lo fa una volta sola per tick, con l'elenco completo.
         */
        drainLinkChanges() {
            const drained = pendingLinkChanges;
            pendingLinkChanges = [];
            return drained;
        },
        /**
         * Instrada un comando. Se l'attuatore fisico e' collegato il comando esce sul bus
         * ed e' il dispositivo a decidere; il modello viene comunque aggiornato in modo
         * ottimistico per non perdere continuita' se il link cade subito dopo.
         */
        setDriveMode(mode, origin = "manual") {
            model.setDriveMode(mode, origin);
            if (origin === "manual") {
                controlMode = "Manual";
            }
            const actuatorLive = actuatorShadow.isLive();
            if (actuatorLive && options.sendCommand) {
                options.sendCommand("actuator", { command: "setDriveMode", value: mode, issuedAt: new Date().toISOString() });
            }
            else {
                actuatorShadow.updateModel({ driveMode: mode, regenIntensity: model.state.regenIntensity });
            }
            return { applied: mode, target: actuatorLive ? "physical" : "model" };
        },
        setRegenIntensity(intensity, origin = "manual") {
            model.setRegenIntensity(intensity, origin);
            regenMode = origin === "manual" ? "Manual" : "Auto";
            const actuatorLive = actuatorShadow.isLive();
            if (actuatorLive && options.sendCommand) {
                options.sendCommand("actuator", { command: "triggerRegen", value: model.state.regenIntensity, issuedAt: new Date().toISOString() });
            }
            else {
                actuatorShadow.updateModel({ driveMode: model.state.driveMode, regenIntensity: model.state.regenIntensity });
            }
            return { applied: model.state.regenIntensity, target: actuatorLive ? "physical" : "model" };
        },
        setControlMode(mode) {
            controlMode = mode;
            model.setControlMode(mode);
            return controlMode;
        },
        getControlMode: () => controlMode
    };
};
exports.createTwinRegistry = createTwinRegistry;
