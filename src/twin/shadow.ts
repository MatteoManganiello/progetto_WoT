import { DeviceId } from "../physical/protocol";

/** Da dove arriva il valore che il gemello sta servendo in questo istante. */
export type ValueSource = "physical" | "model";

export type ShadowStatus = {
  deviceId: DeviceId;
  source: ValueSource;
  live: boolean;
  samples: number;
  /** Assenti finche' il dispositivo fisico non si e' mai fatto vivo. */
  lastSeen?: string;
  ageMs?: number;
};

type ShadowOptions = {
  deviceId: DeviceId;
  /** Oltre questa eta' la misura fisica e' considerata scaduta e subentra il modello. */
  ttlMs: number;
  now?: () => number;
};

/**
 * Ombra digitale di un singolo dispositivo.
 *
 * Mantiene due copie dello stato: quella misurata dalla parte fisica e quella
 * calcolata dal modello. Serve la prima finche' e' fresca, altrimenti degrada
 * sulla seconda. E' questo il meccanismo che permette al sistema di funzionare
 * con zero, una o tutte le parti reali collegate.
 */
export class DeviceShadow<R extends Record<string, unknown>> {
  readonly deviceId: DeviceId;

  private readonly ttlMs: number;
  private readonly now: () => number;

  private physicalValues: R | undefined;
  private physicalAtMs = 0;
  private physicalTimestamp: string | null = null;
  private lastSeq = -1;
  private sampleCount = 0;

  private modelValues: R;

  constructor(options: ShadowOptions, initialModelValues: R) {
    this.deviceId = options.deviceId;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
    this.modelValues = { ...initialModelValues };
  }

  /**
   * Accetta una misura dalla parte fisica. Scarta i pacchetti fuori ordine, ma
   * riconosce il riavvio di un dispositivo (il contatore riparte da zero).
   */
  ingest(readings: R, timestamp: string, seq: number): boolean {
    const isRestart = seq <= 1 && this.lastSeq > 1;
    if (!isRestart && seq <= this.lastSeq) {
      return false;
    }
    this.lastSeq = seq;
    this.physicalValues = { ...readings };
    this.physicalAtMs = this.now();
    this.physicalTimestamp = timestamp;
    this.sampleCount += 1;
    return true;
  }

  /** Aggiorna la copia calcolata dal modello di fallback. */
  updateModel(readings: R): void {
    this.modelValues = { ...readings };
  }

  isLive(): boolean {
    if (this.physicalValues === undefined) {
      return false;
    }
    return this.now() - this.physicalAtMs <= this.ttlMs;
  }

  /** Vista effettiva servita alle Thing WoT. */
  values(): R {
    if (this.isLive() && this.physicalValues !== undefined) {
      return this.physicalValues;
    }
    return this.modelValues;
  }

  /** Ultima misura fisica nota, anche se scaduta (usata per riallineare il modello). */
  lastPhysicalValues(): R | undefined {
    return this.physicalValues;
  }

  status(): ShadowStatus {
    const live = this.isLive();
    const status: ShadowStatus = {
      deviceId: this.deviceId,
      source: live ? "physical" : "model",
      live,
      samples: this.sampleCount
    };
    // I campi restano omessi, non null: `null` non e' un valore ammesso dal
    // DataSchema dichiarato nella TD e node-wot lo rifiuterebbe in lettura.
    if (this.physicalValues !== undefined && this.physicalTimestamp !== null) {
      status.lastSeen = this.physicalTimestamp;
      status.ageMs = this.now() - this.physicalAtMs;
    }
    return status;
  }
}
