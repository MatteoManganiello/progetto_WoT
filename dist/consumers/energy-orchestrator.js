"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEnergyOrchestrator = void 0;
const fetchJson = async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
};
const postJson = async (url, payload) => {
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
const computeDriveMode = (snapshot) => {
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
const startEnergyOrchestrator = (config) => {
    const intervalMs = config.intervalMs ?? 4000;
    const controlActuator = `${config.baseUrl}/controlactuator`;
    const powerUnit = `${config.baseUrl}/powerunit`;
    let timer;
    const tick = async () => {
        try {
            const [batterySoC, speedKmh, controlMode, driveMode] = await Promise.all([
                fetchJson(`${powerUnit}/properties/batterySoC`),
                fetchJson(`${powerUnit}/properties/speedKmh`),
                fetchJson(`${controlActuator}/properties/controlMode`),
                fetchJson(`${controlActuator}/properties/driveMode`)
            ]);
            const snapshot = {
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
        }
        catch (error) {
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
exports.startEnergyOrchestrator = startEnergyOrchestrator;
