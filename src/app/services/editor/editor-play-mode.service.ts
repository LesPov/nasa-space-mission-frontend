// src/app/services/editor/editor-play-mode.service.ts

import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Tags, Vector3 } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EditorMapaService } from '../editor-mapa.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; 
import { CameraViewMode, GameMode } from '../../core/engine/session/game-context.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
 
@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private editorSvc = inject(EditorMapaService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private gameState = inject(GameStateService); 
  private gameContext = inject(GameContextService);
  
  // 🔥 FIX: Requerimos el bus de eventos para sincronizar el estado reactivo del Editor con la cámara activa
  private eventBus = inject(GameEventBusService);

  private snapshotMemoria: any = null;

  constructor() {
    // Sincroniza la vista de cámara (FPS o TPS) cuando cambia en Test Live, para evitar que
    // el sistema de selección por rayo asuma siempre FPS y confunda las interacciones.
    this.eventBus.events$.subscribe(e => {
       if (e.type === 'CameraViewChanged') {
          this.state.modoVistaPrueba = e.payload;
       }
    });
  }
  
  public testearEscena(vista: CameraViewMode): void {
    const objMesh = this.state.objetoSeleccionado() as Mesh;
    if (!objMesh) return;
    
    const playerEntity = this.entityManager.getEntityByMesh(objMesh);
    if (!playerEntity) return;

    this.cameraSvc.guardarEstadoCamaraLibre();
    
    // 🔥 Protegemos las variables del juego
    this.gameState.enterSandbox();

    this.state.modoVistaPrueba = vista;
    this.state.playState.set('TRANSITIONING');
    this.state.jugadorActivo = objMesh;
    this.state.objetoHovereado.set(null);

    // 🔥 FIX IMPORTANTÍSIMO: Cambiamos el contexto a TEST_LIVE *antes* de que inicie la transición.
    // Esto destraba el CameraFactory y permite instanciar las cámaras reales FPS y TPS en vez de un Mock
    // garantizando que el personaje pueda moverse desde el primer instante.
    this.gameContext.setMode(GameMode.TEST_LIVE);

    const isDebugMode = this.state.checkIsAdmin();

    this.snapshotMemoria = this.editorSvc.obtenerDatosParaGuardar(true);
    this.state.objetoSeleccionado.set(null);

    this.motor3d.scene.meshes.forEach(m => {
        if (Tags.MatchesQuery(m, "editor_only")) {
            m.isVisible = false;
            m.setEnabled(false);
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = false;
            if (entity.type === 'image_plane') m.isVisible = false; 
        }
    });

    const playerForward = objMesh.forward.clone().normalize();
    const fpsEyeLevel = playerEntity.playerConfig?.camera?.fpsEyeLevel ?? 1.6;
    const tpsMaxRadius = playerEntity.playerConfig?.camera?.tpsMaxRadius ?? 15;
    const tpsPivotY = playerEntity.playerConfig?.camera?.tpsPivotY ?? 1.5;

    let targetLookAt = objMesh.getAbsolutePosition().clone();
    targetLookAt.y += fpsEyeLevel;

    let targetPos: Vector3;

    if (vista === 'FPS') {
        // En 1ra persona, se ubica justo en los ojos, acercándose por la espalda
        targetPos = objMesh.getAbsolutePosition().clone();
        targetPos.y += fpsEyeLevel;
        targetPos.subtractInPlace(playerForward.scale(0.1));
    } else {
        // En 3ra persona, se ubica a la distancia máxima en la espalda
        targetPos = objMesh.getAbsolutePosition().subtract(playerForward.scale(tpsMaxRadius));
        targetPos.y += tpsPivotY + 1; // Un poco elevado para mejor vista
    }

    const finishSetup = () => {
        this.state.playState.set('PLAYING');
        
        this.runtimeEngine.startTestSession(playerEntity, vista);
        
        this.state.triggerUpdate();
        
        setTimeout(() => {
            const canvas = this.motor3d.engine.getRenderingCanvas();
            if (canvas) {
                const activeCam = this.motor3d.scene.activeCamera;
                if (activeCam) {
                    this.motor3d.editorCamera?.detachControl();
                    this.motor3d.playerCameraFPS?.detachControl();
                    this.motor3d.playerCameraTPS?.detachControl();
                    activeCam.attachControl(canvas, true);
                }
            }
        }, 100);
    };

    this.cameraSvc.volarHaciaCamaraJuego(
        objMesh.getAbsolutePosition(), 
        targetPos, 
        targetLookAt, 
        playerForward, 
        vista === 'FPS', 
        () => finishSetup()
    );
  }

  public async detenerPrueba(): Promise<void> {
    this.state.playState.set('EDITOR');
    this.state.modoVistaPrueba = null; 
    
    this.runtimeEngine.stopTestSession();
    
    // 🔥 Restauramos el estado inmaculado del editor
    this.gameState.exitSandbox();

    const isDebugMode = this.state.checkIsAdmin();

    if (this.snapshotMemoria) {
        const cambiosEnPlay = this.editorSvc.obtenerDatosParaGuardar(false);

        cambiosEnPlay.sceneObjectsDelta.forEach(delta => {
            const index = this.snapshotMemoria.sceneObjectsDelta.findIndex((o: any) => o.uid === delta.uid);
            if (index !== -1) {
                this.snapshotMemoria.sceneObjectsDelta[index] = delta;
            } else {
                this.snapshotMemoria.sceneObjectsDelta.push(delta);
            }
        });

        cambiosEnPlay.triggersDelta.forEach(delta => {
            const index = this.snapshotMemoria.triggersDelta.findIndex((o: any) => o.uid === delta.uid);
            if (index !== -1) {
                this.snapshotMemoria.triggersDelta[index] = delta;
            } else {
                this.snapshotMemoria.triggersDelta.push(delta);
            }
        });

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
        
        const meshesToDispose = scene.meshes.filter(m => {
           return !Tags.MatchesQuery(m, "system_element");
        });
        
        meshesToDispose.forEach(m => {
            if (!m.isDisposed()) m.dispose(false, true);
        });

        await this.editorSvc.cargarEscenaDesdeDatos(this.snapshotMemoria);
        this.snapshotMemoria = null;
    }

    this.motor3d.scene.meshes.forEach(m => {
        if (Tags.MatchesQuery(m, "editor_only")) {
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