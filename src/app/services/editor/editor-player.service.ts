
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Vector3, Quaternion, MeshBuilder, StandardMaterial, VideoTexture, Color3 } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { PlayerRuntimeConfig, mergePlayerConfig } from './player-config.model';

import { PlayerAnimationService } from './playerservice/player-animation.service';
import { PlayerCameraManagerService } from './playerservice/player-camera.service';
import { PlayerInputService } from './playerservice/player-input.service';
import { PlayerInteractionService } from './playerservice/player-interaction.service';
import { PlayerPhysicsService } from './playerservice/player-physics.service';
import { PlayerSequenceService } from './playerservice/player-sequence.service';
import { PlayerTriggerService } from './player-trigger.service';
import { PlayerBubbleService } from './playerservice/player-bubble';
import { ObjectAnimationService } from './object-animation.service';
import { LoopManagerService, GamePhase } from '../../core/engine/behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

import { CharacterContext } from './characters/character-context.interface';
import { PlayerController } from './characters/controllers/player.controller';
import { NpcController } from './characters/controllers/npc.controller';

@Injectable({ providedIn: 'root' })
export class EditorPlayerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);

  private inputSvc = inject(PlayerInputService);
  private physicsSvc = inject(PlayerPhysicsService);
  private animSvc = inject(PlayerAnimationService);
  private playerCamSvc = inject(PlayerCameraManagerService);
  private interactSvc = inject(PlayerInteractionService);
  private sequenceSvc = inject(PlayerSequenceService);
  private triggerSvc = inject(PlayerTriggerService);
  private bubbleSvc = inject(PlayerBubbleService);
  private autoAnimSvc = inject(ObjectAnimationService);
  private loopManager = inject(LoopManagerService);

  private backupsAnimados: any[] = [];
  
  // REFERENCIAS A LOS CONTROLADORES EN RUNTIME
  private activePlayerController: PlayerController | null = null;
  private activeNpcControllers: NpcController[] = [];

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      const isLocked = !!document.pointerLockElement;
      this.state.ratonBloqueado.set(isLocked);
      
      if (!isLocked) {
        const stateStr = this.state.playState();
        if (stateStr === 'PLAYING' || stateStr === 'EDITING_IN_GAME' || stateStr === 'TRANSITIONING' || stateStr === 'INTERACTING') {
          this.resetMovimientoJugador();
        }
      } else {
        const stateStr = this.state.playState();
        if (stateStr === 'PLAYING' || stateStr === 'EDITING_IN_GAME') {
          const canvas = this.motor3d.engine.getRenderingCanvas();
          const activeCam = this.motor3d.scene?.activeCamera;
          if (canvas && activeCam) {
            setTimeout(() => {
              canvas.focus();
              activeCam.detachControl();
              activeCam.attachControl(canvas, true);
            }, 50); 
          }
        }
      }
    });
  }

  private getCharacterContext(): CharacterContext {
    return {
      motor3d: this.motor3d,
      state: this.state,
      animSvc: this.animSvc,
      physicsSvc: this.physicsSvc,
      sequenceSvc: this.sequenceSvc,
      inputSvc: this.inputSvc,
      cameraSvc: this.playerCamSvc,
      interactSvc: this.interactSvc,
      triggerSvc: this.triggerSvc,
      bubbleSvc: this.bubbleSvc
    };
  }

  public iniciarModoJuego(vista: 'FPS' | 'TPS'): void {
    this.detenerPreviewSecuencia();

    const objMesh = this.state.objetoSeleccionado() as Mesh;
    if (!objMesh) return;
    
    const playerEntity = this.entityManager.getEntityByMesh(objMesh);
    if (!playerEntity) {
        console.error("El objeto seleccionado no tiene una GameEntity asociada.");
        return;
    }

    this.cameraSvc.guardarEstadoCamaraLibre();

    this.state.playState.set('TRANSITIONING');
    this.state.jugadorActivo = objMesh;
    this.state.modoVistaPrueba = vista;
    this.state.objetoHovereado.set(null);

    this.state.backupObjetoPosicion = objMesh.position.clone();
    if (objMesh.rotationQuaternion) this.state.backupObjetoRotacionQuat = objMesh.rotationQuaternion.clone();
    else {
      this.state.backupObjetoRotacionQuat = Quaternion.FromEulerAngles(objMesh.rotation.x, objMesh.rotation.y, objMesh.rotation.z);
      objMesh.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
    }
    this.state.backupObjetoVisibilidad = objMesh.isVisible;
    this.state.backupColisionJugador = objMesh.checkCollisions;
    this.state.backupColisionesHijos = [];
    objMesh.getChildMeshes().forEach((m: AbstractMesh) => {
      this.state.backupColisionesHijos.push({ mesh: m, col: m.checkCollisions });
      m.checkCollisions = false;
    });
    objMesh.checkCollisions = true;
    this.state.objetoSeleccionado.set(null);

    this.crearProxysDeColision(objMesh);
    this.backupsAnimados = []; 
    
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    this.motor3d.scene.meshes.forEach(m => {
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.isVisible = isAdmin;
            m.setEnabled(isAdmin);
        }

        if (m.metadata?.type === 'video_plane') {
            if (m.material instanceof StandardMaterial) {
                const tex = m.material.diffuseTexture;
                if (tex instanceof VideoTexture) {
                    tex.video.pause();
                    tex.video.currentTime = 0;
                    m.material.emissiveColor = new Color3(0, 0, 0); 
                }
            }
            m.metadata.isPoweredOn = false; 
        }

        if (m.metadata?.type?.startsWith('light_') && !m.metadata?.assetId) {
            m.isVisible = false;
        }

        if (m.metadata?.type === 'image_plane') {
            m.isVisible = false; 
        }
    });

    const context = this.getCharacterContext();
    this.activePlayerController = new PlayerController(playerEntity, context);

    this.activeNpcControllers = [];
    const allNpcs = this.entityManager.getEntitiesByRol('npc');
    
    allNpcs.forEach(npcEntity => {
        if (npcEntity.uid === playerEntity.uid) return; 
        
        const mesh = npcEntity.view as Mesh;
        if (!mesh) return;

        const lightObj = mesh.getDescendants(false).find(c => c.name.startsWith('l_'));
        this.backupsAnimados.push({
            mesh: mesh,
            pos: mesh.position.clone(),
            rot: mesh.rotation.clone(),
            rotQ: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null,
            intensity: lightObj ? (lightObj as any).intensity : null
        });

        const npcCtrl = new NpcController(npcEntity, context);
        this.activeNpcControllers.push(npcCtrl);
        this.animSvc.sincronizarAnimaciones(this.motor3d.scene, mesh, npcCtrl.config);
    });

    const colMeta = playerEntity.collider;
    const camMeta = playerEntity.camOffset;
    objMesh.ellipsoid = new Vector3(colMeta.sizeX * objMesh.scaling.x, colMeta.sizeY * objMesh.scaling.y, colMeta.sizeZ * objMesh.scaling.z);
    objMesh.ellipsoidOffset = new Vector3(colMeta.offsetX * objMesh.scaling.x, colMeta.offsetY * objMesh.scaling.y, colMeta.offsetZ * objMesh.scaling.z);

    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, objMesh, this.activePlayerController.config);

    const playerAutoSeq = this.activePlayerController.config.sequences.find((s: any) => s.autoPlay);
    if (playerAutoSeq) {
        this.sequenceSvc.iniciarSecuenciaEnJuego(playerAutoSeq.id, objMesh, this.activePlayerController.config);
    }
    
    this.state.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, this.motor3d.scene);
    this.state.cameraPivot.isVisible = false;
    
    this.playerCamSvc.inicializarCamaras(objMesh, colMeta, camMeta, vista, objMesh.scaling, this.activePlayerController.config);
    this.motor3d.scene.render(false, true);

    const targetCam = vista === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    
    targetCam.getViewMatrix(true);
    const targetPos = targetCam.globalPosition.clone();
    let targetLookAt: Vector3;

    if (vista === 'FPS') {
      targetLookAt = targetCam.globalPosition.add(targetCam.getDirection(Vector3.Forward()));
    } else {
      targetLookAt = this.state.cameraPivot!.getAbsolutePosition();
    }

    this.autoAnimSvc.startAmbientAutoAnimations();

    const finishSetup = () => {
        this.motor3d.scene.activeCamera = targetCam;
        this.state.playState.set('PLAYING');
        
        this.resetMovimientoJugador();
        this.triggerSvc.prepararTriggersParaJuego();

        this.inputSvc.iniciarEscuchaTeclado(this.motor3d.scene, {
          onToggleCamera: () => this.playerCamSvc.toggleCameraView(objMesh, this.activePlayerController!.config),
          onInteractE: () => this.handleInteractions(true),
          onInteractI: () => this.handleInteractions(false)
        });

        // Al usuario no se le pide bloqueo del ratón inmediatamente para que pueda clicar el menú
        const isUser = this.state.rolSimulado() === 'user';
        this.iniciarBucleSecundario(!isUser); 
        this.state.triggerUpdate();
    };

    if (this.state.rolSimulado() === 'user') {
        finishSetup();
    } else {
        this.cameraSvc.volarHaciaCamaraJuego(objMesh.getAbsolutePosition(), targetPos, targetLookAt, vista === 'FPS', () => {
            finishSetup();
        });
    }
  }

  // 🔥 ANIMACIÓN CINEMÁTICA ACCESIBLE DESDE AFUERA
  public toggleCameraUser(isCinematicInitial: boolean = false): void {
    if (this.state.jugadorActivo && this.activePlayerController) {
      this.playerCamSvc.toggleCameraView(this.state.jugadorActivo, this.activePlayerController.config, isCinematicInitial);
    }
  }

  private handleInteractions(isActionE: boolean): void {
      const target = this.state.targetInteractuable();
      if (!target || !this.interactSvc.canActivateInteraction(target, this.state.modoVistaPrueba)) return;

      if (isActionE) {
        if (target.metadata?.isProcessingAction) return;

        let seqIdString = this.state.modoVistaPrueba === 'FPS' ? target.metadata?.interactSequenceIdFPS : target.metadata?.interactSequenceIdTPS;
        if (!seqIdString) seqIdString = target.metadata?.interactSequenceId;
        const ids = seqIdString ? seqIdString.split(',').map((id: string) => id.trim()).filter(Boolean) : [];

        if (target.metadata?.type === 'bubble') {
          this.bubbleSvc.ejecutarBurbuja(target);
          if (ids.length > 0) this.executeSequenceFromIds(target, ids);
        } else {
          if (target.metadata?.type === 'video_plane') {
              if (!target.metadata.isPoweredOn) return; 
              if (ids.length === 0) {
                  if (target.material instanceof StandardMaterial) {
                      const tex = target.material.diffuseTexture;
                      if (tex instanceof VideoTexture) {
                          if (tex.video.paused) {
                              tex.video.play();
                              target.material.emissiveColor = new Color3(1, 1, 1);
                          } else {
                              tex.video.pause();
                              target.material.emissiveColor = new Color3(0.3, 0.3, 0.3); 
                          }
                      }
                  }
                  return; 
              }
          }
          if (ids.length > 0) this.executeSequenceFromIds(target, ids);
        }
      } else {
          const cloneData = { name: target.name, metadata: { mensaje: target.metadata?.mensaje || '' } };
          this.interactSvc.abrirMensajeInteractivo(cloneData as any, () => this.resetMovimientoJugador());
      }
  }

  private executeSequenceFromIds(target: AbstractMesh, ids: string[]): void {
      target.metadata.isProcessingAction = true;
      const idxKey = this.state.modoVistaPrueba === 'FPS' ? 'currentSeqIdxFPS' : 'currentSeqIdxTPS';
      let idx = target.metadata[idxKey] || 0;
      if (idx >= ids.length) idx = 0;
      const idToPlay = ids[idx];

      const triggerAction = () => {
         this.motor3d.scene.meshes.forEach(m => {
             if (m.metadata?.playerConfig?.sequences?.some((s: any) => s.id === idToPlay)) {
                 this.sequenceSvc.iniciarSecuenciaEnJuego(idToPlay, m as Mesh, m.metadata.playerConfig);
             }
         });
         target.metadata.isProcessingAction = false;
         target.metadata[idxKey] = (idx + 1) % ids.length;
      };

      if (target.metadata?.type === 'bubble') {
          setTimeout(triggerAction, 500);
      } else {
          triggerAction();
      }
  }

  private iniciarBucleSecundario(requestLock: boolean = true): void {
    if (this.activePlayerController) {
        this.loopManager.register('PlayerLogic', GamePhase.LOGIC, (dtMs: number) => {
            this.activePlayerController!.update(dtMs);
        });
    }

    this.activeNpcControllers.forEach(npc => {
        this.loopManager.register('NPCLogic_' + npc.entity.uid, GamePhase.LOGIC, (dtMs: number) => {
            npc.update(dtMs);
        });
    });

    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) { 
        this.motor3d.scene.activeCamera!.attachControl(canvas, true); 
        if (requestLock) {
            canvas.focus(); 
            try { 
                const p = canvas.requestPointerLock(); 
                if (p) p.catch(() => {});
            } catch {} 
        }
    }
  }

  public detenerModoJuego(): void {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');
    this.resetMovimientoJugador();
    
    this.loopManager.unregister('PlayerLogic');
    this.activeNpcControllers.forEach(npc => {
        this.loopManager.unregister('NPCLogic_' + npc.entity.uid);
    });
    this.activePlayerController = null;
    this.activeNpcControllers = [];

    this.sequenceSvc.resetearSecuencias(); 
    this.animSvc.detenerTodasGlobal();
    this.animSvc.limpiarEstados(); 

    this.autoAnimSvc.stopAmbientAutoAnimations();

    this.triggerSvc.restaurarTriggersParaEditor();
    this.bubbleSvc.restaurarBurbujasParaEditor(); 

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
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.setEnabled(isAdmin);
            m.isVisible = isAdmin;
        }

        if (m.metadata?.type?.startsWith('light_') && !m.metadata?.assetId) {
            m.isVisible = isAdmin;
        }

        if (m.metadata?.type === 'bubble') {
            m.isVisible = true;
            m.metadata.isProcessingAction = false;
        }

        if (m.metadata?.type === 'video_plane') {
            if (m.material instanceof StandardMaterial) {
                const tex = m.material.diffuseTexture;
                if (tex instanceof VideoTexture) {
                    tex.video.pause();
                    m.material.emissiveColor = new Color3(1, 1, 1); 
                }
            }
            m.metadata.isPoweredOn = undefined; 
        }

        if (m.metadata?.type === 'image_plane') {
            m.isVisible = isAdmin; 
        }
    });

    this.playerCamSvc.restaurarCamaraEditor();
    
    if (this.state.cameraPivot) { this.state.cameraPivot.dispose(); this.state.cameraPivot = null; }
    
    this.inputSvc.detenerEscuchaTeclado(scene);
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
      this.state.jugadorActivo.visibility = 1;
      this.state.jugadorActivo.getChildMeshes().forEach(m => {
          m.isVisible = true;
          m.visibility = 1;
      });
      
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

  public resincronizarAnimaciones(mesh: AbstractMesh): void {
     const trueMesh = mesh as Mesh;
     const entity = this.entityManager.getEntityByMesh(mesh);
     const config = entity?.playerConfig || mergePlayerConfig(trueMesh.metadata?.playerConfig || null);
     this.animSvc.sincronizarAnimaciones(this.motor3d.scene, trueMesh, config);
  }

  public iniciarPreviewSecuencia(mesh: AbstractMesh, sequenceId: string) {
    const trueMesh = mesh as Mesh;
    const entity = this.entityManager.getEntityByMesh(mesh);
    const config = entity?.playerConfig || mergePlayerConfig(trueMesh.metadata?.playerConfig || null);

    if (this.state.playState() !== 'EDITOR') {
       this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, trueMesh, config);
       return;
    }

    this.detenerPreviewSecuencia();
    this.animSvc.sincronizarAnimaciones(this.motor3d.scene, trueMesh, config);
    this.sequenceSvc.iniciarSecuenciaEnJuego(sequenceId, trueMesh, config);

    this.loopManager.register('PreviewSequence', GamePhase.LOGIC, (dtMs: number) => {
      const runtime = this.sequenceSvc.actualizarSecuencia(dtMs, trueMesh, config);
      
      if (runtime.running && runtime.step) {
        const override = this.animSvc.resolveSequenceStepAnimation(trueMesh, runtime.step);
        if (override) { override.speedRatio = runtime.step.speedRatio || 1; this.animSvc.playAnim(trueMesh, override, runtime.loop, runtime.blend); }
      } else if (!runtime.running) this.animSvc.reproducirIdle(trueMesh);
    });
  }

  public detenerPreviewSecuencia() {
    this.loopManager.unregister('PreviewSequence');
    
    if (this.state.playState() === 'EDITOR') {
        this.sequenceSvc.resetearSecuencias();
        this.animSvc.detenerTodasGlobal();
    }
  }
 
  public resetMovimientoJugador(): void {
    if (this.activePlayerController) {
       this.activePlayerController.resetAll();
    } else {
       this.inputSvc.resetearInputs();
       this.playerCamSvc.resetearTransiciones();
       this.state.mirandoObjetoInteractuable.set(false);
       this.state.targetInteractuable.set(null);
       this.state.showToastE.set(false);
       this.state.showToastI.set(false);
       if (this.state.jugadorActivo) {
           this.animSvc.detenerTodas(this.state.jugadorActivo);
           this.animSvc.reproducirIdle(this.state.jugadorActivo); 
       }
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