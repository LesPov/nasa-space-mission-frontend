import { Injectable, inject, signal } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameStateService } from '../state/game-state.service';
import { GameContextService } from '../../session/game-context.service';
import { EpisodiosService } from '../../../../services/api/episodios';
import { MissionProfileDto, MissionStatus } from '../../models/api-dto.model';
import { WorldSettingsService } from '../../world/world-settings.service';

export interface ObjectiveState {
  id: string;
  text: string;
  completed: boolean;
  isLocal: boolean;
}

@Injectable({ providedIn: 'root' })
export class MissionManagerSystem implements IUpdatable {
  public id = 'MissionManagerSystem';

  private gameState = inject(GameStateService);
  private gameContext = inject(GameContextService);
  private apiSvc = inject(EpisodiosService);
  private worldSettingsSvc = inject(WorldSettingsService);

  // Estado reactivo para la UI
  public activeProfile = signal<MissionProfileDto | null>(null);
  public currentStatus = signal<MissionStatus>('PLANNING');
  public activeObjectives = signal<ObjectiveState[]>([]);
  public completionPercentage = signal<number>(0);

  private evaluationTimer = 0;

  public start(): void {
    this.resetState();
    this.loadMissionProfile();
    this.buildObjectivesList();
  }

  public stop(): void {
    this.resetState();
  }

  // Se ejecuta dentro del LoopManager. Evaluamos a baja frecuencia (cada 500ms) para no saturar.
  public update(dtMs: number): void {
    this.evaluationTimer += dtMs;
    if (this.evaluationTimer > 500) {
      this.evaluateObjectives();
      this.evaluationTimer = 0;
    }
  }

  private resetState(): void {
    this.activeProfile.set(null);
    this.currentStatus.set('PLANNING');
    this.activeObjectives.set([]);
    this.completionPercentage.set(0);
    this.evaluationTimer = 0;
  }

  private loadMissionProfile(): void {
    const episodeData = this.gameContext.activeEpisode();
    if (!episodeData || !episodeData.id) return;

    this.apiSvc.obtenerMissionProfile(episodeData.id).subscribe({
      next: (profile) => {
        if (profile) {
          this.activeProfile.set(profile);
          this.currentStatus.set(profile.missionStatus);
          this.completionPercentage.set(profile.completionPercentage);
        }
      },
      error: () => {
        // Fallback silencioso: no todos los episodios son misiones espaciales.
        this.activeProfile.set(null);
      }
    });
  }

  private buildObjectivesList(): void {
    const uiSettings = this.worldSettingsSvc.uiSettings();
    const logicSettings = this.worldSettingsSvc.settings().logicSettings || {};
    
    let localObjArray: string[] = [];
    if (logicSettings.objetivosLocales) {
       localObjArray = Array.isArray(logicSettings.objetivosLocales) 
         ? logicSettings.objetivosLocales 
         : logicSettings.objetivosLocales.split('\n');
    }

    let globalObjArray: string[] = [];
    if (uiSettings.objetivos) {
       globalObjArray = Array.isArray(uiSettings.objetivos) 
         ? uiSettings.objetivos 
         : (uiSettings.objetivos as string).split('\n');
    }

    const compiledObjectives: ObjectiveState[] = [];

    // Priorizamos objetivos locales de la zona
    localObjArray.map(s => s.trim()).filter(Boolean).forEach((text, index) => {
        compiledObjectives.push({
            id: `obj_local_${index}`,
            text: text,
            completed: false,
            isLocal: true
        });
    });

    // Añadimos objetivos globales del episodio
    globalObjArray.map(s => s.trim()).filter(Boolean).forEach((text, index) => {
        compiledObjectives.push({
            id: `obj_global_${index}`,
            text: text,
            completed: false,
            isLocal: false
        });
    });

    if (compiledObjectives.length === 0) {
        compiledObjectives.push({
            id: 'obj_default',
            text: 'Explora el área y sobrevive.',
            completed: false,
            isLocal: false
        });
    }

    this.activeObjectives.set(compiledObjectives);
    this.evaluateObjectives(); // Evaluación inicial
  }

  private evaluateObjectives(): void {
    const currentObjs = this.activeObjectives();
    let hasChanges = false;
    let completedCount = 0;

    const newObjs = currentObjs.map(obj => {
        // Criterio de completitud dinámico:
        // Buscamos en GameStateService si existe un flag booleano con el ID del objetivo
        // Ej: mutación "set_var", key: "obj_local_0", value: true
        const isCompleted = this.gameState.getVar(obj.id, obj.isLocal ? 'scene' : 'episode') === true;
        
        if (isCompleted) completedCount++;

        if (obj.completed !== isCompleted) {
            hasChanges = true;
            return { ...obj, completed: isCompleted };
        }
        return obj;
    });

    if (hasChanges) {
        this.activeObjectives.set(newObjs);
        
        // Auto-actualizar porcentaje base (solo visual/runtime, no persiste a BD hasta terminar la misión)
        if (newObjs.length > 0) {
            const pct = Math.round((completedCount / newObjs.length) * 100);
            this.completionPercentage.set(pct);
        }
    }
  }

  public completeObjective(objectiveId: string, isLocal: boolean = true): void {
      // API pública para ser llamada por Triggers personalizados si es necesario
      this.gameState.setVar(objectiveId, true, isLocal ? 'scene' : 'episode');
      this.evaluateObjectives();
  }
}