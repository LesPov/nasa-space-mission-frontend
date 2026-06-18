// src/app/core/engine/controllers/player.controller.ts

import { Injector } from '@angular/core';
import { Quaternion } from '@babylonjs/core';
import { GamePhase } from '../behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { GameEntity } from '../entities/game.entity';

// Servicios de Sistemas Inyectados Dinámicamente
import { Motor3dService } from '../../../services/motor-3d.service';
import { GameSession } from '../game-session';
import { PlayerInputService } from '../systems/player-input.service';
import { CharacterKinematicsService } from '../systems/character-kinematics.service';
import { PlayerSequenceService } from '../systems/player-sequence.service';
import { PlayerAnimationService } from '../systems/player-animation.service';
import { PlayerTriggerService } from '../systems/player-trigger.service';
import { PlayerInteractionService } from '../systems/player-interaction.service';
import { PlayerCameraManagerService } from '../systems/player-camera.service';
import { PlayerBubbleService } from '../systems/player-bubble.service';
import { EntityManagerService } from '../entities/entity-manager.service';

export class PlayerController extends BaseCharacterController {
  
  private currentSeqRuntime: any;

  // Dependencias propias del Jugador
  private motor3d: Motor3dService;
  private session: GameSession;
  private inputSvc: PlayerInputService;
  private kinematicsSvc: CharacterKinematicsService;
  private sequenceSvc: PlayerSequenceService;
  private animSvc: PlayerAnimationService;
  private triggerSvc: PlayerTriggerService;
  private interactSvc: PlayerInteractionService;
  private cameraSvc: PlayerCameraManagerService;
  private bubbleSvc: PlayerBubbleService;
  private entityManager: EntityManagerService;

  constructor(entity: GameEntity, injector: Injector) {
    super(entity, injector);
    
    // El Controlador obtiene sus propios sistemas de forma aislada
    this.motor3d = this.injector.get(Motor3dService);
    this.session = this.injector.get(GameSession);
    this.inputSvc = this.injector.get(PlayerInputService);
    this.kinematicsSvc = this.injector.get(CharacterKinematicsService);
    this.sequenceSvc = this.injector.get(PlayerSequenceService);
    this.animSvc = this.injector.get(PlayerAnimationService);
    this.triggerSvc = this.injector.get(PlayerTriggerService);
    this.interactSvc = this.injector.get(PlayerInteractionService);
    this.cameraSvc = this.injector.get(PlayerCameraManagerService);
    this.bubbleSvc = this.injector.get(PlayerBubbleService);
    this.entityManager = this.injector.get(EntityManagerService);
  }

  public start(): void {
    // 🔥 PREVENIR AUTO-COLISIONES (Causa de temblores y atascos en el piso)
    this.mesh.checkCollisions = true;
    this.mesh.getChildMeshes().forEach(m => m.checkCollisions = false);

    // Pequeño empujón Y para no penetrar el suelo al spawnear
    this.mesh.position.y += 0.05;
    this.mesh.computeWorldMatrix(true);

    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, this.entity);

    const playerAutoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (playerAutoSeq) {
        this.sequenceSvc.iniciarSecuenciaEnJuego(playerAutoSeq.id, this.entity);
    }

    this.resetAll();

    // 🔥 DELEGAMOS EL INPUT AL SERVICIO, PERO LA LÓGICA RETORNA AL CONTROLADOR
    this.inputSvc.iniciarEscuchaTeclado(this.motor3d.scene, {
      onToggleCamera: () => this.session.toggleCameraUser(),
      onAction: () => this.handleAction(),
      onInspect: () => this.handleInspect()
    });

