
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Quaternion } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime-engine.service';
import { PlayerTriggerService } from '../../core/engine/systems/player-trigger.service';
import { PlayerBubbleService } from '../../core/engine/systems/player-bubble.service';

@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);
  private triggerSvc = inject(PlayerTriggerService);
  private bubbleSvc = inject(PlayerBubbleService);

  private backupsAnimados: any[] = [];
  
  public testearEscena(vista: 'FPS' | 'TPS'): void {
    const objMesh = this.state.objetoSeleccionado() as Mesh;
    if (!objMesh) return;
    
    const playerEntity = this.entityManager.getEntityByMesh(objMesh);
    if (!playerEntity) return;

    this.cameraSvc.guardarEstadoCamaraLibre();

    this.state.playState.set('TRANSITIONING');
    this.state.jugadorActivo = objMesh;
    this.state.objetoHovereado.set(null);

    // BACKUPS DEL EDITOR
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

    this.backupsAnimados = []; 
    
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    // LIMPIEZA VISUAL DEL EDITOR ANTES DE EMPEZAR LA PRUEBA
    this.motor3d.scene.meshes.forEach(m => {
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.isVisible = isAdmin;
            m.setEnabled(isAdmin);
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) {
                m.isVisible = false;
            }
            if (entity.type === 'image_plane') {
                m.isVisible = false; 
            }
            
            // Backup NPCS
            if (entity.rol === 'npc' && m instanceof Mesh) {
                const lightObj = m.getDescendants(false).find(c => c.name.startsWith('l_'));
                this.backupsAnimados.push({
                    mesh: m,
                    pos: m.position.clone(),
                    rot: m.rotation.clone(),
                    rotQ: m.rotationQuaternion ? m.rotationQuaternion.clone() : null,
                    intensity: lightObj ? (lightObj as any).intensity : null
                });
            }
        }
    });

    const targetCam = vista === 'FPS' ? this.motor3d.playerCameraFPS : this.motor3d.playerCameraTPS;
    let targetLookAt = objMesh.getAbsolutePosition().clone();
    let targetPos = objMesh.getAbsolutePosition().clone();
    
    if (vista === 'FPS') {
        targetPos.y += playerEntity.playerConfig?.camera?.fpsEyeLevel ?? 1.6;
        targetLookAt = targetPos.add(objMesh.forward);
    } else {
        targetPos.z -= 5;
        targetPos.y += 2;
    }

    const finishSetup = () => {
        this.state.playState.set('PLAYING');
        this.runtimeEngine.startSession(playerEntity, vista, isAdmin);
        this.state.triggerUpdate();
        
        if (isAdmin) {
          const canvas = this.motor3d.engine.getRenderingCanvas();
          if (canvas) {
            canvas.focus(); 
            try { const p = canvas.requestPointerLock(); if(p) p.catch(()=>{}); } catch {} 
          }
        }
    };

    if (this.state.rolSimulado() === 'user') {
        finishSetup();
    } else {
        this.cameraSvc.volarHaciaCamaraJuego(objMesh.getAbsolutePosition(), targetPos, targetLookAt, vista === 'FPS', () => {
            finishSetup();
        });
    }
  }

  public detenerPrueba(): void {
    this.state.playState.set('EDITOR');
    
    this.runtimeEngine.stopSession();

    this.triggerSvc.restaurarTriggersParaEditor();
    this.bubbleSvc.restaurarBurbujasParaEditor(); 

    // RESTAURAR BACKUPS DEL EDITOR
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

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) {
                m.isVisible = isAdmin;
            }
            if (entity.type === 'bubble') {
                m.isVisible = true;
            }
            if (entity.type === 'image_plane') {
                m.isVisible = isAdmin; 
            }
        }
    });

    this.cameraSvc.restaurarCamaraLibre();
    const editorCam = this.motor3d.editorCamera;
    this.motor3d.scene.activeCamera = editorCam;
    
    if (this.state.jugadorActivo && this.state.backupObjetoPosicion && this.state.backupObjetoRotacionQuat) {
      const entity = this.entityManager.getEntityByMesh(this.state.jugadorActivo);
      if (entity && (entity.rol === 'npc' || entity.rol === 'spawn_point')) {
        // En modo edición mantenemos la rotación en la que lo dejó el jugador
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
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      this.motor3d.editorCamera.attachControl(canvas, true);
    }
    this.state.triggerUpdate();
  }

  public toggleCameraUser(isCinematicInitial: boolean = false, customFrames?: number): void {
    this.runtimeEngine.toggleCameraUser(isCinematicInitial, customFrames);
  }
}