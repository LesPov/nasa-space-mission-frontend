
import { Injectable, signal, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { GameEntity } from './entities/game.entity';
import { EntityManagerService } from './entities/entity-manager.service';
import { BaseCharacterController } from '../../services/editor/characters/controllers/base-character.controller';
import { PlayerController } from '../../services/editor/characters/controllers/player.controller';
import { NpcController } from '../../services/editor/characters/controllers/npc.controller';
import { LoopManagerService } from './behaviors/services/loop-manager.service';
import { ObjectAnimationService } from '../../services/editor/object-animation.service';

// Importación de servicios para la inyección del CharacterContext
import { Motor3dService } from '../../services/motor-3d.service';
import { PlayerAnimationService } from '../../services/editor/playerservice/player-animation.service';
import { PlayerPhysicsService } from '../../services/editor/playerservice/player-physics.service';
import { PlayerSequenceService } from '../../services/editor/playerservice/player-sequence.service';
import { PlayerInputService } from '../../services/editor/playerservice/player-input.service';
import { PlayerCameraManagerService } from '../../services/editor/playerservice/player-camera.service';
import { PlayerInteractionService } from '../../services/editor/playerservice/player-interaction.service';
import { PlayerTriggerService } from '../../services/editor/player-trigger.service';
import { PlayerBubbleService } from '../../services/editor/playerservice/player-bubble';
import { CharacterContext } from '../../services/editor/characters/character-context.interface';

@Injectable({ providedIn: 'root' })
export class GameSession {
  // UI Signals (Comunicación Externa)
  public hudMessage = signal<string | null>(null);
  public showToastE = signal<boolean>(false);
  public showToastI = signal<boolean>(false);
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);
  public pointerLocked = signal<boolean>(false);
  public isInteracting = signal<boolean>(false);

  // Runtime State (Interno)
  public isPlaying = signal<boolean>(false);
  public isAdminSession = signal<boolean>(false);
  public cameraView = signal<'FPS' | 'TPS'>('FPS');
  public activePlayerEntity = signal<GameEntity | null>(null);

  private controllers: Map<string, BaseCharacterController> = new Map();

  // Dependencias Generales
  private entityManager = inject(EntityManagerService);
  private loopManager = inject(LoopManagerService);
  private objectAnimSvc = inject(ObjectAnimationService);

  // Dependencias para fabricar el CharacterContext
  private motor3d = inject(Motor3dService);
  private animSvc = inject(PlayerAnimationService);
  private physicsSvc = inject(PlayerPhysicsService);
  private sequenceSvc = inject(PlayerSequenceService);
  private inputSvc = inject(PlayerInputService);
  private cameraSvc = inject(PlayerCameraManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private triggerSvc = inject(PlayerTriggerService);
  private bubbleSvc = inject(PlayerBubbleService);

  public get proxyColliders(): AbstractMesh[] {
    return this.motor3d.scene.meshes.filter(m => m.name.includes('proxyCol'));
  }

  public start(playerEntity: GameEntity, view: 'FPS' | 'TPS', isAdmin: boolean): void {
    this.isPlaying.set(true);
    this.isAdminSession.set(isAdmin);
    this.cameraView.set(view);
    this.activePlayerEntity.set(playerEntity);
    this.pointerLocked.set(true);
    this.isInteracting.set(false);

    // Despertar entornos pasivos
    this.triggerSvc.prepararTriggersParaJuego();
    this.objectAnimSvc.startAmbientAutoAnimations();

    // Empaquetar contexto seguro para controladores
    const context: CharacterContext = {
      motor3d: this.motor3d,
      session: this,
      animSvc: this.animSvc,
      physicsSvc: this.physicsSvc,
      sequenceSvc: this.sequenceSvc,
      inputSvc: this.inputSvc,
      cameraSvc: this.cameraSvc,
      interactSvc: this.interactSvc,
      triggerSvc: this.triggerSvc,
      bubbleSvc: this.bubbleSvc,
      loopManager: this.loopManager
    };

    // Arranque de inputs mapeados a la sesión de juego pura
    this.inputSvc.iniciarEscuchaTeclado(this.motor3d.scene, {
      onToggleCamera: () => this.toggleCameraUser(),
      onInteractE: () => {
        const target = this.targetInteractuable();
        if (target && this.showToastE()) {
          if (target.type === 'bubble') {
            this.bubbleSvc.ejecutarBurbuja(target);
            const seqId = this.cameraView() === 'FPS' ? target.interaction.interactSequenceIdFPS : target.interaction.interactSequenceIdTPS;
            const seqReal = seqId || target.interaction.interactSequenceId;
            if (seqReal) {
               const allEntities = this.entityManager.getAllEntities();
               allEntities.forEach(e => {
                  if (e.playerConfig && e.playerConfig.sequences) {
                      const hasSeq = e.playerConfig.sequences.some((s: any) => s.id === seqReal);
                      if (hasSeq) this.sequenceSvc.iniciarSecuenciaEnJuego(seqReal, e);
                  }
               });
            }
          }
        }
      },
      onInteractI: () => {
        const target = this.targetInteractuable();
        if (target && this.showToastI()) {
          this.interactSvc.abrirMensajeInteractivo(target, () => {
             const pCtrl = this.controllers.get(playerEntity.uid);
             if (pCtrl) pCtrl.resetPhysicsState();
          });
        }
      }
    });

    // Orquestación y Spawn de Actores
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

    // Asegurar ratón cautivo del navegador
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      const handlePointerLockChange = () => {
        this.pointerLocked.set(!!document.pointerLockElement);
      };
      document.addEventListener('pointerlockchange', handlePointerLockChange);
      (this as any)._pointerLockListener = handlePointerLockChange; 
    }
  }

  public stop(): void {
    this.isPlaying.set(false);
    this.activePlayerEntity.set(null);
    this.isInteracting.set(false);
    this.pointerLocked.set(false);

    this.inputSvc.detenerEscuchaTeclado(this.motor3d.scene);
    this.objectAnimSvc.stopAmbientAutoAnimations();

    // Frenado de Controladores
    this.controllers.forEach(ctrl => ctrl.destroy());
    this.controllers.clear();

    // Limpieza de HUD UI
    this.hudMessage.set(null);
    this.showToastE.set(false);
    this.showToastI.set(false);
    this.targetInteractuable.set(null);
    this.hoveredMesh.set(null);

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
      (newView) => this.cameraView.set(newView),
      customFrames
    );
  }
}