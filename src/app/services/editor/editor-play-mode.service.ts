
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EditorMapaService } from '../editor-mapa.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';

@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private editorSvc = inject(EditorMapaService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);
  private inputOrchestrator = inject(InputOrchestratorService);

  private snapshotMemoria: any = null;
  
  public testearEscena(vista: 'FPS' | 'TPS'): void {
    const objMesh = this.state.objetoSeleccionado() as Mesh;
    if (!objMesh) return;
    
    const playerEntity = this.entityManager.getEntityByMesh(objMesh);
    if (!playerEntity) return;

    this.cameraSvc.guardarEstadoCamaraLibre();

    this.state.modoVistaPrueba = vista;
    this.state.playState.set('TRANSITIONING');
    this.state.jugadorActivo = objMesh;
    this.state.objetoHovereado.set(null);

    const isDebugMode = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    // Capturamos TODO el mapa completo para tener el estado inicial de referencia
    this.snapshotMemoria = this.editorSvc.obtenerDatosParaGuardar(true);

    this.state.objetoSeleccionado.set(null);

    this.motor3d.scene.meshes.forEach(m => {
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.isVisible = false;
            m.setEnabled(false);
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = false;
            if (entity.type === 'image_plane') m.isVisible = false; 
        }
    });

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
        this.runtimeEngine.startTestSession(playerEntity, vista, isDebugMode);
        this.state.triggerUpdate();
        
        if (isDebugMode) {
            setTimeout(() => {
                const canvas = this.motor3d.engine.getRenderingCanvas();
                if (canvas) {
                    const activeCam = this.motor3d.scene.activeCamera;
                    if (activeCam) {
                        activeCam.detachControl();
                        activeCam.attachControl(canvas, true);
                    }
                }
            }, 100);
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

  public async detenerPrueba(): Promise<void> {
    this.state.playState.set('EDITOR');
    this.state.modoVistaPrueba = null; 
    
    this.runtimeEngine.stopTestSession();
    const isDebugMode = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (this.snapshotMemoria) {
        // 1. CAPTURAR EDICIONES HECHAS DURANTE EL TEST EN 1ra PERSONA
        const cambiosEnPlay = this.editorSvc.obtenerDatosParaGuardar(false);

        // 2. FUSIONAR CAMBIOS DE OBJETOS EN EL SNAPSHOT
        cambiosEnPlay.sceneObjectsDelta.forEach(delta => {
            const index = this.snapshotMemoria.sceneObjectsDelta.findIndex((o: any) => o.uid === delta.uid);
            if (index !== -1) {
                this.snapshotMemoria.sceneObjectsDelta[index] = delta;
            } else {
                this.snapshotMemoria.sceneObjectsDelta.push(delta);
            }
        });

        // 3. FUSIONAR CAMBIOS DE TRIGGERS
        cambiosEnPlay.triggersDelta.forEach(delta => {
            const index = this.snapshotMemoria.triggersDelta.findIndex((o: any) => o.uid === delta.uid);
            if (index !== -1) {
                this.snapshotMemoria.triggersDelta[index] = delta;
            } else {
                this.snapshotMemoria.triggersDelta.push(delta);
            }
        });

        // 4. APLICAR ELIMINACIONES QUE SE HAYAN HECHO EN MODO TEST
        if (cambiosEnPlay.deletedObjects.length > 0) {
            this.snapshotMemoria.sceneObjectsDelta = this.snapshotMemoria.sceneObjectsDelta.filter((o: any) => !cambiosEnPlay.deletedObjects.includes(o.uid));
            this.snapshotMemoria.deletedObjects = [...new Set([...this.snapshotMemoria.deletedObjects, ...cambiosEnPlay.deletedObjects])];
        }

        if (cambiosEnPlay.deletedTriggers.length > 0) {
            this.snapshotMemoria.triggersDelta = this.snapshotMemoria.triggersDelta.filter((o: any) => !cambiosEnPlay.deletedTriggers.includes(o.uid));
            this.snapshotMemoria.deletedTriggers = [...new Set([...this.snapshotMemoria.deletedTriggers, ...cambiosEnPlay.deletedTriggers])];
        }

        this.entityManager.clear();
        this.editorSvc.limpiarEstado();

        const scene = this.motor3d.scene;
        
        // 🔥 FIX: Impedimos estrictamente que la limpieza de recarga borre la geometría de la niebla
        const meshesToDispose = scene.meshes.filter(m => {
           const n = m.name.toLowerCase();
           return !['sueloinvisible', 'ejex', 'ejey', 'ejez', 'gridhelper'].includes(n) &&
                  !n.includes('gizmo') && 
                  !n.includes('highlight') &&
                  !n.includes('fogshell') &&
                  !n.includes('fogwall') &&
                  !n.includes('debug');
        });
        
        meshesToDispose.forEach(m => {
            if (!m.isDisposed()) m.dispose(false, true);
        });

        await this.editorSvc.cargarEscenaDesdeDatos(this.snapshotMemoria);
        this.snapshotMemoria = null;
    }

    this.motor3d.scene.meshes.forEach(m => {
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.setEnabled(true);
            m.isVisible = true;
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = isDebugMode;
            if (entity.type === 'bubble') m.isVisible = true;
            if (entity.type === 'image_plane') m.isVisible = isDebugMode; 
            if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') m.isVisible = isDebugMode;
        }
    });

    this.cameraSvc.restaurarCamaraLibre();
    const editorCam = this.motor3d.editorCamera;
    this.motor3d.scene.activeCamera = editorCam;
    this.state.jugadorActivo = null; 
    
    this.inputOrchestrator.unlockPointer();
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      editorCam.attachControl(canvas, true);
    }
    
    this.state.triggerUpdate();
  }
}