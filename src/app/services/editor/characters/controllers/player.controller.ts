
import { GamePhase } from '../../../../core/engine/behaviors/services/loop-manager.service';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export class PlayerController extends BaseCharacterController {
  
  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public start(): void {
    this.context.animSvc.sincronizarAnimaciones(this.context.motor3d.scene, this.entity);

    const playerAutoSeq = this.config.sequences.find((s: any) => s.autoPlay);
    if (playerAutoSeq) {
        this.context.sequenceSvc.iniciarSecuenciaEnJuego(playerAutoSeq.id, this.entity);
    }

    this.resetAll();

    this.context.loopManager.register(this.loopId, GamePhase.LOGIC, (dtMs: number) => {
      this.update(dtMs);
    });
  }

  protected update(dtMs: number): void {
    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    const vista = this.context.session.cameraView();

    this.context.triggerSvc.verificarTriggers(this.entity);
    this.context.interactSvc.comprobarInteracciones(this.entity, activeCamera, vista);
    
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    const canMove = this.context.session.pointerLocked() && !seqRuntime.lockInput && !seqRuntime.freezeOrientation;
    const activeInput = canMove ? this.context.inputSvc.inputMap : {};

    this.context.physicsSvc.aplicarMovimientoYGravedad(
      this.entity, 
      activeInput, 
      seqRuntime, 
      activeCamera, 
      this.estadoFisico,
      vista
    );

    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, seqRuntime);
    
    this.context.cameraSvc.actualizarPosicionCamara(
      this.entity, 
      activeCamera, 
      this.estadoFisico, 
      seqRuntime,
      vista
    );
    
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
    }
  }

  public resetAll(): void {
    this.resetPhysicsState();
    this.context.inputSvc.resetearInputs();
    this.context.cameraSvc.resetearTransiciones();
    this.context.session.hoveredMesh.set(null);
    this.context.session.targetInteractuable.set(null);
    this.context.session.showToastE.set(false);
    this.context.session.showToastI.set(false);
    this.context.animSvc.detenerTodas(this.entity);
    this.context.animSvc.reproducirIdle(this.entity); 
  }
}