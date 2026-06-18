// src/app/core/engine/game-session.ts

import { Injectable, signal, inject, Injector } from '@angular/core';
import { GameEntity } from './entities/game.entity';
import { EntityManagerService } from './entities/entity-manager.service';
import { BaseCharacterController } from './controllers/base-character.controller';
import { PlayerController } from './controllers/player.controller';
import { NpcController } from './controllers/npc.controller';
import { ObjectAnimationService } from './systems/object-animation.service';
import { GameEventBusService } from './events/game-event-bus.service';
import { Motor3dService } from '../../services/motor-3d.service';
import { PlayerTriggerService } from './systems/player-trigger.service';
import { PlayerFogService } from './systems/player-fog.service';
import { PlayerCameraManagerService } from './systems/player-camera.service';

@Injectable({ providedIn: 'root' })
export class GameSession {
  public isPlaying = signal<boolean>(false);
  public isAdminSession = signal<boolean>(false);
  public cameraView = signal<'FPS' | 'TPS'>('FPS');
  public activePlayerEntity = signal<GameEntity | null>(null);
  public pointerLocked = signal<boolean>(false);

  private controllers: Map<string, BaseCharacterController> = new Map();

  // Inyecciones Básicas de Arranque
  private injector = inject(Injector);
  private entityManager = inject(EntityManagerService);
  private objectAnimSvc = inject(ObjectAnimationService);
  private eventBus = inject(GameEventBusService);
  private motor3d = inject(Motor3dService);
  private triggerSvc = inject(PlayerTriggerService);
  private playerFogSvc = inject(PlayerFogService);
  private cameraSvc = inject(PlayerCameraManagerService);

  public get proxyColliders() {
    return this.motor3d.scene.meshes.filter(m => m.name.includes('proxyCol'));
  }

  public start(playerEntity: GameEntity, view: 'FPS' | 'TPS', isAdmin: boolean): void {
    this.isPlaying.set(true);
    this.isAdminSession.set(isAdmin);
    this.cameraView.set(view);
    this.activePlayerEntity.set(playerEntity);
    this.pointerLocked.set(true);

    // Reinicio Lógico del Bucle
    this.eventBus.emit({ type: 'ObjectFocused', payload: { entity: null, mesh: null, canInteract: false, canInspect: false } });
    this.eventBus.emit({ type: 'MessageRequested', payload: null });
    this.eventBus.emit({ type: 'InteractionStateChanged', payload: false });
    this.eventBus.emit({ type: 'GameStarted', payload: { view, isAdmin } });

    // Preparativos Ambientales
    this.triggerSvc.prepararTriggersParaJuego();
    this.objectAnimSvc.startAmbientAutoAnimations();
    this.playerFogSvc.start(playerEntity, view);

    // 🔥 DELEGACIÓN ABSOLUTA: Construimos a los controladores y les pasamos el Injector.
    // Ellos se encargarán de buscar sus servicios y acoplarse al LoopManager.
    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.uid === playerEntity.uid) {
        const playerCtrl = new PlayerController(entity, this.injector);
        this.controllers.set(entity.uid, playerCtrl);
        playerCtrl.start();
      } else if (entity.rol === 'npc' || entity.rol === 'spawn_point') {
        const npcCtrl = new NpcController(entity, this.injector);
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

    // Cada controlador se destruirá limpiamente sin romper nada externo
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