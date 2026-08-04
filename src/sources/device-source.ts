import { DriveMode } from "../sim-state";
import { ActuatorSource, ComponentSource, ControlActuatorReading, SourceKind } from "./types";

/**
 * SORGENTE DA COMPONENTE REALE.
 *
 * Rappresenta un componente fisico presente nel sistema. Riceve le misure dal
 * trasporto (`accept`) e le tiene come ultimo stato noto.
 *
 * Il punto qualificante di un gemello digitale e' che non si ferma quando la
 * parte reale tace: se l'ultima misura e' piu' vecchia della finestra di
 * validita', la sorgente degrada da sola sul fallback simulato e continua a
 * rispondere. Quando il dispositivo torna a pubblicare, si riallinea al ciclo
 * successivo senza alcun intervento.
 *
 * Le misure sono accettate anche parziali: un dispositivo che pubblica solo
 * alcune grandezze copre quelle, il resto resta simulato. E' cosi' che il
 * sistema regge una sostituzione realistica, dove il componente reale non
 * espone tutte le grandezze del modello.
 *
 * La classe e' agnostica rispetto al trasporto — non conosce MQTT — e si presta
 * a essere verificata senza broker.
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
 *
 * Il comando viene comunque applicato anche alla simulazione di fallback: gli
 * altri componenti restano coerenti, e se il dispositivo reale si scollega il
 * gemello riprende da uno stato allineato invece che da uno stato stantio.
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
