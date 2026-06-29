
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, MeshBuilder, Tags, Vector3, Observer, Scene } from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { RuntimeEngineService } from '../../core/engine/runtime/runtime-engine.service';
import { EditorMapaService } from '../editor-mapa.service';
import { EditorSceneService } from './editor-scene.service';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { GameStateService } from '../../core/engine/runtime/state/game-state.service'; 
import { CameraViewMode } from '../../core/engine/session/game-context.model';
import { GameMode } from '../../core/engine/session/game-mode.model';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EditorModeTransitionService } from './editor-mode-transition.service';
import { CAMERA_BEHAVIOR_PROFILES } from '../../core/engine/runtime/cameras/camera-behavior-profile.model';
import { AuthService } from '../../core/services/auth';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { CharacterConfigComponent, PlayerRuntimeComponent, GameEntity } from '../../core/engine/entities/game.entity';
import { cloneDefaultPlayerConfig } from '../../core/engine/models/player-config.model';

@Injectable({ providedIn: 'root' })
export class EditorPlayModeService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private runtimeEngine = inject(RuntimeEngineService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private gameState = inject(GameStateService); 
  private gameContext = inject(GameContextService);
  private eventBus = inject(GameEventBusService);
  private authSvc = inject(AuthService);
  private transitionSvc = inject(EditorModeTransitionService);
  private ownership = inject(CameraOwnershipService);

  private snapshotMemoria: any = null;

  constructor() {
    this.eventBus.events$.subscribe(e => {
       if (e.type === 'CameraViewChanged') {
          this.state.modoVistaPrueba = e.payload;
       }
    });
  }

  public testearEscena(vista: CameraViewMode, skipIntro: boolean = false): void {
    if (this.motor3d.getEditorCamera()) {
        this.motor3d.getEditorCamera().computeWorldMatrix();
    }

    let objMesh = this.state.objetoSeleccionado() as Mesh;
    let playerEntity = objMesh ? this.entityManager.getEntityByMesh(objMesh) : null;
    
    if (!playerEntity || (!playerEntity.hasComponent('characterConfig') && playerEntity.rol !== 'spawn_point')) {
       const characters = this.entityManager.getEntitiesWithComponent('characterConfig');
       playerEntity = characters.find(c => c.rol === 'player') || characters.find(c => c.characterConfig?.isPlayable);
       
       if (!playerEntity) {
           const spawnPoint = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point');
           if (spawnPoint) {
               const tempMesh = MeshBuilder.CreateCapsule("TempPlayer_TestLive", { height: 1.8, radius: 0.4 }, this.motor3d.getScene());
               tempMesh.position.set(
                 spawnPoint.transform.position.x,
                 spawnPoint.transform.position.y,
                 spawnPoint.transform.position.z
               );
               if (spawnPoint.view && spawnPoint.view.rotationQuaternion) {
                   tempMesh.rotationQuaternion = spawnPoint.view.rotationQuaternion.clone();
               } else {
                   tempMesh.rotation.set(
                     spawnPoint.transform.rotation.x,
                     spawnPoint.transform.rotation.y,
                     spawnPoint.transform.rotation.z
                   );
               }
               tempMesh.isVisible = false;
               
               playerEntity = new GameEntity(window.crypto.randomUUID(), 'Jugador_Prueba', 'model', 'player');
               playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
               playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
               playerEntity.playerConfig = cloneDefaultPlayerConfig();
               playerEntity.bindView(tempMesh);
               this.entityManager.addEntity(playerEntity);
           }
       }
       if (playerEntity && playerEntity.view) {
           objMesh = playerEntity.view as Mesh;
       }
    } else if (playerEntity.rol === 'spawn_point') {
       const tempMesh = MeshBuilder.CreateCapsule("TempPlayer_TestLive", { height: 1.8, radius: 0.4 }, this.motor3d.getScene());
       tempMesh.position.set(
         playerEntity.transform.position.x,
         playerEntity.transform.position.y,
         playerEntity.transform.position.z
       );
       tempMesh.isVisible = false;
       
       playerEntity = new GameEntity(window.crypto.randomUUID(), 'Jugador_Prueba', 'model', 'player');
       playerEntity.addComponent('characterConfig', new CharacterConfigComponent('player', true));
       playerEntity.addComponent('playerRuntime', new PlayerRuntimeComponent());
       playerEntity.playerConfig = cloneDefaultPlayerConfig();
       playerEntity.bindView(tempMesh);
       this.entityManager.addEntity(playerEntity);
       objMesh = tempMesh;
    }

    if (!objMesh || !playerEntity) {
        console.warn("No hay personaje jugable ni spawn point para iniciar el Test Live.");
        return;
    }

    if (!skipIntro) {
      this.cameraSvc.guardarEstadoCamaraLibre();
      this.gameState.enterSandbox();
      this.transitionSvc.beginTestLive();
      this.snapshotMemoria = JSON.parse(JSON.stringify(this.mapaSvc.escenaActualData()));
    }

    playerEntity.isPersistent = true;
    Tags.AddTagsTo(playerEntity.view, "persistent_player");

    this.state.modoVistaPrueba = vista;
    this.state.jugadorActivo = objMesh;
    this.state.objetoSeleccionado.set(null);
    
    this.motor3d.getScene().meshes.forEach(m => {
        if (Tags.MatchesQuery(m, "editor_only")) {
            m.isVisible = false;
            m.setEnabled(false);
        }

        const entity = this.entityManager.getEntityByMesh(m);
        if (entity) {
            if (entity.type.startsWith('light_') && !entity.visual.assetId) m.isVisible = false;
            if (entity.type === 'image_plane') m.isVisible = false; 
            if (entity.rol === 'spawn_point' && entity.uid !== playerEntity!.uid) { 
                m.isVisible = false; 
                m.setEnabled(false); 
            }
        }
    });

    objMesh.computeWorldMatrix(true);
    const playerForward = objMesh.forward.clone().normalize();
    if (playerForward.lengthSquared() === 0) playerForward.copyFromFloats(0, 0, 1);

    const scaleY = objMesh.scaling.y || 1;
    const tpsMaxRadius = (playerEntity.playerConfig?.camera?.tpsRadius ?? 5) * scaleY;
    
    const rawTpsPivotY = playerEntity.playerConfig?.camera?.tpsPivotY ?? 1.5;
    const rawFpsEyeLevel = playerEntity.playerConfig?.camera?.fpsEyeLevel ?? 1.6;
    const camMeta = playerEntity.camOffset || { x: 0, y: 1.6, z: 0 };

    let targetLookAt: Vector3;
    let targetPos: Vector3;
    
    const localSpiralCenter = new Vector3(camMeta.x || 0, rawFpsEyeLevel, camMeta.z || 0);
    const centroEpiral = Vector3.TransformCoordinates(localSpiralCenter, objMesh.getWorldMatrix());

    if (vista === 'FPS') {
        const localCamPos = new Vector3(camMeta.x || 0, rawFpsEyeLevel, camMeta.z || 0);
        targetPos = Vector3.TransformCoordinates(localCamPos, objMesh.getWorldMatrix());
        targetLookAt = targetPos.add(playerForward.scale(10));
    } else {
        const localPivotPos = new Vector3(camMeta.x || 0, rawTpsPivotY, camMeta.z || 0);
        targetLookAt = Vector3.TransformCoordinates(localPivotPos, objMesh.getWorldMatrix());
        targetPos = targetLookAt.subtract(playerForward.scale(tpsMaxRadius));
    }

    let hideObserver: Observer<Scene> | null = null;
    
    if (vista === 'FPS' && !skipIntro) {
      hideObserver = this.motor3d.getScene().onBeforeRenderObservable.add(() => {
        const cam = this.ownership.getCamera();
        if (cam && this.ownership.getOwner() === 'TRANSITION_PROXY') {
          const dist = Vector3.Distance(cam.globalPosition, targetPos);
          if (dist < 3.5) {
            let alpha = Math.max(0, (dist - 0.5) / 3.0);
            alpha = alpha * alpha; 
            objMesh.visibility = alpha;
            objMesh.getChildMeshes().forEach(m => m.visibility = alpha);
          }
        }
      });
    }

    const finishSetup = () => {
        if (hideObserver) {
          this.motor3d.getScene().onBeforeRenderObservable.remove(hideObserver);
        }

        if (!skipIntro) this.transitionSvc.finishTestLiveTransition();
        this.runtimeEngine.startTestSession(playerEntity!, vista);
        this.mapaSvc.onMapChanged.next();
        
        setTimeout(() => {
            const canvas = this.motor3d.getEngine().getRenderingCanvas();
            if (canvas) {
                const activeCam = this.ownership.getCamera();
                if (activeCam) {
                    this.motor3d.getEditorCamera()?.detachControl();
                    this.motor3d.getPlayerCameraFPS()?.detachControl();
                    this.motor3d.getPlayerCameraTPS()?.detachControl();
                    
                    const profile = CAMERA_BEHAVIOR_PROFILES[GameMode.TEST_LIVE];
                    if (activeCam.minZ !== undefined) activeCam.minZ = profile.minZ;
                    
                    activeCam.attachControl(canvas, true);
                    
                    if (vista === 'FPS') {
                      objMesh.visibility = 0;
                      objMesh.getChildMeshes().forEach(m => m.visibility = 0);
                    }
                }
            }
        }, 100);
    };

    if (skipIntro) {
      finishSetup();
    } else {
      this.cameraSvc.volarHaciaCamaraJuego(
          centroEpiral, targetPos, targetLookAt, playerForward, vista === 'FPS', () => finishSetup()
      );
    }
  }

  public async detenerPrueba(): Promise<void> {
    this.transitionSvc.stopTestLive();
    this.runtimeEngine.stopTestSession();
    this.gameState.exitSandbox();

    const isDebugMode = this.authSvc.isAdmin();

    if (this.snapshotMemoria) {
        const currentId = this.mapaSvc.escenaIdActiva();
        const snapId = this.snapshotMemoria.scene?.id || this.snapshotMemoria.id;

        if (snapId && currentId !== snapId) {
            this.snapshotMemoria = JSON.parse(JSON.stringify(this.mapaSvc.escenaActualData()));
        } else {
            // 🔥 FUSIÓN TOTAL: Obtenemos TODO lo que el usuario editó o creó mientras jugaba
            const cambiosEnPlay: any = this.sceneSvc.obtenerDatosParaGuardar(this.mapaSvc.escenaActualData(), true); 
            
            if (!this.snapshotMemoria.sceneObjects) this.snapshotMemoria.sceneObjects = this.snapshotMemoria.sceneObjectsDelta || [];
            if (!this.snapshotMemoria.triggers) this.snapshotMemoria.triggers = this.snapshotMemoria.triggersDelta || [];
            if (!this.snapshotMemoria.deletedObjects) this.snapshotMemoria.deletedObjects = [];
            if (!this.snapshotMemoria.deletedTriggers) this.snapshotMemoria.deletedTriggers = [];

            delete this.snapshotMemoria.sceneObjectsDelta;
            delete this.snapshotMemoria.triggersDelta;

            // 1. Fusionar Objetos Nuevos/Editados
            cambiosEnPlay.sceneObjectsDelta.forEach((delta: any) => {
                if (delta.name === 'Jugador_Prueba') return;
                const index = this.snapshotMemoria.sceneObjects.findIndex((o: any) => o.uid === delta.uid);
                if (index !== -1) this.snapshotMemoria.sceneObjects[index] = delta;
                else this.snapshotMemoria.sceneObjects.push(delta);
            });

            // 2. Fusionar Triggers
            cambiosEnPlay.triggersDelta.forEach((delta: any) => {
                const index = this.snapshotMemoria.triggers.findIndex((o: any) => o.uid === delta.uid);
                if (index !== -1) this.snapshotMemoria.triggers[index] = delta;
                else this.snapshotMemoria.triggers.push(delta);
            });

            // 3. Fusionar Propiedades Globales (BLANCO Y NEGRO, COLORES, NIEBLA MUNDIAL)
            if (cambiosEnPlay.environmentSettings) {
                this.snapshotMemoria.environmentSettings = JSON.parse(JSON.stringify(cambiosEnPlay.environmentSettings));
            }
            if (cambiosEnPlay.uiSettings) {
                this.snapshotMemoria.uiSettings = JSON.parse(JSON.stringify(cambiosEnPlay.uiSettings));
            }

            // 4. Fusionar Cinemáticas
            if (cambiosEnPlay.cinematicsDelta) {
                this.snapshotMemoria.cinematics = JSON.parse(JSON.stringify(cambiosEnPlay.cinematicsDelta));
            }

            // 5. Manejar Borrados
            if (cambiosEnPlay.deletedObjects.length > 0) {
                this.snapshotMemoria.sceneObjects = this.snapshotMemoria.sceneObjects.filter((o: any) => !cambiosEnPlay.deletedObjects.includes(o.uid));
                this.snapshotMemoria.deletedObjects = [...new Set([...this.snapshotMemoria.deletedObjects, ...cambiosEnPlay.deletedObjects])];
            }
            if (cambiosEnPlay.deletedTriggers.length > 0) {
                this.snapshotMemoria.triggers = this.snapshotMemoria.triggers.filter((o: any) => !cambiosEnPlay.deletedTriggers.includes(o.uid));
                this.snapshotMemoria.deletedTriggers = [...new Set([...this.snapshotMemoria.deletedTriggers, ...cambiosEnPlay.deletedTriggers])];
            }
        }

        // 🔥 ACTULIZACIÓN CRÍTICA: Actualizamos la señal del mapa para que el botón de Guardar
        // absorba permanentemente todos los cambios.
        this.mapaSvc.escenaActualData.set(JSON.parse(JSON.stringify(this.snapshotMemoria)));

        this.entityManager.getAllEntities().forEach(e => e.isPersistent = false);
        this.entityManager.clear();

        const scene = this.motor3d.getScene();
        const meshesToDispose = scene.meshes.filter(m => !Tags.MatchesQuery(m, "system_element") && !Tags.MatchesQuery(m, "editor_only"));
        meshesToDispose.forEach(m => {
            if (!m.isDisposed()) m.dispose(false, false); 
        });

        // 🔥 Recarga el mundo con la fusión
        await this.sceneSvc.cargarEscenaDesdeDatos(this.snapshotMemoria);
        this.snapshotMemoria = null;
    }

    this.motor3d.getScene().meshes.forEach(m => {
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
            if (entity.rol === 'spawn_point') { 
                m.setEnabled(true); 
                m.isVisible = true; 
            }
        }
    });

    this.cameraSvc.restaurarCamaraLibre();
    const editorCam = this.motor3d.getEditorCamera();
    
    this.inputOrchestrator.unlockPointer();
    
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    this.ownership.setCamera('EDITOR', editorCam, canvas, true);
    
    this.mapaSvc.onMapChanged.next();
  }
}