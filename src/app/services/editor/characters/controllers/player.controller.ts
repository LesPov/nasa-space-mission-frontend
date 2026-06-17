
import { Vector3 } from '@babylonjs/core';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
 
export class PlayerController extends BaseCharacterController {
  
  constructor(entity: GameEntity, context: CharacterContext) {
    super(entity, context);
  }

  public update(dtMs: number): void {
    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    const vista = this.context.state.modoVistaPrueba || 'TPS';

    // 1. Lógica de Triggers y Burbujas
    this.context.triggerSvc.verificarTriggers(this.entity);
    this.context.interactSvc.comprobarInteracciones(this.entity, activeCamera, vista);
    
    // 2. Calcular Secuencias activas para el Player
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.entity);
    
    // 3. Obtener el Input
    const canMove = this.context.state.ratonBloqueado() && !seqRuntime.lockInput && !seqRuntime.freezeOrientation;
    const activeInput = canMove ? this.context.inputSvc.inputMap : {};

    // 4. Procesar Físicas y Colisiones REAles
    this.context.physicsSvc.aplicarMovimientoYGravedad(
      this.entity, 
      activeInput, 
      seqRuntime, 
      activeCamera, 
      this.estadoFisico 
    );

    // 5. Reproducir animaciones según las físicas
    this.context.animSvc.gestionarAnimaciones(this.entity, this.estadoFisico, seqRuntime);
    
    // 6. Actualizar seguimiento de Cámara
    this.context.cameraSvc.actualizarPosicionCamara(
      this.entity, 
      activeCamera, 
      this.estadoFisico, 
      seqRuntime
    );
    
    // 7. Congelar orientación si estamos trepando/cinemática
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.entity);
    }
  }

  public resetAll(): void {
    this.resetPhysicsState();
    this.context.inputSvc.resetearInputs();
    this.context.cameraSvc.resetearTransiciones();
    this.context.state.mirandoObjetoInteractuable.set(false);
    this.context.state.targetInteractuable.set(null);
    this.context.state.showToastE.set(false);
    this.context.state.showToastI.set(false);
    this.context.animSvc.detenerTodas(this.entity);
    this.context.animSvc.reproducirIdle(this.entity); 
  }
}  