    // Orquestación directa al LoopManager
    this.loopManager.register(this.loopId + '_PHYSICS', GamePhase.PHYSICS, (dtMs: number) => this.physicsUpdate(dtMs));
    this.loopManager.register(this.loopId + '_LOGIC', GamePhase.LOGIC, (dtMs: number) => this.logicUpdate(dtMs));
    this.loopManager.register(this.loopId + '_POST', GamePhase.POST_UPDATE, (dtMs: number) => this.postUpdate(dtMs));
  }

  public override destroy(): void {
    this.inputSvc.detenerEscuchaTeclado(this.motor3d.scene);
    this.animSvc.detenerTodas(this.entity);
    super.destroy(); // Elimina las suscripciones al LoopManager
  }

  public resetAll(): void {
    this.resetPhysicsState();
    this.inputSvc.resetearInputs();
    this.cameraSvc.resetearTransiciones();
    
    this.animSvc.detenerTodas(this.entity);
    this.animSvc.reproducirIdle(this.entity); 
  }

  private handleAction(): void {
    const target = this.interactSvc.currentTarget;
    if (target && this.interactSvc.canInteract) {
      if (target.type === 'bubble') {
        this.bubbleSvc.ejecutarBurbuja(target);
        const seqId = this.session.cameraView() === 'FPS' ? target.interaction.interactSequenceIdFPS : target.interaction.interactSequenceIdTPS;
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
  }

  private handleInspect(): void {
    const target = this.interactSvc.currentTarget;
    if (target && this.interactSvc.canInspect) {
      this.interactSvc.abrirMensajeInteractivo(target, () => {
         this.resetPhysicsState();
      });
    }
  }

  protected physicsUpdate(dtMs: number): void {
    const activeCamera = this.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    this.currentSeqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    const vista = this.session.cameraView();

    const canMove = this.session.pointerLocked() && !this.currentSeqRuntime.lockInput && !this.currentSeqRuntime.freezeOrientation;
    const activeInput = canMove ? this.inputSvc.inputMap : {};

    // 1. Delegar las físicas puras a CharacterKinematics (Sistema agnóstico)
    this.kinematicsSvc.updateKinematics(
      this.motor3d.scene,
      this.mesh,
      this.entity,
      this.estadoFisico,
      activeInput,
      this.currentSeqRuntime,
      activeCamera,
      vista,
      dtMs
    );

    // 2. Extraemos el resultado matemático, la Entidad Lógica es la única FUENTE DE VERDAD
    this.entity.transform.position.x = this.mesh.position.x;
    this.entity.transform.position.y = this.mesh.position.y;
    this.entity.transform.position.z = this.mesh.position.z;
    
    if (this.mesh.rotationQuaternion) {
       const euler = this.mesh.rotationQuaternion.toEulerAngles();
       this.entity.transform.rotation.x = euler.x;
       this.entity.transform.rotation.y = euler.y;
       this.entity.transform.rotation.z = euler.z;
    } else {
       this.entity.transform.rotation.x = this.mesh.rotation.x;
       this.entity.transform.rotation.y = this.mesh.rotation.y;
       this.entity.transform.rotation.z = this.mesh.rotation.z;
    }
  }

  protected logicUpdate(dtMs: number): void {
    const activeCamera = this.motor3d.scene.activeCamera;
    if (!activeCamera) return;
    const vista = this.session.cameraView();

    // El PlayerController evalúa su relación lógica con el mundo
    this.triggerSvc.verificarTriggers(this.entity);
    this.interactSvc.comprobarInteracciones(this.entity, activeCamera, vista);
    
    this.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, this.currentSeqRuntime);
    
    this.cameraSvc.actualizarPosicionCamara(
      this.entity, 
      activeCamera, 
      this.estadoFisico, 
      this.currentSeqRuntime,
      vista
    );
    
    if (this.currentSeqRuntime.freezeOrientation) {
      this.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
      
      // Sincronizamos la sobreescritura de vuelta hacia la Entidad
      if (this.mesh.rotationQuaternion) {
        const euler = this.mesh.rotationQuaternion.toEulerAngles();
        this.entity.transform.rotation.x = euler.x;
        this.entity.transform.rotation.y = euler.y;
        this.entity.transform.rotation.z = euler.z;
      }
    }
  }

  protected postUpdate(dtMs: number): void {
    // 3. Sincronización Final: La Malla obedece a la Entidad y se rinde visualmente.
    this.entity.syncToView();
  }
}