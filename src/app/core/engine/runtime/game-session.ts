
import { Injectable, inject, Injector, computed } from '@angular/core';
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
import { Motor3dService } from '../../../services/motor-3d.service';
import { CameraViewMode } from '../session/game-context.model';
import { GameContextService } from '../session/game-context.service';
  
@Injectable({ providedIn: 'root' })
export class GameSession {
  private injector = inject(Injector);
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

  // Interfaces Reactivas (Bindings directos al contexto central)
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
        this.inputSvc.enable();
        this.interactionSvc.enable();
      } else if (event.type === 'GamePaused') {
        this.context.setPointerLocked(false);
        this.inputSvc.disable();
        this.interactionSvc.disable();
      }
    });
  }

  public start(playerEntity: GameEntity, view: CameraViewMode): void {
    this.context.startGameSession(playerEntity, view);
    
    this.inputSvc.enable();
    this.interactionSvc.enable();

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStarted', payload: { view, isDebugMode: this.context.isDebugMode() } });

    const sequenceSvc = this.injector.get(PlayerSequenceService);
    sequenceSvc.resetearSecuencias();

    this.triggerSvc.start();
    this.objectAnimSvc.startAmbientAutoAnimations();
    this.playerFogSvc.start(playerEntity, view);

    // Inicializar y registrar todos los sistemas del motor
    this.systems = [
      this.injector.get(PlayerInputService),
      this.injector.get(PlayerSequenceService),
      this.injector.get(CharacterKinematicsService),
      this.injector.get(PlayerTriggerService),
      this.injector.get(PlayerInteractionService),
      this.injector.get(PlayerAnimationService),
      this.injector.get(PlayerCameraManagerService),
      this.injector.get(RenderSync)
    ];

    this.systems.forEach(system => {
        this.loopManager.registerSystem(system);
        if (typeof (system as any).start === 'function') {
          (system as any).start();
        }
    });

    // Resetear estados iniciales
    this.cameraSvc.resetearTransiciones();
    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.characterConfig) {
        const animSvc = this.injector.get(PlayerAnimationService);
        const motor3d = this.injector.get(Motor3dService);
        animSvc.sincronizarAnimaciones(motor3d.scene, entity);

        const autoSeq = entity.playerConfig?.sequences.find((s: any) => s.autoPlay);
        if (autoSeq) {
          sequenceSvc.iniciarSecuenciaEnJuego(autoSeq.id, entity);
        } else {
          animSvc.reproducirIdle(entity);
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

    const sequenceSvc = this.injector.get(PlayerSequenceService);
    sequenceSvc.resetearSecuencias();

    // Detener y desregistrar todos los sistemas
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