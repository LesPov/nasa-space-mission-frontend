import { Injectable, inject, signal } from '@angular/core';
import { Mesh, StandardMaterial, VideoTexture, Color3, UniversalCamera, Vector3, AbstractMesh, MeshBuilder } from '@babylonjs/core';
import { Motor3dService } from '../../services/motor-3d.service';
import { EntityManagerService } from './entities/entity-manager.service';
import { LoopManagerService, GamePhase } from './behaviors/services/loop-manager.service';
import { GameEntity } from './entities/game.entity';

import { CharacterContext } from '../../services/editor/characters/character-context.interface';
import { PlayerController } from '../../services/editor/characters/controllers/player.controller';
import { NpcController } from '../../services/editor/characters/controllers/npc.controller';

import { PlayerAnimationService } from '../../services/editor/playerservice/player-animation.service';
import { PlayerCameraManagerService } from '../../services/editor/playerservice/player-camera.service';
import { PlayerInputService } from '../../services/editor/playerservice/player-input.service';
import { PlayerInteractionService } from '../../services/editor/playerservice/player-interaction.service';
import { PlayerPhysicsService } from '../../services/editor/playerservice/player-physics.service';
import { PlayerSequenceService } from '../../services/editor/playerservice/player-sequence.service';
import { PlayerTriggerService } from '../../services/editor/player-trigger.service';
import { PlayerBubbleService } from '../../services/editor/playerservice/player-bubble';
import { ObjectAnimationService } from '../../services/editor/object-animation.service';

@Injectable({ providedIn: 'root' })
export class GameSession {
  private motor3d = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private loopManager = inject(LoopManagerService);

  private inputSvc = inject(PlayerInputService);
  private physicsSvc = inject(PlayerPhysicsService);
  private animSvc = inject(PlayerAnimationService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private sequenceSvc = inject(PlayerSequenceService);
  private triggerSvc = inject(PlayerTriggerService);
  private bubbleSvc = inject(PlayerBubbleService);
  private autoAnimSvc = inject(ObjectAnimationService);

  // ESTADO DE LA SESIÓN DE JUEGO (Agnóstico del Editor)
  public isPlaying = signal<boolean>(false);
  public isInteracting = signal<boolean>(false);
  public pointerLocked = signal<boolean>(false);
  public cameraView = signal<'FPS' | 'TPS'>('TPS');
  public activePlayerEntity = signal<GameEntity | null>(null);
  public isAdminSession = signal<boolean>(false); 

  // HUD / Interfaz
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);
  public showToastE = signal<boolean>(false);
  public showToastI = signal<boolean>(false);
  public hudMessage = signal<string | null>(null);

  // Físicas en Runtime
  public proxyColliders: Mesh[] = [];

