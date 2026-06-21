import { Injectable, inject, computed } from '@angular/core';
import { GameEntity } from '../entities/game.entity';
import { EntityManagerService } from '../entities/entity-manager.service';
import { ObjectAnimationService } from './systems/object-animation.service';
import { GameEventBusService } from '../events/game-event-bus.service';
import { PlayerTriggerService } from './systems/player-trigger.service';
import { PlayerFogService } from './systems/player-fog.service';
import { PlayerCameraManagerService } from './systems/player-camera.service';
import { PlayerBubbleService } from './systems/player-bubble.service';
import { PlayerSequenceService } from './systems/player-sequence.service';
import { PlayerInputService } from './systems/player-input.service';
import { PlayerInteractionService } from './systems/player-interaction.service';
import { IUpdatable, LoopManagerService } from '../behaviors/services/loop-manager.service';
import { CharacterKinematicsService } from './systems/character-kinematics.service';
import { PlayerAnimationService } from './systems/player-animation.service';
import { RenderSync } from './systems/render-sync';
import { MediaCommandSystem } from './systems/media-command.system';
import { Motor3dService } from '../../../services/motor-3d.service';
import { CameraViewMode } from '../session/game-context.model';
import { GameMode } from '../session/game-mode.model';
import { GameContextService } from '../session/game-context.service';
import { LayoutService } from '../../../services/layout.service';
import { CameraOwnershipService } from './cameras/camera-ownership.service';

// Resto del archivo se mantiene exactamente igual (solo cambiaron los imports superiores)
  
@Injectable({ providedIn: 'root' })
export class GameSession {
  private entityManager = inject(EntityManagerService);
  private objectAnimSvc = inject(ObjectAnimationService);
  private eventBus = inject(GameEventBusService);
  private triggerSvc = inject(PlayerTriggerService);
  private playerFogSvc = inject(PlayerFogService);
  private cameraSvc = inject(PlayerCameraManagerService);
  private bubbleSvc = inject(PlayerBubbleService);
  private inputSvc = inject(PlayerInputService);
  private interactionSvc = inject(PlayerInteractionService);
  private loopManager = inject(LoopManagerService);
  private context = inject(GameContextService);
  private layoutSvc = inject(LayoutService);
  private ownership = inject(CameraOwnershipService);
  private mediaCommandSvc = inject(MediaCommandSystem);
  private sequenceSvc = inject(PlayerSequenceService);
  private kinematicsSvc = inject(CharacterKinematicsService);
  private playerAnimationSvc = inject(PlayerAnimationService);
  private renderSyncSvc = inject(RenderSync);
  private motor3dSvc = inject(Motor3dService);

  public isPlaying = computed(() => this.context.isPlaying());
  public isDebugMode = computed(() => this.context.isDebugMode());
  public cameraView = computed(() => this.context.cameraView());
  public activePlayerEntity = computed(() => this.context.activePlayerEntity());
  public pointerLocked = computed(() => this.context.isPointerLocked());

  private systems: IUpdatable[] = [];

  constructor() {
    this.eventBus.events$.subscribe(event => {
      if (event.type === 'GameResumed') {
        this.context.setPointerLocked(true);
        const owner = this.ownership.getOwner();
        
        if (owner !== 'ADMIN_FREE') {
            this.inputSvc.enable();
            this.interactionSvc.enable();
        }

        const mode = this.context.mode();
        if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
             this.layoutSvc.ocultarMenu(); 
             if (this.cameraView() === 'TPS' && owner !== 'ADMIN_FREE') {
                 this.toggleCameraUser(false, 75); 
             }
        }

      } else if (event.type === 'GamePaused') {
        this.context.setPointerLocked(false);
        this.inputSvc.disable();
        this.interactionSvc.disable();

        const mode = this.context.mode();
        if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
             this.layoutSvc.mostrarMenu(); 
             const owner = this.ownership.getOwner();
             if (this.cameraView() === 'FPS' && owner !== 'ADMIN_FREE') {
                 this.toggleCameraUser(false, 60); 
             }
        }
      } else if (event.type === 'ToggleCameraRequested') {
        this.toggleCameraUser();
      }
    });
  }

  public start(playerEntity: GameEntity, view: CameraViewMode): void {
    this.context.startGameSession(playerEntity, view);
    
    const mode = this.context.mode();
    
    if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
      this.layoutSvc.mostrarMenu();
      this.inputSvc.disable();
      this.interactionSvc.disable();
      this.context.setPointerLocked(false);
    } else {
      this.inputSvc.enable();
      this.interactionSvc.enable();
    }

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStarted', payload: { view, isDebugMode: this.context.isDebugMode() } });

    this.sequenceSvc.resetearSecuencias();

    this.triggerSvc.start();
    this.objectAnimSvc.startAmbientAutoAnimations();
    this.playerFogSvc.start(playerEntity, view);

    this.systems = [
      this.inputSvc,
      this.sequenceSvc,
      this.kinematicsSvc,
      this.triggerSvc,
      this.interactionSvc,
      this.playerAnimationSvc,
      this.cameraSvc,
      this.mediaCommandSvc,
      this.renderSyncSvc
    ];

    this.systems.forEach(system => {
        this.loopManager.registerSystem(system);
        if (typeof (system as any).start === 'function') {
          (system as any).start();
        }
    });

    this.cameraSvc.resetearTransiciones();
    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.characterConfig) {
        this.playerAnimationSvc.sincronizarAnimaciones(this.motor3dSvc.scene, entity);

        const autoSeq = entity.playerConfig?.sequences.find((s: any) => s.autoPlay);
        if (autoSeq) {
          this.sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, entity);
        } else {
          this.playerAnimationSvc.reproducirIdle(entity);
        }
      }
    }
  }

  public stop(): void {
    this.context.stopGameSession();
    
    this.inputSvc.disable();
    this.interactionSvc.disable();

    this.objectAnimSvc.stopAmbientAutoAnimations();
    this.playerFogSvc.stop();
    this.triggerSvc.stop();
    this.bubbleSvc.stop();

    this.sequenceSvc.resetearSecuencias();

    this.systems.forEach(system => {
        this.loopManager.unregisterSystem(system.id);
        if (typeof (system as any).stop === 'function') {
          (system as any).stop();
        }
    });
    this.systems = [];

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStopped' });
  }

  public toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number): void {
    const playerEntity = this.activePlayerEntity();
    if (!playerEntity) return;

    this.cameraSvc.toggleCameraView(
      playerEntity,
      this.cameraView(),
      isCinematicInitial,
      true,
      (newView) => {
        this.context.setCameraView(newView);
        this.playerFogSvc.setView(newView);
        this.eventBus.emit({ type: 'CameraViewChanged', payload: newView });
      },
      customFrames
    );
  }
}