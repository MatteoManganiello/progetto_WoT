"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceShadow = void 0;
/**
 * Ombra digitale di un singolo dispositivo.
 *
 * Mantiene due copie dello stato: quella misurata dalla parte fisica e quella
 * calcolata dal modello. Serve la prima finche' e' fresca, altrimenti degrada
 * sulla seconda. E' questo il meccanismo che permette al sistema di funzionare
 * con zero, una o tutte le parti reali collegate.
 */
class DeviceShadow {
    constructor(options, initialModelValues) {
        this.physicalAtMs = 0;
        this.physicalTimestamp = null;
        this.lastSeq = -1;
        this.sampleCount = 0;
        this.deviceId = options.deviceId;
        this.ttlMs = options.ttlMs;
        this.now = options.now ?? (() => Date.now());
        this.modelValues = { ...initialModelValues };
    }
    /**
     * Accetta una misura dalla parte fisica. Scarta i pacchetti fuori ordine, ma
     * riconosce il riavvio di un dispositivo (il contatore riparte da zero).
     */
    ingest(readings, timestamp, seq) {
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
    updateModel(readings) {
        this.modelValues = { ...readings };
    }
    isLive() {
        if (this.physicalValues === undefined) {
            return false;
        }
        return this.now() - this.physicalAtMs <= this.ttlMs;
    }
    /** Vista effettiva servita alle Thing WoT. */
    values() {
        if (this.isLive() && this.physicalValues !== undefined) {
            return this.physicalValues;
        }
        return this.modelValues;
    }
    /** Ultima misura fisica nota, anche se scaduta (usata per riallineare il modello). */
    lastPhysicalValues() {
        return this.physicalValues;
    }
    status() {
        const live = this.isLive();
        const status = {
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
exports.DeviceShadow = DeviceShadow;
