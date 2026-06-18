
import { Injectable } from '@angular/core';
import { mergePlayerConfig } from '../../../core/engine/models/player-config.model';

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

  // 🔥 NUEVA LÓGICA VITAL: Renovar IDs de secuencias para evitar conflictos al clonar o instanciar prefabs
  public renovarIdsDeSecuencias(entityOrMeta: any): void {
    if (entityOrMeta?.playerConfig?.sequences && Array.isArray(entityOrMeta.playerConfig.sequences)) {
      const idMap = new Map<string, string>();
      
      // 1. Asignar nuevos IDs a las secuencias y sus pasos
      entityOrMeta.playerConfig.sequences.forEach((seq: any) => {
        const oldId = seq.id;
        const newId = 'seq_' + Math.random().toString(36).substring(2, 8);
        seq.id = newId;
        if (oldId) idMap.set(oldId, newId);
        
        if (seq.steps && Array.isArray(seq.steps)) {
          seq.steps.forEach((step: any) => {
             step.id = 'seq_' + Math.random().toString(36).substring(2, 8);
          });
        }
      });
      
      // 2. Función para reemplazar los IDs viejos por los nuevos en cadenas separadas por comas
      const updateSeqString = (str: string | undefined | null) => {
        if (!str || typeof str !== 'string') return str;
        let newStr = str;
        idMap.forEach((newId, oldId) => {
           newStr = newStr.replace(new RegExp(oldId, 'g'), newId);
        });
        return newStr;
      };
      
      // 3. Actualizar referencias locales
      // Revisamos si estamos operando sobre una GameEntity o sobre metadata plana
      if (entityOrMeta.interaction) {
        entityOrMeta.interaction.interactSequenceId = updateSeqString(entityOrMeta.interaction.interactSequenceId);
        entityOrMeta.interaction.interactSequenceIdFPS = updateSeqString(entityOrMeta.interaction.interactSequenceIdFPS);
        entityOrMeta.interaction.interactSequenceIdTPS = updateSeqString(entityOrMeta.interaction.interactSequenceIdTPS);
      } else {
        entityOrMeta.interactSequenceId = updateSeqString(entityOrMeta.interactSequenceId);
        entityOrMeta.interactSequenceIdFPS = updateSeqString(entityOrMeta.interactSequenceIdFPS);
        entityOrMeta.interactSequenceIdTPS = updateSeqString(entityOrMeta.interactSequenceIdTPS);
      }
      
      if (entityOrMeta.playerConfig.activeSequenceId) {
         entityOrMeta.playerConfig.activeSequenceId = updateSeqString(entityOrMeta.playerConfig.activeSequenceId);
      }
    }
  }
}