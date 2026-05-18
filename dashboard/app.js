const params = new URLSearchParams(window.location.search);
const apiPort = params.get("apiPort") ?? "8080";
const apiHost = params.get("apiHost") ?? window.location.hostname;
const apiProtocol = params.get("apiProtocol") ?? window.location.protocol;
const BASE_URL = `${apiProtocol}//${apiHost}:${apiPort}`;
const POWER_UNIT = `${BASE_URL}/powerunit`;
const ENERGY_STORAGE = `${BASE_URL}/energystorage`;
const CONTROL_ACTUATOR = `${BASE_URL}/controlactuator`;

const els = {
  connectionStatus: document.getElementById("connectionStatus"),
  batterySoC: document.getElementById("batterySoC"),
  batteryCard: document.getElementById("batteryCard"),
  rangeHint: document.getElementById("rangeHint"),
  engineStatus: document.getElementById("engineStatus"),
  engineRPM: document.getElementById("engineRPM"),
  thermalHealth: document.getElementById("thermalHealth"),
  temperatureC: document.getElementById("temperatureC"),
  systemEfficiency: document.getElementById("systemEfficiency"),
  torqueNm: document.getElementById("torqueNm"),
  alertsList: document.getElementById("alertsList"),
  controlModeLabel: document.getElementById("controlModeLabel")
};

let pendingDriveMode = null;
let pendingRegen = null;
let pendingDriveUntil = 0;
let pendingRegenUntil = 0;

const socCtx = document.getElementById("socChart");
const effCtx = document.getElementById("effChart");

const makeGradient = (ctx, top, bottom) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  return gradient;
};

const socGradient = makeGradient(socCtx.getContext("2d"), "rgba(31, 122, 224, 0.35)", "rgba(31, 122, 224, 0.02)");
const effGradient = makeGradient(effCtx.getContext("2d"), "rgba(20, 182, 177, 0.35)", "rgba(20, 182, 177, 0.02)");

const formatTickTime = (label) => {
  if (typeof label !== "string") {
    return String(label ?? "");
  }
  const parts = label.split(":");
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return label;
};

const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "rgba(11, 18, 32, 0.92)",
      borderColor: "rgba(31, 122, 224, 0.4)",
      borderWidth: 1,
      titleColor: "#f8fafc",
      bodyColor: "#e2e8f0",
      padding: 10,
      displayColors: false,
      cornerRadius: 10
    }
  },
  layout: { padding: { top: 6, right: 12, bottom: 6, left: 6 } },
  scales: {
    x: {
      grid: { color: "rgba(15, 23, 42, 0.06)", drawTicks: false },
      ticks: {
        color: "#5c6572",
        maxRotation: 30,
        minRotation: 30,
        autoSkip: true,
        maxTicksLimit: 5,
        padding: 6,
        font: { size: 11 },
        callback: function (value, index) {
          if (index % 2 !== 0) {
            return "";
          }
          return formatTickTime(this.getLabelForValue(value));
        }
      },
      border: { color: "rgba(15, 23, 42, 0.08)" }
    },
    y: {
      grid: { color: "rgba(15, 23, 42, 0.06)", drawTicks: false },
      ticks: { color: "#5c6572", font: { size: 11 } },
      border: { color: "rgba(15, 23, 42, 0.08)" }
    }
  },
  elements: {
    point: { radius: 0, hoverRadius: 4, hitRadius: 10 },
    line: { borderWidth: 2.5, tension: 0.35, borderCapStyle: "round", borderJoinStyle: "round" }
  }
};

const socChart = new Chart(socCtx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "SoC %",
      data: [],
      borderColor: "#1f7ae0",
      backgroundColor: socGradient,
      fill: true
    }]
  },
  options: {
    ...baseChartOptions,
    scales: {
      ...baseChartOptions.scales,
      y: {
        ...baseChartOptions.scales.y,
        min: 0,
        max: 100
      }
    }
  }
});

const effChart = new Chart(effCtx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Efficiency",
      data: [],
      borderColor: "#14b6b1",
      backgroundColor: effGradient,
      fill: true
    }]
  },
  options: baseChartOptions
});

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const readProperty = (thing, property) =>
  fetchJson(`${thing}/properties/${property}`);