  private activePlayerController: PlayerController | null = null;
  private activeNpcControllers: NpcController[] = [];

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked.set(!!document.pointerLockElement);
      if (!this.pointerLocked() && this.isPlaying() && !this.isInteracting()) {
         this.resetPlayerMovement();
      }
    });
  }

  private getContext(): CharacterContext {
    return {
      motor3d: this.motor3d,
      session: this, // LA SESIÓN ES LA FUENTE DE VERDAD DE RUNTIME
      animSvc: this.animSvc,
      physicsSvc: this.physicsSvc,
      sequenceSvc: this.sequenceSvc,
      inputSvc: this.inputSvc,
      cameraSvc: this.playerCamSvc,
      interactSvc: this.interactSvc,
      triggerSvc: this.triggerSvc,
      bubbleSvc: this.bubbleSvc,
      loopManager: this.loopManager
    };
  }

  public start(playerEntity: GameEntity, initialView: 'FPS'|'TPS', isAdmin: boolean) {
    this.isAdminSession.set(isAdmin);
    this.cameraView.set(initialView);
    this.activePlayerEntity.set(playerEntity);
    this.isPlaying.set(true);
    this.isInteracting.set(false);

    this.crearProxysDeColision(playerEntity.view as Mesh);

    const context = this.getContext();

    this.activePlayerController = new PlayerController(playerEntity, context);
    
    this.activeNpcControllers = [];
    this.entityManager.getEntitiesByRol('npc').forEach(npcEntity => {
      if (npcEntity.uid === playerEntity.uid) return;
      this.activeNpcControllers.push(new NpcController(npcEntity, context));
    });

    this.autoAnimSvc.startAmbientAutoAnimations();
    this.triggerSvc.prepararTriggersParaJuego();

    this.inputSvc.iniciarEscuchaTeclado(this.motor3d.scene, {
      onToggleCamera: () => this.toggleCameraUser(false),
      onInteractE: () => this.handleInteractions(true),
      onInteractI: () => this.handleInteractions(false)
    });

    this.activePlayerController.start();
    this.activeNpcControllers.forEach(c => c.start());

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
       this.motor3d.scene.activeCamera!.attachControl(canvas, true); 
       if (!isAdmin) {
           canvas.focus(); 
           try { const p = canvas.requestPointerLock(); if(p) p.catch(()=>{}); } catch {} 
       }
    }
  }

  public stop() {
    this.isPlaying.set(false);
    
    if (this.activePlayerController) this.activePlayerController.destroy();
    this.activeNpcControllers.forEach(c => c.destroy());
    
    this.activePlayerController = null;
    this.activeNpcControllers = [];

    this.sequenceSvc.resetearSecuencias(); 
    this.animSvc.detenerTodasGlobal();
    this.animSvc.limpiarEstados(); 
    this.autoAnimSvc.stopAmbientAutoAnimations();

    this.inputSvc.detenerEscuchaTeclado(this.motor3d.scene);
    this.resetPlayerMovement();
    
    this.proxyColliders.forEach(p => p.dispose()); 
    this.proxyColliders = [];

    this.targetInteractuable.set(null);
    this.hoveredMesh.set(null);
    this.showToastE.set(false);
    this.showToastI.set(false);
    this.hudMessage.set(null);
    this.activePlayerEntity.set(null);
  }

  public toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number) {
    if (this.activePlayerEntity() && this.activePlayerController) {
      this.playerCamSvc.toggleCameraView(
        this.activePlayerController.entity,
        this.cameraView(),
        isCinematicInitial,
        true,
        (newVista) => { this.cameraView.set(newVista); },
        customFrames
      );
    }
  }

  public resetPlayerMovement() {
    if (this.activePlayerController) {
      this.activePlayerController.resetAll();
    } else {
      this.inputSvc.resetearInputs();
      this.playerCamSvc.resetearTransiciones();
      this.targetInteractuable.set(null);
      this.showToastE.set(false);
      this.showToastI.set(false);
      const entity = this.activePlayerEntity();
      if (entity) {
        this.animSvc.detenerTodas(entity);
        this.animSvc.reproducirIdle(entity);
      }
    }
  }

  private handleInteractions(isActionE: boolean): void {
    const targetEntity = this.targetInteractuable();
    if (!targetEntity || !this.interactSvc.canActivateInteraction(targetEntity, this.cameraView())) return;

    if (isActionE) {
      if (targetEntity.isProcessingAction) return;

      let seqIdString = this.cameraView() === 'FPS' ? targetEntity.interaction.interactSequenceIdFPS : targetEntity.interaction.interactSequenceIdTPS;
      if (!seqIdString) seqIdString = targetEntity.interaction.interactSequenceId;
      const ids = seqIdString ? seqIdString.split(',').map(id => id.trim()).filter(Boolean) : [];

      if (targetEntity.type === 'bubble') {
        this.bubbleSvc.ejecutarBurbuja(targetEntity);
        if (ids.length > 0) this.executeSequenceFromIds(targetEntity, ids);
      } else {
        if (targetEntity.type === 'video_plane') {
            const mesh = targetEntity.view as Mesh;
            if (mesh && !mesh.metadata?.isPoweredOn) return; 
            if (ids.length === 0) {
                if (mesh?.material instanceof StandardMaterial) {
                    const tex = mesh.material.diffuseTexture;
                    if (tex instanceof VideoTexture) {
                        if (tex.video.paused) {
                            tex.video.play();
                            mesh.material.emissiveColor = new Color3(1, 1, 1);
                        } else {
                            tex.video.pause();
                            mesh.material.emissiveColor = new Color3(0.3, 0.3, 0.3); 
                        }
                    }
                }
                return; 
            }
        }
        if (ids.length > 0) this.executeSequenceFromIds(targetEntity, ids);
      }
    } else {
        this.interactSvc.abrirMensajeInteractivo(targetEntity, () => this.resetPlayerMovement());
    }
  }

  private executeSequenceFromIds(targetEntity: GameEntity, ids: string[]): void {
      targetEntity.isProcessingAction = true;
      const idxKey = this.cameraView() === 'FPS' ? 'currentSeqIdxFPS' : 'currentSeqIdxTPS';
      let idx = (targetEntity.view?.metadata as any)?.[idxKey] || 0;
      if (idx >= ids.length) idx = 0;
      const idToPlay = ids[idx];

      const triggerAction = () => {
         this.entityManager.getAllEntities().forEach(e => {
             if (e.playerConfig?.sequences?.some((s: any) => s.id === idToPlay)) {
                 this.sequenceSvc.iniciarSecuenciaEnJuego(idToPlay, e);
             }
         });
         targetEntity.isProcessingAction = false;
         if (targetEntity.view?.metadata) {
             (targetEntity.view.metadata as any)[idxKey] = (idx + 1) % ids.length;
         }
      };

      if (targetEntity.type === 'bubble') {
          setTimeout(triggerAction, 500);
      } else {
          triggerAction();
      }
  }

  private crearProxysDeColision(jugador: Mesh): void {
    const scene = this.motor3d.scene;
    scene.meshes.forEach(m => {
      if (m === jugador) return;
      if (m.name.includes('debug') || m.name.includes('gizmo') || m.name.includes('cameraPivot') || m.name.includes('sueloInvisible') || m.name.includes('proxyCol')) return;
      
      const entity = this.entityManager.getEntityByMesh(m as AbstractMesh);
      if (!entity) return;

      if (entity.visual.isSolid) {
        if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') return;

        const colMeta = entity.collider;
        if (colMeta && colMeta.type !== 'mesh' && m === entity.view) {
          m.checkCollisions = false;
          m.getChildMeshes().forEach(c => { c.checkCollisions = false; });
          
          let proxy: Mesh;
          if (colMeta.type === 'capsule') proxy = MeshBuilder.CreateCapsule(`proxyCol_${m.name}`, { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
          else if (colMeta.type === 'sphere') proxy = MeshBuilder.CreateSphere(`proxyCol_${m.name}`, { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
          else proxy = MeshBuilder.CreateBox(`proxyCol_${m.name}`, { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);
          
          proxy.parent = m; proxy.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
          proxy.isVisible = false; proxy.checkCollisions = true;
          this.proxyColliders.push(proxy);
        }
      }
    });
  }
}