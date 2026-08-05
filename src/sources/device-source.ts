import { DriveMode } from "../sim-state";
import { ActuatorSource, ComponentSource, ControlActuatorReading, SourceKind } from "./types";

/**
 * Componente fisico presente nel sistema: riceve le misure dal trasporto
 * (`accept`) e le tiene come ultimo stato noto.
 *
 * Se l'ultima misura e' piu' vecchia della finestra di validita' la sorgente
 * torna da sola sul fallback simulato, e si riallinea al ciclo successivo
 * quando il dispositivo ricomincia a pubblicare.
 *
 * Le misure possono essere parziali: un dispositivo reale difficilmente espone
 * tutte le grandezze del modello, quelle che mancano restano stimate.
 *
 * Non conosce MQTT, cosi' e' verificabile senza broker.
 */
export class DeviceSource<TReading extends object> implements ComponentSource<TReading> {
  private lastReading?: Partial<TReading>;
  private lastReadingAt = 0;

  constructor(
    readonly component: string,
    private readonly fallback: ComponentSource<TReading>,
    private readonly options: { stalenessMs?: number; now?: () => number } = {}
  ) {}

  private get stalenessMs(): number {
    return this.options.stalenessMs ?? 6000;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** Nuova misura dal dispositivo fisico. */
  accept(reading: Partial<TReading>): void {
    this.lastReading = reading;
    this.lastReadingAt = this.now();
  }

  origin(): SourceKind {
    const fresh =
      this.lastReading !== undefined && this.now() - this.lastReadingAt <= this.stalenessMs;
    return fresh ? "real" : "simulated";
  }

  snapshot(): TReading {
    const simulated = this.fallback.snapshot();
    return this.origin() === "real" ? { ...simulated, ...this.lastReading } : simulated;
  }
}

/**
 * Variante attuabile: oltre a misurare, inoltra i comandi al dispositivo reale.
 * Il comando viene applicato anche al fallback simulato, cosi' gli altri
 * componenti restano coerenti e alla disconnessione si riparte da uno stato
 * allineato invece che stantio.
 */
export class ActuatorDeviceSource
  extends DeviceSource<ControlActuatorReading>
  implements ActuatorSource
{
  constructor(
    component: string,
    private readonly simulatedFallback: ActuatorSource,
    private readonly sendCommand: (name: string, value: unknown) => void,
    options: { stalenessMs?: number; now?: () => number } = {}
  ) {
    super(component, simulatedFallback, options);
  }

  setDriveMode(mode: DriveMode): void {
    this.sendCommand("setDriveMode", mode);
    this.simulatedFallback.setDriveMode(mode);
  }

  setRegenIntensity(intensity: number): void {
    this.sendCommand("triggerRegen", intensity);
    this.simulatedFallback.setRegenIntensity(intensity);
  }
}