const invokeAction = async (thing, action, value) => {
  const response = await fetch(`${thing}/actions/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
};

const setStatus = (label, ok = true) => {
  els.connectionStatus.textContent = label;
  els.connectionStatus.style.background = ok ? "#1d8f4d" : "#8b2f2f";
};

const setActive = (containerId, predicate) => {
  document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
    const isActive = predicate(btn);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
};

const setButtonsDisabled = (containerId, disabled) => {
  document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
    btn.disabled = disabled;
  });
};

const updateDashboard = async () => {
  try {
    const [batterySoC, engineStatus, engineRPM, thermalHealth, temperatureC, systemEfficiency, torqueNm, estimatedRangeKm, driveMode, controlMode, regenIntensity, regenMode] =
      await Promise.all([
        readProperty(POWER_UNIT, "batterySoC"),
        readProperty(POWER_UNIT, "engineStatus"),
        readProperty(POWER_UNIT, "engineRPM"),
        readProperty(POWER_UNIT, "thermalHealth"),
        readProperty(POWER_UNIT, "temperatureC"),
        readProperty(POWER_UNIT, "systemEfficiency"),
        readProperty(POWER_UNIT, "torqueNm"),
        readProperty(POWER_UNIT, "estimatedRangeKm"),
        readProperty(CONTROL_ACTUATOR, "driveMode"),
        readProperty(CONTROL_ACTUATOR, "controlMode"),
        readProperty(CONTROL_ACTUATOR, "regenIntensity"),
        readProperty(CONTROL_ACTUATOR, "regenMode")
      ]);

    setStatus("Online", true);

    els.batterySoC.textContent = `${batterySoC.toFixed(1)}%`;
    els.rangeHint.textContent = `${estimatedRangeKm.toFixed(1)} km autonomia stimata`;
        if (els.batteryCard) {
          els.batteryCard.classList.remove("battery-high", "battery-mid", "battery-low");
          if (batterySoC <= 20) {
            els.batteryCard.classList.add("battery-low");
          } else if (batterySoC <= 45) {
            els.batteryCard.classList.add("battery-mid");
          } else {
            els.batteryCard.classList.add("battery-high");
          }
        }
    els.engineStatus.textContent = engineStatus;
    els.engineRPM.textContent = `${engineRPM.toFixed(0)} rpm`;
    els.thermalHealth.textContent = `${thermalHealth.toFixed(0)}%`;
    els.temperatureC.textContent = temperatureC.toFixed(1);
    els.systemEfficiency.textContent = `${systemEfficiency.toFixed(2)} km/kWh`;
    els.torqueNm.textContent = torqueNm.toFixed(0);

    const timestamp = new Date().toLocaleTimeString();
    socChart.data.labels.push(timestamp);
    socChart.data.datasets[0].data.push(batterySoC);
    effChart.data.labels.push(timestamp);
    effChart.data.datasets[0].data.push(systemEfficiency);

    if (socChart.data.labels.length > 15) {
      socChart.data.labels.shift();
      socChart.data.datasets[0].data.shift();
      effChart.data.labels.shift();
      effChart.data.datasets[0].data.shift();
    }

    socChart.update();
    effChart.update();

    const now = Date.now();
    const backendRegen = String(Math.round(regenIntensity));

    const effectiveDrive = pendingDriveMode && now < pendingDriveUntil ? pendingDriveMode : driveMode;
    const effectiveRegen = pendingRegen !== null && now < pendingRegenUntil ? String(pendingRegen) : backendRegen;

    setActive("driveModeButtons", (btn) => btn.dataset.mode === effectiveDrive);
    setActive("regenButtons", (btn) => btn.dataset.regen === effectiveRegen);
    els.controlModeLabel.textContent = controlMode;

    renderAlerts({ batterySoC, temperatureC, systemEfficiency });
  } catch (error) {
    setStatus("Offline", false);
  }
};

const refreshSoon = () => {
  setTimeout(updateDashboard, 400);
};

const loadHistory = async () => {
  try {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const samples = await response.json();
    socChart.data.labels = samples.map((s) => new Date(s.timestamp).toLocaleTimeString());
    socChart.data.datasets[0].data = samples.map((s) => s.batterySoC);
    effChart.data.labels = samples.map((s) => new Date(s.timestamp).toLocaleTimeString());
    effChart.data.datasets[0].data = samples.map((s) => s.systemEfficiency);
    socChart.update();
    effChart.update();
  } catch {
    // ignore history errors
  }
};

const renderAlerts = ({ batterySoC, temperatureC, systemEfficiency }) => {
  const alerts = [];
  if (temperatureC > 90) {
    alerts.push("Surriscaldamento critico rilevato");
  }
  if (batterySoC < 12) {
    alerts.push("Avviso batteria bassa");
  }
  if (systemEfficiency < 2) {
    alerts.push("Anomalia efficienza rilevata");
  }

  els.alertsList.innerHTML = "";
  if (alerts.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Nessun allarme.";
    els.alertsList.appendChild(li);
    return;
  }

  alerts.forEach((message) => {
    const li = document.createElement("li");
    li.textContent = message;
    els.alertsList.appendChild(li);
  });
};

const wireControls = () => {
  document.querySelectorAll("#driveModeButtons button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) {
        return;
      }
      setButtonsDisabled("driveModeButtons", true);
      pendingDriveMode = btn.dataset.mode;
      pendingDriveUntil = Date.now() + 6000;
      setActive("driveModeButtons", (button) => button === btn);
      try {
        await invokeAction(CONTROL_ACTUATOR, "setDriveMode", btn.dataset.mode);
        setStatus("Online", true);
        pendingDriveMode = null;
        refreshSoon();
      } catch (error) {
        console.warn("Drive mode update failed", error);
        setStatus("Errore comandi", false);
        pendingDriveMode = null;
      } finally {
        setButtonsDisabled("driveModeButtons", false);
      }
    });
  });

  document.querySelectorAll("#regenButtons button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) {
        return;
      }
      setButtonsDisabled("regenButtons", true);
      pendingRegen = btn.dataset.regen;
      pendingRegenUntil = Date.now() + 6000;
      setActive("regenButtons", (button) => button === btn);
      try {
        await invokeAction(CONTROL_ACTUATOR, "triggerRegen", Number(btn.dataset.regen));
        setStatus("Online", true);
        pendingRegen = null;
        refreshSoon();
      } catch (error) {
        console.warn("Regen update failed", error);
        setStatus("Errore comandi", false);
        pendingRegen = null;
      } finally {
        setButtonsDisabled("regenButtons", false);
      }
    });
  });

};

wireControls();
loadHistory();
updateDashboard();
setInterval(updateDashboard, 2000);
