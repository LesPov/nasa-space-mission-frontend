import { Injectable } from '@angular/core';
import { mergePlayerConfig } from '../player-config.model';

@Injectable({ providedIn: 'root' })
export class SceneUtilsService {
  
  public normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  public normalizarSelectionRange(raw: any) {
    return {
      fpsAdminMax: this.normalizarNumero(raw?.fpsAdminMax, 10000),
      fpsUserMax: this.normalizarNumero(raw?.fpsUserMax, 3)
    };
  }

  public extraerSelectionRange(meta: any) {
    const source = meta?.playerConfig?.selectionRange || meta?.selectionRange || null;
    return this.normalizarSelectionRange(source);
  }

  public prepararPlayerConfigConSelectionRange(rawPlayerConfig: any, rawSelectionRange?: any) {
    const cfg = mergePlayerConfig(rawPlayerConfig || null) as any;
    const range = this.normalizarSelectionRange(
      rawSelectionRange || cfg.selectionRange || rawPlayerConfig?.selectionRange || null
    );

    cfg.selectionRange = {
      fpsAdminMax: range.fpsAdminMax,
      fpsUserMax: range.fpsUserMax
    };

    return cfg;
  }
}