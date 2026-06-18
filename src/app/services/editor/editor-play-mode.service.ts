import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EditorMapaService } from '../editor-mapa.service';

@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private editorSvc = inject(EditorMapaService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);

  // 🔥 Arquitectura Inmutable: Guardará el JSON completo de la escena antes de jugar
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

    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    // 🔥 SNAPSHOT: Capturamos el estado exacto del mundo ANTES de que el juego lo contamine.
    // Lo hacemos SIEMPRE para asegurar que los cambios de físicas/secuencias no persistan.
    this.snapshotMemoria = this.editorSvc.obtenerDatosParaGuardar();

    this.state.objetoSeleccionado.set(null);

    // Ocultar herramientas visuales del editor para el modo juego
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
        this.runtimeEngine.startTestSession(playerEntity, vista, isAdmin);
        this.state.triggerUpdate();
        
        if (isAdmin) {
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
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    // 🔥 RESTAURACIÓN INMUTABLE: Destruimos la escena contaminada y cargamos el Snapshot puro
    if (this.snapshotMemoria) {
        // 1. Destruir Entidades lógicas
        this.entityManager.clear();
        
        // 2. Limpiar estado de selección y referencias de herramientas del Editor
        this.editorSvc.limpiarEstado();

        // 3. Purga estricta de mallas (apisonadora)
        // Ignoramos los gizmos, el suelo y la grilla base. La cámara del editor no es un Mesh, por lo que no se ve afectada.
        const scene = this.motor3d.scene;
        const meshesToDispose = scene.meshes.filter(m => {
           const n = m.name;
           return !['sueloInvisible', 'ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(n) &&
                  !n.includes('gizmo') && 
                  !n.includes('highlight');
        });
        
        meshesToDispose.forEach(m => {
            if (!m.isDisposed()) m.dispose(false, true);
        });

        // 4. Reconstruir desde Cero con el Snapshot inmutable
        await this.editorSvc.cargarEscenaDesdeDatos(this.snapshotMemoria);

        this.snapshotMemoria = null;
    }

    // Restaurar entorno visual del editor
    this.motor3d.scene.meshes.forEach(m => {
        if (['ejeX', 'ejeY', 'ejeZ', 'gridHelper'].includes(m.name)) {
            m.setEnabled(true);
            m.isVisible = true;
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = isAdmin;
            if (entity.type === 'bubble') m.isVisible = true;
            if (entity.type === 'image_plane') m.isVisible = isAdmin; 
            if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') m.isVisible = isAdmin;
        }
    });

    this.cameraSvc.restaurarCamaraLibre();
    const editorCam = this.motor3d.editorCamera;
    this.motor3d.scene.activeCamera = editorCam;
    this.state.jugadorActivo = null; 
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      editorCam.attachControl(canvas, true);
    }
    
    this.state.triggerUpdate();
  }
}