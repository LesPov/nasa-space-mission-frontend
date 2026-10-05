
// file: src/app/core/engine/runtime/game-session.ts
import { Injectable, inject, computed } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameEntity } from '../entities/game.entity';
import { EntityManagerService } from '../entities/entity-manager.service';
import { ObjectAnimationService } from './systems/object-animation.service';
import { GameEventBusService } from '../events/game-event-bus.service';
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
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene/scene-access.token';
import { CameraViewMode } from '../session/game-context.model';
import { GameMode } from '../session/game-mode.model';
import { GameContextService } from '../session/game-context.service';
import { LayoutService } from '../../../services/layout.service';
import { CameraOwnershipService } from './cameras/camera-ownership.service';
import { TriggerAudioService } from './systems/trigger-audio.service';
import { LocalRenderingSystem } from './systems/local-rendering.system';
import { MissionManagerSystem } from './systems/mission-manager.system';

@Injectable({ providedIn: 'root' })
export class GameSession {
  private entityManager = inject(EntityManagerService);
  private objectAnimSvc = inject(ObjectAnimationService);
  private eventBus = inject(GameEventBusService);
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
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private triggerAudioSvc = inject(TriggerAudioService);
  private localRendering = inject(LocalRenderingSystem); 
  private missionManager = inject(MissionManagerSystem);

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
        
        if (owner !== 'ADMIN_FREE' && owner !== 'CINEMATIC_DIRECTOR') {
          this.inputSvc.enable();
          this.interactionSvc.enable();
        }

        const mode = this.context.mode();
        if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
          this.layoutSvc.ocultarMenu(); 
        }

        const cam = this.ownership.getCamera();
        const canvas = this.motor3dSvc.getEngine()?.getRenderingCanvas();
        if (cam && canvas) {
          try { cam.attachControl(canvas, true); } catch {}
        }

      } else if (event.type === 'GamePaused') {
        this.context.setPointerLocked(false);
        this.inputSvc.disable();
        this.interactionSvc.disable();

        const cam = this.ownership.getCamera();
        if (cam && (this.ownership.getOwner() === 'PLAYER_FPS' || this.ownership.getOwner() === 'PLAYER_TPS')) {
          try { cam.detachControl(); } catch {}
        }

        const mode = this.context.mode();
        if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
          this.layoutSvc.mostrarMenu(); 
        }
      } else if (event.type === 'ToggleCameraRequested') {
        this.toggleCameraUser();
      }
    });
  }

  public start(playerEntity: GameEntity, view: CameraViewMode): void {
    this.context.startGameSession(playerEntity, view);
    
    playerEntity.movementAuthority = 'GAMEPLAY';
    if (playerEntity.playerRuntime) {
      playerEntity.playerRuntime.intentions = { 
        moveForward: false, moveBackward: false, moveLeft: false, 
        moveRight: false, run: false, jump: false 
      };
      playerEntity.playerRuntime.seqRuntime = {
        step: null,
        lockInput: false,
        allowMovement: true,
        forceForwardWalk: false,
        forceForwardRun: false,
        forceJump: false,
        blend: 0.1,
        loop: true,
        running: false,
        freezeOrientation: false,
        rootMotion: Vector3.Zero()
      };
    }

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStarted', payload: { view, isDebugMode: this.context.isDebugMode() } });

    this.sequenceSvc.resetearSecuencias();

    this.systems = [
      this.inputSvc,
      this.kinematicsSvc,
      this.triggerAudioSvc,
      this.interactionSvc,
      this.playerAnimationSvc,
      this.cameraSvc,
      this.mediaCommandSvc,
      this.localRendering, 
      this.renderSyncSvc,
      this.objectAnimSvc,
      this.bubbleSvc,
      this.missionManager
    ];

    this.systems.forEach(system => {
      this.loopManager.registerSystem(system);
      if (typeof (system as any).start === 'function') {
        (system as any).start();
      }
    });

    const mode = this.context.mode();
    if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
      this.layoutSvc.mostrarMenu();
      this.inputSvc.disable();
      this.interactionSvc.disable();
    } else {
      this.inputSvc.start();
      this.inputSvc.enable();
      this.interactionSvc.enable();
    }

    this.cameraSvc.resetearTransiciones();
    
    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.characterConfig) {
        this.playerAnimationSvc.sincronizarAnimaciones(this.motor3dSvc.getScene(), entity);
        this.playerAnimationSvc.reproducirIdle(entity);
      }
    }

    // En modo juego final, las secuencias autoPlay se escalonan tras iniciar sesión
    if (mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN) {
      this.sequenceSvc.resumeExecution();
      this.sequenceSvc.queueAutoPlaySequencesStaggered();
    }
  }

  public stop(isTeleport: boolean = false): void {
    if (!isTeleport) {
      this.context.stopGameSession();
    } else {
      this.context.setPointerLocked(false);
    }
    
    this.inputSvc.disable();
    this.interactionSvc.disable();
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
    if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') return;

    const playerEntity = this.activePlayerEntity();
    if (!playerEntity) return;

    this.cameraSvc.toggleCameraView(
      playerEntity,
      this.cameraView(),
      isCinematicInitial,
      true,
      (newView) => {
        this.context.setCameraView(newView);
        this.eventBus.emit({ type: 'CameraViewChanged', payload: newView });
      },
      customFrames
    );
  }
}