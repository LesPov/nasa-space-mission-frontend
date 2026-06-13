import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Scene, Observer, Vector3, Quaternion, MeshBuilder } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig, mergePlayerConfig } from './player-config.model';

import { PlayerAnimationService } from './playerservice/player-animation.service';
import { PlayerCameraManagerService } from './playerservice/player-camera.service';
import { PlayerInputService } from './playerservice/player-input.service';
import { PlayerInteractionService } from './playerservice/player-interaction.service';
import { PlayerPhysicsService } from './playerservice/player-physics.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';
import { PlayerTriggerService } from './player-trigger.service';

@Injectable({ providedIn: 'root' })
export class EditorPlayerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);

  private inputSvc = inject(PlayerInputService);
  private physicsSvc = inject(PlayerPhysicsService);
  private animSvc = inject(PlayerAnimationService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private sequenceSvc = inject(PlayerSequenceService);
  private triggerSvc = inject(PlayerTriggerService);

  public playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
  private tpsUpdateObserver: Observer<Scene> | null = null;
  private previewObserver: Observer<Scene> | null = null;
  private npcsYPropsAnimados: Mesh[] = [];
  
  private backupsAnimados: any[] = [];

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      const isLocked = !!document.pointerLockElement;
      this.state.ratonBloqueado.set(isLocked);
      if (!isLocked) {
        const stateStr = this.state.playState();
        if (stateStr === 'PLAYING' || stateStr === 'EDITING_IN_GAME' || stateStr === 'TRANSITIONING' || stateStr === 'INTERACTING') {
          this.resetMovimientoJugador();
        }
      }
    });
  }

  public iniciarModoJuego(vista: 'FPS' | 'TPS'): void {
    this.detenerPreviewSecuencia();

    const obj = this.state.objetoSeleccionado() as Mesh;
    if (!obj) return;
    this.cameraSvc.guardarEstadoCamaraLibre();

    this.state.playState.set('PLAYING');
    this.state.jugadorActivo = obj;
    this.state.modoVistaPrueba = vista;
    this.state.objetoHovereado.set(null);

    this.state.backupObjetoPosicion = obj.position.clone();
    if (obj.rotationQuaternion) this.state.backupObjetoRotacionQuat = obj.rotationQuaternion.clone();
    else {
      this.state.backupObjetoRotacionQuat = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
      obj.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
    }
    this.state.backupObjetoVisibilidad = obj.isVisible;
    this.state.backupColisionJugador = obj.checkCollisions;
    this.state.backupColisionesHijos = [];
    obj.getChildMeshes().forEach((m: AbstractMesh) => {
      this.state.backupColisionesHijos.push({ mesh: m, col: m.checkCollisions });
      m.checkCollisions = false;
    });
    obj.checkCollisions = true;
    this.state.objetoSeleccionado.set(null);

    this.crearProxysDeColision(obj);

    this.npcsYPropsAnimados = [];
    this.backupsAnimados = []; 
    
    this.motor3d.scene.meshes.forEach(m => {
        if (m !== obj && m.metadata?.playerConfig?.sequences && m.metadata.playerConfig.sequences.length > 0) {
            this.npcsYPropsAnimados.push(m as Mesh);
            
            const lightObj = m.getDescendants(false).find(c => c.name.startsWith('l_'));
            this.backupsAnimados.push({
                mesh: m as Mesh,
                pos: m.position.clone(),
                rot: m.rotation.clone(),
                rotQ: m.rotationQuaternion ? m.rotationQuaternion.clone() : null,
                intensity: lightObj ? (lightObj as any).intensity : null
            });

            this.animSvc.sincronizarAnimaciones(this.motor3d.scene, m as Mesh, mergePlayerConfig(m.metadata.playerConfig));
        }
    });

    this.motor3d.scene.meshes.forEach(m => {
        if (m.metadata?.type?.startsWith('light_') && !m.metadata?.assetId) {
            m.isVisible = false;
        }
    });

    this.playerConfig = mergePlayerConfig(obj.metadata?.playerConfig || null);

    const colMeta = obj.metadata?.collider || { sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 };
    const camMeta = obj.metadata?.camOffset || { x: 0, y: 1.6, z: 0 };

    obj.ellipsoid = new Vector3(colMeta.sizeX * obj.scaling.x, colMeta.sizeY * obj.scaling.y, colMeta.sizeZ * obj.scaling.z);
    obj.ellipsoidOffset = new Vector3(colMeta.offsetX * obj.scaling.x, colMeta.offsetY * obj.scaling.y, colMeta.offsetZ * obj.scaling.z);

    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, obj, this.playerConfig);
    
    this.state.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.scene);
    this.state.cameraPivot.isVisible = false;
    this.playerCamSvc.inicializarCamaras(obj, colMeta, camMeta, vista, obj.scaling, this.playerConfig);

    this.resetMovimientoJugador();
    
    this.triggerSvc.prepararTriggersParaJuego();

    this.inputSvc.iniciarEscuchaTeclado(this.motor3d.scene, {
      onToggleCamera: () => this.playerCamSvc.toggleCameraView(obj, this.playerConfig),
      onInteractE: () => {
        const target = this.state.targetInteractuable();
        if (target && this.interactSvc.canActivateInteraction(target, this.state.modoVistaPrueba)) {
          let seqId = this.state.modoVistaPrueba === 'FPS' ? target.metadata?.interactSequenceIdFPS : target.metadata?.interactSequenceIdTPS;
          if (!seqId) seqId = target.metadata?.interactSequenceId;
          if (seqId) {
            const ids = seqId.split(',').map((id: string) => id.trim()).filter(Boolean);
            if (ids.length > 0) {
              const idxKey = this.state.modoVistaPrueba === 'FPS' ? 'currentSeqIdxFPS' : 'currentSeqIdxTPS';
              let idx = target.metadata[idxKey] || 0;
              if (idx >= ids.length) idx = 0;
              this.sequenceSvc.iniciarSecuenciaEnJuego(ids[idx], obj, this.playerConfig);
              target.metadata[idxKey] = (idx + 1) % ids.length;
            }
          }
        }
      },
      onInteractI: () => {
        const target = this.state.targetInteractuable();
        if (target && this.interactSvc.canActivateInteraction(target, this.state.modoVistaPrueba)) {
          const cloneData = { name: target.name, metadata: { mensaje: target.metadata?.mensaje || '' } };
          this.interactSvc.abrirMensajeInteractivo(cloneData as any, () => this.resetMovimientoJugador());
        }
      }
    });

    this.iniciarBuclePrincipal(obj, colMeta, camMeta);
    this.state.triggerUpdate();
  }

  private iniciarBuclePrincipal(jugador: Mesh, colMeta: any, camMeta: any): void {
    const scene = this.motor3d.scene;
    this.tpsUpdateObserver = scene.onBeforeRenderObservable.add(() => {
      if (!this.state.jugadorActivo || this.state.playState() !== 'PLAYING' || !this.state.ratonBloqueado()) return;

      const activeCamera = scene.activeCamera;
      const dtMs = scene.getEngine().getDeltaTime();
      this.playerConfig = mergePlayerConfig(jugador.metadata?.playerConfig || null);

      this.triggerSvc.verificarTriggers(jugador);
      this.interactSvc.comprobarInteracciones(jugador, activeCamera, colMeta, this.state.modoVistaPrueba || 'TPS');
      
      const seqRuntime = this.sequenceSvc.actualizarSecuencia(dtMs, jugador, this.playerConfig);
      
      const estadoFisico = this.physicsSvc.aplicarMovimientoYGravedad(
        jugador, 
        seqRuntime.lockInput || seqRuntime.freezeOrientation ? {} : this.inputSvc.inputMap, 
        seqRuntime, 
        activeCamera, 
        colMeta, 
        jugador.scaling, 
        this.playerConfig
      );

      this.animSvc.gestionarAnimaciones(jugador, estadoFisico, seqRuntime, this.playerConfig);
      
      this.playerCamSvc.actualizarPosicionCamara(jugador, activeCamera, estadoFisico, seqRuntime, colMeta, camMeta, jugador.scaling, this.playerConfig);
      
      if (seqRuntime.freezeOrientation) this.sequenceSvc.applyLockedOrientationWhileSequence(jugador);

      this.npcsYPropsAnimados.forEach(npc => {
          const npcConfig = mergePlayerConfig(npc.metadata?.playerConfig || null);
          const npcSeq = this.sequenceSvc.actualizarSecuencia(dtMs, npc, npcConfig);
          
          const npcStateFisico = { 
              isMoving: false, isRunning: false, isGrounded: true, isJumping: false, 
              isFalling: false, isHardLanding: false, isRecoveringFromFall: false, 
              landingFrame: 0, recoveryFrame: 0, velocidadY: 0 
          };
          
          if (npcSeq.running && npcSeq.step) {
               const soY = npcSeq.step.offsetY || 0;
               const soF = npcSeq.step.offsetForward || 0;
               if (soY !== 0 || soF !== 0) {
                   const durSec = Math.max(0.001, npcSeq.step.durationMs / 1000);
                   const dy = (soY / durSec) * (dtMs / 1000);
                   const df = (soF / durSec) * (dtMs / 1000);
                   npc.position.y += dy;
                   const fwd = npc.getDirection(Vector3.Forward());
                   fwd.y = 0; fwd.normalize();
                   npc.position.addInPlace(fwd.scale(df));
                   npcStateFisico.isMoving = true;
               }
          }
          
          this.animSvc.gestionarAnimaciones(npc, npcStateFisico, npcSeq, npcConfig);
          if (npcSeq.freezeOrientation) this.sequenceSvc.applyLockedOrientationWhileSequence(npc);
      });
    });

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) { 
        canvas.focus(); 
        try { 
            scene.activeCamera!.attachControl(canvas, true); 
            const p = canvas.requestPointerLock(); 
            if (p) p.catch(() => {});
        } catch {} 
    }
  }

  public detenerModoJuego(): void {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');
    this.resetMovimientoJugador();
    this.animSvc.detenerTodasGlobal();

    this.triggerSvc.restaurarTriggersParaEditor();

    this.backupsAnimados.forEach(b => {
        if (b.mesh && !b.mesh.isDisposed()) {
            b.mesh.position.copyFrom(b.pos);
            if (b.rotQ) {
                if (!b.mesh.rotationQuaternion) b.mesh.rotationQuaternion = Quaternion.Identity();
                b.mesh.rotationQuaternion.copyFrom(b.rotQ);
            } else {
                b.mesh.rotationQuaternion = null;
                b.mesh.rotation.copyFrom(b.rot);
            }
            if (b.intensity !== null) {
                const lightObj = b.mesh.getDescendants(false).find((c: any) => c.name.startsWith('l_'));
                if (lightObj) (lightObj as any).intensity = b.intensity;
            }
        }
    });
    this.backupsAnimados = [];

    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';
    this.motor3d.scene.meshes.forEach(m => {
        if (m.metadata?.type?.startsWith('light_') && !m.metadata?.assetId) {
            m.isVisible = isAdmin;
        }
    });

    this.playerCamSvc.restaurarCamaraEditor();
    
    if (this.state.cameraPivot) { this.state.cameraPivot.dispose(); this.state.cameraPivot = null; }
    
    this.inputSvc.detenerEscuchaTeclado(scene);
    if (this.tpsUpdateObserver) { scene.onBeforeRenderObservable.remove(this.tpsUpdateObserver); this.tpsUpdateObserver = null; }
    this.state.proxyColliders.forEach(p => p.dispose()); this.state.proxyColliders = [];

    this.state.objetoHovereado.set(null); 
    this.state.mirandoObjetoInteractuable.set(false); 
    this.state.objetoSeleccionado.set(null);

    if (this.state.jugadorActivo && this.state.backupObjetoPosicion && this.state.backupObjetoRotacionQuat) {
      if (this.state.jugadorActivo.metadata?.rol === 'npc' || this.state.jugadorActivo.metadata?.rol === 'spawn_point') {
        if (this.state.modoVistaPrueba === 'FPS') this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(0, (this.motor3d.playerCameraFPS as any).rotation.y, 0);
        this.state.triggerUpdate();
      } else {
        this.state.jugadorActivo.position = this.state.backupObjetoPosicion;
        this.state.jugadorActivo.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
      }
      this.state.jugadorActivo.isVisible = this.state.backupObjetoVisibilidad;
      this.state.jugadorActivo.checkCollisions = this.state.backupColisionJugador;
      this.state.backupColisionesHijos.forEach(item => { if (item.mesh) item.mesh.checkCollisions = item.col; });
      this.state.backupColisionesHijos = [];
    }
    
    if (this.state.jugadorActivo) this.state.objetoSeleccionado.set(this.state.jugadorActivo);
    this.state.jugadorActivo = null; 
    this.state.backupObjetoPosicion = null; 
    this.state.backupObjetoRotacionQuat = null; 
    this.state.modoVistaPrueba = null;
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      this.motor3d.editorCamera.attachControl(canvas, true);
    }
    this.state.triggerUpdate();
  }

  public iniciarPreviewSecuencia(mesh: AbstractMesh, sequenceId: string) {
    this.detenerPreviewSecuencia();
    const trueMesh = mesh as Mesh;
    this.playerConfig = mergePlayerConfig(trueMesh.metadata?.playerConfig || null);
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, trueMesh, this.playerConfig);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, trueMesh, this.playerConfig);

    this.previewObserver = this.motor3d.scene.onBeforeRenderObservable.add(() => {
      const dtMs = this.motor3d.scene.getEngine().getDeltaTime();
      const runtime = this.sequenceSvc.actualizarSecuencia(dtMs, trueMesh, this.playerConfig);
      
      if (runtime.running && runtime.step) {
        const override = this.animSvc.resolveSequenceStepAnimation(trueMesh, runtime.step);
        if (override) { override.speedRatio = runtime.step.speedRatio || 1; this.animSvc.playAnim(trueMesh, override, runtime.loop, runtime.blend); }
      } else if (!runtime.running) this.animSvc.reproducirIdle(trueMesh);
    });
  }

  public detenerPreviewSecuencia() {
    if (this.previewObserver) { this.motor3d.scene.onBeforeRenderObservable.remove(this.previewObserver); this.previewObserver = null; }
    this.sequenceSvc.resetearSecuencias();
    this.animSvc.detenerTodasGlobal();
  }
 
  public resetMovimientoJugador(): void {
    this.inputSvc.resetearInputs();
    this.physicsSvc.resetearFisicas();
    this.sequenceSvc.resetearSecuencias();
    this.playerCamSvc.resetearTransiciones();
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.targetInteractuable.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    if (this.state.jugadorActivo) {
        // 🔥 FIX VITAL: Forzar detención de animaciones preexistentes para evitar bloqueos
        this.animSvc.detenerTodas(this.state.jugadorActivo);
        this.animSvc.reproducirIdle(this.state.jugadorActivo); 
    }
  }

  private crearProxysDeColision(jugador: Mesh): void {
    const scene = this.motor3d.scene;
    scene.meshes.forEach(m => {
      if (m === jugador) return;
      if (m.name.includes('debug') || m.name.includes('gizmo') || m.name.includes('cameraPivot') || m.name.includes('sueloInvisible') || m.name.includes('proxyCol') || m.metadata?.type === 'trigger') return;

      const root = this.state.encontrarRaiz(m as AbstractMesh);
      if (root && root instanceof AbstractMesh && root.metadata?.isSolid) {
        const colMeta = root.metadata.collider;
        if (colMeta && colMeta.type !== 'mesh' && m === root) {
          this.state.backupColisionesHijos.push({ mesh: m, col: m.checkCollisions });
          m.checkCollisions = false;
          m.getChildMeshes().forEach(c => { this.state.backupColisionesHijos.push({ mesh: c as AbstractMesh, col: c.checkCollisions }); c.checkCollisions = false; });
          
          let proxy: Mesh;
          if (colMeta.type === 'capsule') proxy = MeshBuilder.CreateCapsule(`proxyCol_${root.name}`, { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
          else if (colMeta.type === 'sphere') proxy = MeshBuilder.CreateSphere(`proxyCol_${root.name}`, { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
          else proxy = MeshBuilder.CreateBox(`proxyCol_${root.name}`, { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);
          
          proxy.parent = root; proxy.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
          proxy.isVisible = false; proxy.checkCollisions = true;
          this.state.proxyColliders.push(proxy);
        }
      }
    });
  }
}