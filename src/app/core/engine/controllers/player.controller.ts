// src/app/core/engine/controllers/player.controller.ts

import { Ray, Vector3, Quaternion } from '@babylonjs/core';
import { GamePhase } from '../behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from './character-context.interface';
import { GameEntity } from '../entities/game.entity';

export class PlayerController extends BaseCharacterController {
  
  private currentSeqRuntime: any;

  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public start(): void {
    // 🔥 PREVENIR AUTO-COLISIONES (Causa de temblores y atascos en el piso)
    this.mesh.checkCollisions = true;
    this.mesh.getChildMeshes().forEach(m => {
       m.checkCollisions = false;
    });

    // Pequeño empujón Y para no penetrar el suelo al spawnear
    this.mesh.position.y += 0.05;
    this.mesh.computeWorldMatrix(true);

    this.context.animSvc.sincronizarAnimaciones(this.context.motor3d.scene, this.entity);

    const playerAutoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (playerAutoSeq) {
        this.context.sequenceSvc.iniciarSecuenciaEnJuego(playerAutoSeq.id, this.entity);
    }

    this.resetAll();

    // 🔥 DELEGAMOS EL INPUT Y LA LÓGICA AL PLAYER
    this.context.inputSvc.iniciarEscuchaTeclado(this.context.motor3d.scene, {
      onToggleCamera: () => this.context.session.toggleCameraUser(),
      onAction: () => this.handleAction(),
      onInspect: () => this.handleInspect()
    });

    // Registro estricto de Fases
    this.context.loopManager.register(this.loopId + '_PHYSICS', GamePhase.PHYSICS, (dtMs: number) => this.physicsUpdate(dtMs));
    this.context.loopManager.register(this.loopId + '_LOGIC', GamePhase.LOGIC, (dtMs: number) => this.logicUpdate(dtMs));
    this.context.loopManager.register(this.loopId + '_POST', GamePhase.POST_UPDATE, (dtMs: number) => this.postUpdate(dtMs));
  }

  public override destroy(): void {
    this.context.inputSvc.detenerEscuchaTeclado(this.context.motor3d.scene);
    super.destroy();
  }

  public resetAll(): void {
    this.resetPhysicsState();
    this.context.inputSvc.resetearInputs();
    this.context.cameraSvc.resetearTransiciones();
    
    this.context.animSvc.detenerTodas(this.entity);
    this.context.animSvc.reproducirIdle(this.entity); 
  }

  private handleAction(): void {
    const target = this.context.interactSvc.currentTarget;
    if (target && this.context.interactSvc.canInteract) {
      if (target.type === 'bubble') {
        this.context.bubbleSvc.ejecutarBurbuja(target);
        const seqId = this.context.session.cameraView() === 'FPS' ? target.interaction.interactSequenceIdFPS : target.interaction.interactSequenceIdTPS;
        const seqReal = seqId || target.interaction.interactSequenceId;
        if (seqReal) {
           const allEntities = this.context.entityManager.getAllEntities();
           allEntities.forEach(e => {
              if (e.playerConfig && e.playerConfig.sequences) {
                  const hasSeq = e.playerConfig.sequences.some((s: any) => s.id === seqReal);
                  if (hasSeq) this.context.sequenceSvc.iniciarSecuenciaEnJuego(seqReal, e);
              }
           });
        }
      }
    }
  }

  private handleInspect(): void {
    const target = this.context.interactSvc.currentTarget;
    if (target && this.context.interactSvc.canInspect) {
      this.context.interactSvc.abrirMensajeInteractivo(target, () => {
         this.resetPhysicsState();
      });
    }
  }

  protected physicsUpdate(dtMs: number): void {
    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    this.currentSeqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    const vista = this.context.session.cameraView();

    const canMove = this.context.session.pointerLocked() && !this.currentSeqRuntime.lockInput && !this.currentSeqRuntime.freezeOrientation;
    const activeInput = canMove ? this.context.inputSvc.inputMap : {};

    // 1. Delegar las físicas puras a CharacterKinematics
    this.context.kinematicsSvc.updateKinematics(
      this.context.motor3d.scene,
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
    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;
    const vista = this.context.session.cameraView();

    this.context.triggerSvc.verificarTriggers(this.entity);
    this.context.interactSvc.comprobarInteracciones(this.entity, activeCamera, vista);
    
    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, this.currentSeqRuntime);
    
    this.context.cameraSvc.actualizarPosicionCamara(
      this.entity, 
      activeCamera, 
      this.estadoFisico, 
      this.currentSeqRuntime,
      vista
    );
    
    if (this.currentSeqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
      
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