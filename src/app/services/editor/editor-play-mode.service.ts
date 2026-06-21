import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, Tags, Vector3, Observer, Scene } from '@babylonjs/core';

import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EditorMapaService } from '../editor-mapa.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; 
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { GameMode } from '../../core/engine/session/game-mode.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { CAMERA_BEHAVIOR_PROFILES } from '../../core/engine/runtime/cameras/camera-behavior-profile.model';
import { AuthService } from '../../core/services/auth';

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
  private eventBus = inject(GameEventBusService);
  private authSvc = inject(AuthService);
  private transitionSvc = inject(EditorModeTransitionService);

  private snapshotMemoria: any = null;

  constructor() {
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
    this.gameState.enterSandbox();

    this.state.modoVistaPrueba = vista;
    this.state.jugadorActivo = objMesh;
    
    // 🛡️ Sincronización estricta del Modo y PlayState
    this.transitionSvc.beginTestLive();

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
    if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

    const fpsEyeLevel = playerEntity.playerConfig?.camera?.fpsEyeLevel ?? 1.6;
    const tpsMaxRadius = playerEntity.playerConfig?.camera?.tpsMaxRadius ?? 15;
    const tpsPivotY = playerEntity.playerConfig?.camera?.tpsPivotY ?? 1.5;

    let targetLookAt: Vector3;
    let targetPos: Vector3;
    const centroEpiral = objMesh.getAbsolutePosition().clone();
    centroEpiral.y += fpsEyeLevel;

    if (vista === 'FPS') {
        targetPos = objMesh.getAbsolutePosition().clone();
        targetPos.y += fpsEyeLevel;
        targetLookAt = targetPos.add(playerForward.scale(10));
    } else {
        targetLookAt = objMesh.getAbsolutePosition().clone();
        targetLookAt.y += tpsPivotY;
        targetPos = targetLookAt.subtract(playerForward.scale(tpsMaxRadius));
        targetPos.y += tpsMaxRadius * 0.2; 
    }

    let hideObserver: Observer<Scene> | null = null;
    if (vista === 'FPS') {
      hideObserver = this.motor3d.scene.onBeforeRenderObservable.add(() => {
        const cam = this.motor3d.scene.activeCamera;
        if (cam && cam.name === "proxyTransitionCam") {
          const dist = Vector3.Distance(cam.globalPosition, targetPos);
          if (dist < 1.8) {
            objMesh.visibility = 0;
            objMesh.getChildMeshes().forEach(m => m.visibility = 0);
          }
        }
      });
    }

    const finishSetup = () => {
        if (hideObserver) {
          this.motor3d.scene.onBeforeRenderObservable.remove(hideObserver);
        }

        this.transitionSvc.finishTestLiveTransition();
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
                    
                    const profile = CAMERA_BEHAVIOR_PROFILES[GameMode.TEST_LIVE];
                    if (activeCam.minZ !== undefined) activeCam.minZ = profile.minZ;
                    
                    activeCam.attachControl(canvas, true);
                }
            }
        }, 100);
    };

    this.cameraSvc.volarHaciaCamaraJuego(
        centroEpiral, targetPos, targetLookAt, playerForward, vista === 'FPS', () => finishSetup()
    );
  }

  public async detenerPrueba(): Promise<void> {
    this.transitionSvc.stopTestLive();
    
    this.runtimeEngine.stopTestSession();
    this.gameState.exitSandbox();

    const isDebugMode = this.authSvc.isAdmin();

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
    
    this.inputOrchestrator.unlockPointer();
    
    const canvas = this.motor3d.engine.getRenderingCanvas();
    if (canvas) {
      editorCam.attachControl(canvas, true);
    }
    
    this.state.triggerUpdate();
  }
}