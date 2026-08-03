"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSimulation = exports.STEP_SECONDS = exports.DRIVE_MODES = void 0;
exports.DRIVE_MODES = ["Full Electric", "Hybrid", "Sport", "Save"];
/** Passo del modello a tempo discreto. */
exports.STEP_SECONDS = 2;
/** Energia equivalente associata a un punto percentuale di stato di carica. */
const ENERGY_PER_SOC_KWH = 0.0096;
/** Contributo del motore termico all'energia consumata, per ciclo. */
const ICE_ENERGY_PER_STEP = 0.0011;
/**
 * Coefficiente della media mobile esponenziale sull'efficienza istantanea.
 * Valori bassi filtrano di piu' e rendono trascurabile il transitorio d'avvio.
 */
const EFFICIENCY_EMA_ALPHA = 0.12;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const createSimulation = () => {
    const stressMode = (process.env.STRESS_MODE ?? "false").toLowerCase() === "true";
    const stressFactor = stressMode ? 2 : 1;
    const state = {
        batterySoC: 78,
        batterySoH: 96,
        engineRPM: 1100,
        torqueNm: 120,
        temperatureC: 62,
        thermalHealth: 92,
        systemEfficiency: 5.2,
        engineStatus: "Idle",
        driveMode: "Hybrid",
        regenIntensity: 0,
        speedKmh: 38,
        distanceKm: 0,
        energyUsedKwh: 0.2,
        estimatedRangeKm: 60,
        voltageV: 360,
        currentA: 40
    };
    let tick = 0;
    let lastSpeed = state.speedKmh;
    let lastEfficiency = state.systemEfficiency;
    let anomalyStreak = 0;
    const ambientTemp = 32;
    const update = () => {
        tick += 1;
        const dtSeconds = exports.STEP_SECONDS;
        // Cinematica: andamento sinusoidale modulato dalla modalita' di guida.
        const baseSpeed = 42 + 12 * Math.sin(tick / 12);
        const modeOffset = state.driveMode === "Sport" ? 25 : state.driveMode === "Full Electric" ? -5 : 0;
        state.speedKmh = clamp(baseSpeed + modeOffset, 10, 130);
        const accel = (state.speedKmh - lastSpeed) / dtSeconds;
        const regenActive = accel < -0.2;
        // Coppia e regime: funzione della domanda di velocita' e della modalita'.
        const demandFactor = 1 + state.speedKmh / 180;
        const driveFactor = state.driveMode === "Sport" ? 1.35 : state.driveMode === "Save" ? 0.62 : 1;
        const torque = 110 * demandFactor * driveFactor;
        state.torqueNm = clamp(torque, 80, 360);
        if (state.driveMode === "Full Electric" && state.batterySoC > 18) {
            state.engineStatus = "Off";
        }
        else if (state.driveMode === "Hybrid" && state.speedKmh < 35 && state.batterySoC > 28) {
            state.engineStatus = "Idle";
        }
        else {
            state.engineStatus = "Running";
        }
        state.engineRPM = state.engineStatus === "Off"
            ? 0
            : clamp(900 + state.speedKmh * 22 + (state.driveMode === "Sport" ? 400 : 0), 800, 6200);
        // Bilancio energetico: consumo per modalita' e domanda, recupero in frenata.
        const drainBase = state.driveMode === "Full Electric" ? 0.45 : state.driveMode === "Hybrid" ? 0.32 : state.driveMode === "Save" ? 0.24 : 0.58;
        const socGuard = state.batterySoC < 20 ? 0.7 : 1;
        const drain = drainBase * demandFactor * socGuard * driveFactor * stressFactor;
        const regenBoost = state.regenIntensity > 0 && regenActive ? state.regenIntensity * 0.45 : 0;
        state.batterySoC = clamp(state.batterySoC - drain + regenBoost, 0, 100);
        // Modello termico: riscaldamento per carico, velocita' e modalita' Sport;
        // raffreddamento per flusso d'aria e rigenerazione.
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
        state.temperatureC = clamp(state.temperatureC + engineHeat * stressFactor - regenCooling - effectiveCooling, ambientTemp, 120);
        state.thermalHealth = clamp(100 - Math.max(0, state.temperatureC - 70) * 1.8, 0, 100);
        // L'usura del pacco batteria segue lo stato termico.
        const batteryWear = state.temperatureC > 90 ? 0.01 : 0.001;
        state.batterySoH = clamp(state.batterySoH - batteryWear, 70, 100);
        const distanceDelta = state.speedKmh * (dtSeconds / 3600);
        state.distanceKm += distanceDelta;
        const energyDelta = Math.max(0, drain - regenBoost) * ENERGY_PER_SOC_KWH
            + (state.engineStatus === "Running" ? ICE_ENERGY_PER_STEP : 0);
        state.energyUsedKwh += energyDelta;
        /*
         * Efficienza di sistema: si misura l'efficienza istantanea del ciclo e la si
         * filtra con una media mobile esponenziale. Il rapporto cumulato reagirebbe
         * troppo lentamente a un cambio di modalita'; il valore istantaneo, da solo,
         * oscillerebbe a ogni ciclo e produrrebbe un transitorio all'avvio.
         */
        const instantEfficiency = distanceDelta / Math.max(energyDelta, 1e-4);
        state.systemEfficiency =
            EFFICIENCY_EMA_ALPHA * instantEfficiency + (1 - EFFICIENCY_EMA_ALPHA) * state.systemEfficiency;
        state.estimatedRangeKm = clamp(state.batterySoC * 0.85, 0, 130);
        state.voltageV = 320 + state.batterySoC * 0.8;
        state.currentA = regenActive && state.regenIntensity > 0 ? -30 * state.regenIntensity : 80 * driveFactor;
        // Anomalia: efficienza troppo bassa, oppure crollo improvviso sotto carico.
        const efficiencyDrop = lastEfficiency - state.systemEfficiency;
        const lowEfficiency = state.systemEfficiency < 1.2;
        const suddenDrop = efficiencyDrop > 1.2 && state.torqueNm > 280;
        if (tick < 8) {
            anomalyStreak = 0;
        }
        else if (lowEfficiency || suddenDrop) {
            anomalyStreak += 1;
        }
        else {
            anomalyStreak = 0;
        }
        const anomalyDetected = anomalyStreak >= 3;
        lastEfficiency = state.systemEfficiency;
        lastSpeed = state.speedKmh;
        return {
            criticalOverheat: state.temperatureC > 90,
            lowEnergyWarning: state.estimatedRangeKm < 10,
            anomalyDetected
        };
    };
    const setDriveMode = (mode) => {
        state.driveMode = mode;
    };
    const setRegenIntensity = (intensity) => {
        if (!Number.isFinite(intensity)) {
            return;
        }
        state.regenIntensity = clamp(intensity, 1, 3);
    };
    return { state, update, setDriveMode, setRegenIntensity };
};
exports.createSimulation = createSimulation;
