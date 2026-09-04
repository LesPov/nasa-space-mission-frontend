import { Injectable } from '@angular/core';
import { Quaternion, Vector3 } from '@babylonjs/core';

export interface TelemetryLog {
  frameId: number;
  phase: string;
  entityUid: string;
  entityRole: string;
  system: string;
  property: string;
  action: 'READ' | 'WRITE' | 'SYNC';
  valueBefore?: string;
  valueAfter?: string;
  angularError?: number;
}

@Injectable({ providedIn: 'root' })
export class TransformTelemetryService {
  public static instance: TransformTelemetryService;
  public enabled = false;

  private currentFrame = 0;
  private currentPhase = 'UNKNOWN';
  private frameLogs: TelemetryLog[] = [];

  constructor() {
    TransformTelemetryService.instance = this;
    (window as any).ENABLE_TRANSFORM_TRACE = false;
  }

  public checkEnabled() {
    this.enabled = !!(window as any).ENABLE_TRANSFORM_TRACE;
  }

  public beginFrame(frame: number) {
    this.checkEnabled();
    if (!this.enabled) return;
    this.currentFrame = frame;
    this.frameLogs = [];
  }

  public setPhase(phase: string) {
    this.currentPhase = phase;
  }

  public logEvent(
    entityUid: string, entityRole: string, system: string, 
    property: string, action: 'READ' | 'WRITE' | 'SYNC', 
    vBefore?: any, vAfter?: any, qError?: number
  ) {
    if (!this.enabled) return;

    this.frameLogs.push({
      frameId: this.currentFrame,
      phase: this.currentPhase,
      entityUid,
      entityRole,
      system,
      property,
      action,
      valueBefore: vBefore ? this.formatVal(vBefore) : undefined,
      valueAfter: vAfter ? this.formatVal(vAfter) : undefined,
      angularError: qError
    });
  }

  public endFrame() {
    if (!this.enabled || this.frameLogs.length === 0) return;

    // Detectar doble escritura sobre rotationQuaternion
    const writers = this.frameLogs.filter(l => l.action === 'WRITE' && l.property === 'rotationQuaternion');
    const hasDoubleWrite = writers.length > 1;

    console.group(`[TELEMETRY] FRAME ${this.currentFrame} ${hasDoubleWrite ? '🚨 DOUBLE WRITE DETECTED' : ''}`);
    console.table(this.frameLogs);
    console.groupEnd();
  }

  public calculateQuaternionError(q1: Quaternion | null, q2: Quaternion | null): number {
    if (!q1 || !q2) return 0;
    const dot = Quaternion.Dot(q1, q2);
    // Calcular el ángulo entre quaternions. Math.min para evitar NaN por errores de float
    return Math.acos(Math.min(1, Math.abs(dot))) * 2 * (180 / Math.PI);
  }

  private formatVal(val: any): string {
    if (val instanceof Vector3) return `[${val.x.toFixed(4)}, ${val.y.toFixed(4)}, ${val.z.toFixed(4)}]`;
    if (val instanceof Quaternion) return `[${val.x.toFixed(4)}, ${val.y.toFixed(4)}, ${val.z.toFixed(4)}, ${val.w.toFixed(4)}]`;
    return String(val);
  }
}