/**
 * Predictive Dashboard: consumer WoT lato browser.
 *
 * Non contiene URL di proprieta' o di azioni. Scarica le Thing Description di
 * PowerUnit e ControlActuator e ricava da esse le `forms` di ogni interazione.
 * Cambiare il binding lato server non richiede modifiche qui.
 */

const params = new URLSearchParams(window.location.search);
const apiPort = params.get("apiPort") ?? "8080";
const apiHost = params.get("apiHost") ?? window.location.hostname;
const apiProtocol = params.get("apiProtocol") ?? window.location.protocol;
const BASE_URL = `${apiProtocol}//${apiHost}:${apiPort}`;

const TD_URLS = {
  powerUnit: `${BASE_URL}/powerunit`,
  controlActuator: `${BASE_URL}/controlactuator`
};

const els = {
  connectionStatus: document.getElementById("connectionStatus"),
  batterySoC: document.getElementById("batterySoC"),
  batteryCard: document.getElementById("batteryCard"),
  rangeHint: document.getElementById("rangeHint"),
  engineRPM: document.getElementById("engineRPM"),
  torqueNm: document.getElementById("torqueNm"),
  temperatureC: document.getElementById("temperatureC"),
  systemEfficiency: document.getElementById("systemEfficiency"),
  alertsList: document.getElementById("alertsList")
};

let pendingDriveMode = null;
let pendingRegen = null;
let pendingDriveUntil = 0;
let pendingRegenUntil = 0;

// ---------------------------------------------------------------------------
// Client WoT minimale guidato dalla Thing Description
// ---------------------------------------------------------------------------

const fetchJson = async (url, init) => {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const hasOp = (form, op, fallback) => {
  const ops = form.op ?? fallback;
  return Array.isArray(ops) ? ops.includes(op) : ops === op;
};

/**
 * node-wot genera le href con l'indirizzo con cui il server si e' annunciato,
 * che puo' non coincidere con quello da cui la pagina e' servita. Si conserva
 * il percorso dichiarato nella TD e si riallinea solo l'origine.
 */
const alignOrigin = (href) => {
  try {
    const url = new URL(href);
    return `${BASE_URL}${url.pathname}${url.search}`;
  } catch {
    return href;
  }
};

const pickForm = (forms, op, fallbackOp) => {
  const httpForms = (forms ?? []).filter((form) => typeof form.href === "string" && form.href.startsWith("http"));
  const match = httpForms.find((form) => hasOp(form, op, fallbackOp));
  return match ?? httpForms[0];
};

const consumeThing = async (tdUrl) => {
  const td = await fetchJson(tdUrl);

  const readProperty = async (name) => {
    const form = pickForm(td.properties?.[name]?.forms, "readproperty", ["readproperty", "writeproperty"]);
    if (!form) {
      throw new Error(`Nessuna form HTTP per la proprieta' '${name}'`);
    }
    return fetchJson(alignOrigin(form.href));
  };

  const invokeAction = async (name, value) => {
    const form = pickForm(td.actions?.[name]?.forms, "invokeaction", "invokeaction");
    if (!form) {
      throw new Error(`Nessuna form HTTP per l'azione '${name}'`);
    }
    return fetchJson(alignOrigin(form.href), {
      method: form["htv:methodName"] ?? "POST",
      headers: { "Content-Type": form.contentType ?? "application/json" },
      body: JSON.stringify(value)
    });
  };

  return { td, readProperty, invokeAction };
};

// ---------------------------------------------------------------------------
// Grafici
// ---------------------------------------------------------------------------

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
    datasets: [{ label: "SoC %", data: [], borderColor: "#1f7ae0", backgroundColor: socGradient, fill: true }]
  },
  options: {
    ...baseChartOptions,
    scales: { ...baseChartOptions.scales, y: { ...baseChartOptions.scales.y, min: 0, max: 100 } }
  }
});

const effChart = new Chart(effCtx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{ label: "Efficiency", data: [], borderColor: "#14b6b1", backgroundColor: effGradient, fill: true }]
  },
  options: baseChartOptions
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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

