import { Mesh } from '@babylonjs/core';
import { BaseCharacterController } from './base-character.controller';
import { CharacterContext } from '../character-context.interface';
 
export class PlayerController extends BaseCharacterController {
  
  constructor(mesh: Mesh, context: CharacterContext) {
    super(mesh, context);
  }

  public update(dtMs: number): void {
    // Si el ratón no está bloqueado, el jugador está en el menú pausa, no procesamos lógicas
    if (!this.context.state.ratonBloqueado()) return;

    const activeCamera = this.context.motor3d.scene.activeCamera;
    if (!activeCamera) return;

    const colMeta = this.mesh.metadata?.collider || { offsetY: 0.9 };
    const camMeta = this.mesh.metadata?.camOffset || { x: 0, y: 1.6, z: 0 };
    const vista = this.context.state.modoVistaPrueba || 'TPS';

    // 1. Lógica de Triggers y Burbujas
    this.context.triggerSvc.verificarTriggers(this.mesh);
    this.context.interactSvc.comprobarInteracciones(this.mesh, activeCamera, colMeta, vista);
    
    // 2. Calcular Secuencias activas para el Player
    const seqRuntime = this.context.sequenceSvc.actualizarSecuencia(dtMs, this.mesh, this.config);
    
    // 3. Obtener el Input (Vacio si hay secuencia bloqueante)
    const activeInput = (seqRuntime.lockInput || seqRuntime.freezeOrientation) ? {} : this.context.inputSvc.inputMap;

    // 4. Procesar Físicas y Colisiones REAles
    // Pasamos this.estadoFisico para que el servicio lo mute directamente
    this.context.physicsSvc.aplicarMovimientoYGravedad(
      this.mesh, 
      activeInput, 
      seqRuntime, 
      activeCamera, 
      colMeta, 
      this.mesh.scaling, 
      this.config,
      this.estadoFisico 
    );

    // 5. Reproducir animaciones según las físicas
    this.context.animSvc.gestionarAnimaciones(this.mesh, this.estadoFisico, seqRuntime, this.config);
    
    // 6. Actualizar seguimiento de Cámara
    this.context.cameraSvc.actualizarPosicionCamara(
      this.mesh, 
      activeCamera, 
      this.estadoFisico, 
      seqRuntime, 
      colMeta, 
      camMeta, 
      this.mesh.scaling, 
      this.config
    );
    
    // 7. Congelar orientación si estamos trepando/cinemática
    if (seqRuntime.freezeOrientation) {
      this.context.sequenceSvc.applyLockedOrientationWhileSequence(this.mesh);
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
    this.context.animSvc.detenerTodas(this.mesh);
    this.context.animSvc.reproducirIdle(this.mesh); 
  }
}