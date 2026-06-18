// src/app/core/engine/game-session.ts

import { Injectable, signal, inject } from '@angular/core';
import { GameEntity } from './entities/game.entity';
import { EntityManagerService } from './entities/entity-manager.service';
import { BaseCharacterController } from './controllers/base-character.controller';
import { PlayerController } from './controllers/player.controller';
import { NpcController } from './controllers/npc.controller';
import { LoopManagerService } from './behaviors/services/loop-manager.service';
import { ObjectAnimationService } from './systems/object-animation.service';
import { GameEventBusService } from './events/game-event-bus.service';

import { Motor3dService } from '../../services/motor-3d.service';
import { PlayerAnimationService } from './systems/player-animation.service';
import { PlayerPhysicsService } from './systems/player-physics.service';
import { PlayerSequenceService } from './systems/player-sequence.service';
import { PlayerInputService } from './systems/player-input.service';
import { PlayerCameraManagerService } from './systems/player-camera.service';
import { PlayerInteractionService } from './systems/player-interaction.service';
import { PlayerTriggerService } from './systems/player-trigger.service';
import { PlayerBubbleService } from './systems/player-bubble.service';
import { CharacterContext } from './controllers/character-context.interface';
import { PlayerFogService } from './systems/player-fog.service';
import { CharacterKinematicsService } from './systems/character-kinematics.service';

@Injectable({ providedIn: 'root' })
export class GameSession {
  public isPlaying = signal<boolean>(false);
  public isAdminSession = signal<boolean>(false);
  public cameraView = signal<'FPS' | 'TPS'>('FPS');
  public activePlayerEntity = signal<GameEntity | null>(null);
  public pointerLocked = signal<boolean>(false);

  private controllers: Map<string, BaseCharacterController> = new Map();

  private entityManager = inject(EntityManagerService);
  private loopManager = inject(LoopManagerService);
  private objectAnimSvc = inject(ObjectAnimationService);
  private eventBus = inject(GameEventBusService);

  private motor3d = inject(Motor3dService);
  private animSvc = inject(PlayerAnimationService);
  private physicsSvc = inject(PlayerPhysicsService);
  private kinematicsSvc = inject(CharacterKinematicsService);
  private sequenceSvc = inject(PlayerSequenceService);
  private inputSvc = inject(PlayerInputService);
  private cameraSvc = inject(PlayerCameraManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private triggerSvc = inject(PlayerTriggerService);
  private bubbleSvc = inject(PlayerBubbleService);
  private playerFogSvc = inject(PlayerFogService);

  public get proxyColliders() {
    return this.motor3d.scene.meshes.filter(m => m.name.includes('proxyCol'));
  }

  public start(playerEntity: GameEntity, view: 'FPS' | 'TPS', isAdmin: boolean): void {
    this.isPlaying.set(true);
    this.isAdminSession.set(isAdmin);
    this.cameraView.set(view);
    this.activePlayerEntity.set(playerEntity);
    this.pointerLocked.set(true);

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStarted', payload: { view, isAdmin } });

    this.triggerSvc.prepararTriggersParaJuego();
    this.objectAnimSvc.startAmbientAutoAnimations();
    
    this.playerFogSvc.start(playerEntity, view);

    const context: CharacterContext = {
      motor3d: this.motor3d,
      session: this,
      entityManager: this.entityManager,
      animSvc: this.animSvc,
      physicsSvc: this.physicsSvc,
      kinematicsSvc: this.kinematicsSvc,
      sequenceSvc: this.sequenceSvc,
      inputSvc: this.inputSvc,
      cameraSvc: this.cameraSvc,
      interactSvc: this.interactSvc,
      triggerSvc: this.triggerSvc,
      bubbleSvc: this.bubbleSvc,
      loopManager: this.loopManager
    };

    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.uid === playerEntity.uid) {
        const playerCtrl = new PlayerController(entity, context);
        this.controllers.set(entity.uid, playerCtrl);
        playerCtrl.start();
      } else if (entity.rol === 'npc' || entity.rol === 'spawn_point') {
        const npcCtrl = new NpcController(entity, context);
        this.controllers.set(entity.uid, npcCtrl);
        npcCtrl.start();
      }
    }

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      const handlePointerLockChange = () => {
        const locked = !!document.pointerLockElement;
        this.pointerLocked.set(locked);
        if (locked) this.eventBus.emit({ type: 'GameResumed' });
        else this.eventBus.emit({ type: 'GamePaused' });
      };
      document.addEventListener('pointerlockchange', handlePointerLockChange);
      (this as any)._pointerLockListener = handlePointerLockChange; 
    }
  }

  public stop(): void {
    this.isPlaying.set(false);
    this.activePlayerEntity.set(null);
    this.pointerLocked.set(false);

    this.objectAnimSvc.stopAmbientAutoAnimations();
    this.playerFogSvc.stop();

    this.controllers.forEach(ctrl => ctrl.destroy());
    this.controllers.clear();

    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStopped' });

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas && (this as any)._pointerLockListener) {
      document.removeEventListener('pointerlockchange', (this as any)._pointerLockListener);
    }
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
        this.cameraView.set(newView);
        this.playerFogSvc.setView(newView);
        this.eventBus.emit({ type: 'CameraViewChanged', payload: newView });
      },
      customFrames
    );
  }
}