/** Le stesse soglie del Diagnostic Tool, applicate alle proprieta' lette. */
const renderAlerts = ({ temperatureC, estimatedRangeKm, systemEfficiency }) => {
  const alerts = [];
  if (temperatureC > 90) {
    alerts.push("Surriscaldamento critico rilevato");
  }
  if (estimatedRangeKm < 10) {
    alerts.push("Autonomia residua bassa");
  }
  if (systemEfficiency < 1.2) {
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

// ---------------------------------------------------------------------------
// Ciclo principale
// ---------------------------------------------------------------------------

let things = null;

const updateDashboard = async () => {
  if (!things) {
    return;
  }
  try {
    const [
      batterySoC, engineRPM, torqueNm, temperatureC, systemEfficiency, estimatedRangeKm,
      driveMode, regenIntensity
    ] = await Promise.all([
      things.powerUnit.readProperty("batterySoC"),
      things.powerUnit.readProperty("engineRPM"),
      things.powerUnit.readProperty("torqueNm"),
      things.powerUnit.readProperty("temperatureC"),
      things.powerUnit.readProperty("systemEfficiency"),
      things.powerUnit.readProperty("estimatedRangeKm"),
      things.controlActuator.readProperty("driveMode"),
      things.controlActuator.readProperty("regenIntensity")
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
    els.engineRPM.textContent = `${engineRPM.toFixed(0)} rpm`;
    els.torqueNm.textContent = torqueNm.toFixed(0);
    els.temperatureC.textContent = `${temperatureC.toFixed(1)} C`;
    els.systemEfficiency.textContent = `${systemEfficiency.toFixed(2)} km/kWh`;

    const timestamp = new Date().toLocaleTimeString();
    socChart.data.labels.push(timestamp);
    socChart.data.datasets[0].data.push(batterySoC);
    effChart.data.labels.push(timestamp);
    effChart.data.datasets[0].data.push(systemEfficiency);

    if (socChart.data.labels.length > 60) {
      socChart.data.labels.shift();
      socChart.data.datasets[0].data.shift();
      effChart.data.labels.shift();
      effChart.data.datasets[0].data.shift();
    }

    socChart.update();
    effChart.update();

    // Finestra di grazia: il comando appena inviato resta evidenziato finche'
    // il ciclo di simulazione non ha ancora propagato il nuovo stato.
    const now = Date.now();
    const backendRegen = String(Math.round(regenIntensity));
    const effectiveDrive = pendingDriveMode && now < pendingDriveUntil ? pendingDriveMode : driveMode;
    const effectiveRegen = pendingRegen !== null && now < pendingRegenUntil ? String(pendingRegen) : backendRegen;

    setActive("driveModeButtons", (btn) => btn.dataset.mode === effectiveDrive);
    setActive("regenButtons", (btn) => btn.dataset.regen === effectiveRegen);

    renderAlerts({ temperatureC, estimatedRangeKm, systemEfficiency });
  } catch (error) {
    setStatus("Offline", false);
  }
};

const refreshSoon = () => {
  setTimeout(updateDashboard, 400);
};

const loadHistory = async () => {
  try {
    const samples = await fetchJson("/api/history");
    socChart.data.labels = samples.map((s) => new Date(s.timestamp).toLocaleTimeString());
    socChart.data.datasets[0].data = samples.map((s) => s.batterySoC);
    effChart.data.labels = samples.map((s) => new Date(s.timestamp).toLocaleTimeString());
    effChart.data.datasets[0].data = samples.map((s) => s.systemEfficiency);
    socChart.update();
    effChart.update();
  } catch {
    // storico non disponibile: la dashboard funziona comunque
  }
};

const wireControls = () => {
  const bindAction = (containerId, datasetKey, actionName, transform, pendingSetter) => {
    document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.disabled || !things) {
          return;
        }
        setButtonsDisabled(containerId, true);
        pendingSetter?.(btn.dataset[datasetKey]);
        setActive(containerId, (button) => button === btn);
        try {
          await things.controlActuator.invokeAction(actionName, transform(btn.dataset[datasetKey]));
          setStatus("Online", true);
          refreshSoon();
        } catch (error) {
          console.warn(`Azione ${actionName} fallita`, error);
          setStatus("Errore comandi", false);
        } finally {
          pendingSetter?.(null);
          setButtonsDisabled(containerId, false);
        }
      });
    });
  };

  bindAction("driveModeButtons", "mode", "setDriveMode", (value) => value, (value) => {
    pendingDriveMode = value;
    pendingDriveUntil = value ? Date.now() + 6000 : 0;
  });

  bindAction("regenButtons", "regen", "triggerRegen", (value) => Number(value), (value) => {
    pendingRegen = value;
    pendingRegenUntil = value ? Date.now() + 6000 : 0;
  });
};

const start = async () => {
  try {
    const [powerUnit, controlActuator] = await Promise.all([
      consumeThing(TD_URLS.powerUnit),
      consumeThing(TD_URLS.controlActuator)
    ]);
    things = { powerUnit, controlActuator };

    console.log("Thing Description consumate:", Object.keys(things));

    wireControls();
    await loadHistory();
    await updateDashboard();
    setInterval(updateDashboard, 2000);
  } catch (error) {
    console.error("Impossibile consumare le Thing Description", error);
    setStatus("TD non raggiungibili", false);
    setTimeout(start, 3000);
  }
};

void start();
