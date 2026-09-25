
import { Injectable, inject, signal } from '@angular/core';
import { Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { CinematicDirectorService } from './cinematic-director.service';
import { TriggerAudioService } from './trigger-audio.service';
import { PlayerAnimationService } from './player-animation.service';
import { DynamicLightingSystem } from './lighting/dynamic-lighting.system';
import { PlayerTriggerService } from './player-trigger.service';
import { GameStateService } from '../state/game-state.service';
import { GameContextService } from '../../session/game-context.service';

export type PlatformLifecycleStage = 
  | 'IDLE'
  | 'TRANSITION_OUT'
  | 'UNLOADING'
  | 'LOADING'
  | 'SPAWNING'
  | 'RESTORING_CAMERA'
  | 'READY';

@Injectable({ providedIn: 'root' })
export class PlatformLifecycleService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private cinematicDirector = inject(CinematicDirectorService);
  private triggerAudio = inject(TriggerAudioService);
  private playerAnimation = inject(PlayerAnimationService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private playerTrigger = inject(PlayerTriggerService);
  private gameState = inject(GameStateService);
  private context = inject(GameContextService);

  public currentStage = signal<PlatformLifecycleStage>('IDLE');
  public isBusy = signal<boolean>(false);

  /**
   * Ejecuta el desmantelamiento completo y controlado de la plataforma actual.
   * Elimina exclusivamente los recursos locales pertenecientes a la plataforma,
   * preservando el jugador persistente, el estado global del juego y los sistemas base del motor.
   */
  public cleanCurrentPlatform(): void {
    this.currentStage.set('UNLOADING');
    this.isBusy.set(true);

    const scene = this.motor3d.getScene();

    // 1. Detener cinemáticas y limpiar overlays
    this.cinematicDirector.stop();

    // 2. Detener todos los audios espaciales y de triggers
    this.triggerAudio.stop();

    // 3. Limpiar estado de triggers activos
    this.playerTrigger.resetTransitionState();

    // 4. Detener animaciones y restaurar speedRatio a 1.0 en el jugador persistente
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);
    if (persistentPlayer) {
      this.playerAnimation.detenerTodas(persistentPlayer);
      this.playerAnimation.reproducirIdle(persistentPlayer);
    } else {
      this.playerAnimation.detenerTodasGlobal();
    }

    // 5. Apagar y limpiar el pool de luces dinámicas
    this.dynamicLighting.stop();

    // 6. Limpiar el estado de escena en el GameState (conservando global, episode y player)
    this.gameState.clearSceneState();

    // 7. Desregistrar y destruir vistas de entidades no persistentes
    this.entityManager.clear();

    // 8. Destruir mallas de escena huérfanas en Babylon (excepto jugador persistente, suelo base y sistemas)
    if (scene) {
      const meshesToDispose = scene.meshes.filter(m => 
        !Tags.MatchesQuery(m, "system_element || persistent_player || invisible_floor") &&
        m.name !== 'TempPlayer_Fallback'
      );
      
      for (let i = meshesToDispose.length - 1; i >= 0; i--) {
        const m = meshesToDispose[i];
        if (!m.isDisposed()) {
          m.dispose(false, false);
        }
      }

      // Eliminar AnimationGroups huérfanos que no pertenezcan al jugador persistente
      if (scene.animationGroups) {
        const playerView = persistentPlayer?.view;
        const playerDescendants = playerView ? new Set([playerView, ...playerView.getDescendants(false)]) : new Set();

        const agsToDispose: any[] = [];
        scene.animationGroups.forEach(ag => {
          const targetsPlayer = ag.targetedAnimations?.some(ta => playerDescendants.has(ta.target));
          if (!targetsPlayer) {
            agsToDispose.push(ag);
          }
        });

        agsToDispose.forEach(ag => {
          ag.stop();
          ag.dispose();
        });
      }
    }

    this.currentStage.set('IDLE');
    this.isBusy.set(false);
  }

  /**
   * Marca el inicio de la carga de la siguiente plataforma.
   */
  public beginLoadingNext(): void {
    this.currentStage.set('LOADING');
    this.isBusy.set(true);
  }

  /**
   * Marca la plataforma como completamente cargada y lista para continuar el gameplay.
   */
  public markPlatformReady(): void {
    this.currentStage.set('READY');
    this.isBusy.set(false);
    this.context.setTransitioning(false);
  }
}