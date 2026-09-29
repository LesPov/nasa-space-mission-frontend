import { Injectable, inject } from '@angular/core';
import { Mesh, Vector3, MeshBuilder, Tags, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { CoreSceneUtilsService } from './core-scene-utils.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { CoreModelLoaderService } from './core-model-loader.service';
import { CorePrimitiveLoaderService } from './core-primitive-loader.service';
import { CoreTriggerLoaderService } from './core-trigger-loader.service';
import { CoreSceneProjectionService } from './core-scene-projection.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { SpawnManagerService } from '../../runtime/systems/spawn-manager.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';
import { CinematicCameraRegistryService } from '../../runtime/cameras/cinematic-camera-registry.service';
import { PlayerCameraManagerService } from '../../runtime/systems/player-camera.service';
import { PlayerTriggerService } from '../../runtime/systems/player-trigger.service';
import { SceneLoadPayload, SceneObjectDto, TriggerDto } from '../../models/api-dto.model';
import { DynamicLightingSystem } from '../../runtime/systems/lighting/dynamic-lighting.system'; 
import { ShadowOrchestratorService } from '../../runtime/shadows/shadow-orchestrator.service';
import { EngineSessionService } from '../../session/engine-session.service';
  
@Injectable({ providedIn: 'root' })
export class CoreSceneLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private utilsSvc = inject(CoreSceneUtilsService);
  private entityManager = inject(EntityManagerService);
  private loaderModelSvc = inject(CoreModelLoaderService);
  private loaderPrimitiveSvc = inject(CorePrimitiveLoaderService);
  private loaderTriggerSvc = inject(CoreTriggerLoaderService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private gameContext = inject(GameContextService);
  private spawnManager = inject(SpawnManagerService);
  private cinematicSvc = inject(EditorCinematicService);
  private cameraRegistry = inject(CinematicCameraRegistryService);
  private cameraSvc = inject(PlayerCameraManagerService); 
  private triggerSvc = inject(PlayerTriggerService);
  private dynamicLighting = inject(DynamicLightingSystem); 
  private sessionSvc = inject(EngineSessionService);

  public createInvisibleFloor(scene: any): void {
    const old = scene.getMeshByName('sueloInvisible');
    if (old) old.dispose();

    const suelo = MeshBuilder.CreateBox('sueloInvisible', { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5;
    suelo.checkCollisions = true;
    suelo.isVisible = false;
    suelo.isPickable = true;
    suelo.receiveShadows = true;
    Tags.AddTagsTo(suelo, "system_element invisible_floor ignore_raycast");
  }

  public async loadSceneFromData(dataBD: SceneLoadPayload): Promise<void> {
    const sessionId = this.sessionSvc.getSessionId();
    if (!dataBD) return;

    const scene = this.motor3d.getScene();
    const isPlaying = this.gameContext.isPlaying();
    const persistentPlayer = this.entityManager.getAllEntities().find(e => e.isPersistent);

    let envSettings: any = dataBD.scene?.environmentSettings || dataBD.environmentSettings || {};
    if (typeof envSettings === 'string') { try { envSettings = JSON.parse(envSettings); } catch (e) {} }

    let uiSettingsRaw = dataBD.uiSettings || {};
    let uiSettings = {};
    if (typeof uiSettingsRaw === 'string') { 
        try { uiSettings = JSON.parse(uiSettingsRaw); } catch (e) { uiSettings = {}; } 
    } else {
        uiSettings = uiSettingsRaw;
    }

    this.worldSettingsSvc.loadFromDb(envSettings, uiSettings);
    this.worldSettingsSvc.applyToScene(scene, (m) => this.motor3d.setVisualMode(m));

    this.cinematicSvc.loadFromData(dataBD.cinematics || dataBD.cinematicsDelta || []);
    
    if (dataBD.cinematicCameras || dataBD.cinematicCamerasDelta) {
       this.cameraRegistry.loadFromData(dataBD.cinematicCameras || dataBD.cinematicCamerasDelta || []);
    }

    scene.cameras.forEach(cam => cam.maxZ = 10000);

    let objetosBD: SceneObjectDto[] = dataBD.sceneObjects || dataBD.sceneObjectsDelta || [];
    objetosBD = objetosBD.filter(obj => obj.name !== 'Jugador_Prueba' && obj.name !== 'TempPlayer_Fallback');
    
    const triggersBD: TriggerDto[] = dataBD.triggers || dataBD.triggersDelta || [];

    const mallasCreadas = new Map<string, Mesh>();

    for (let i = 0; i < objetosBD.length; i += 5) {
      if (!this.sessionSvc.isSessionActive(sessionId)) return;
      const chunk = objetosBD.slice(i, i + 5);
      const chunkPromises = chunk.map((obj: SceneObjectDto) => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return Promise.resolve();
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');
        const objRol = obj.properties?.rol || obj.rol || 'prop';

        if (isPlaying && persistentPlayer && objRol === 'player') {
            return Promise.resolve();
        }

        if (isModel || (isLight && obj.assetId)) {
          return this.loaderModelSvc.cargarModeloAsync(obj, mallasCreadas);
        } else {
          this.loaderPrimitiveSvc.cargarPrimitiva(obj, mallasCreadas);
          return Promise.resolve();
        }
      });
      await Promise.all(chunkPromises);
      await new Promise(resolve => setTimeout(resolve, 15)); 
    }

    for (let i = 0; i < triggersBD.length; i += 10) {
      if (!this.sessionSvc.isSessionActive(sessionId)) return;
      const chunk = triggersBD.slice(i, i + 10);
      chunk.forEach((trigger: TriggerDto) => {
        this.loaderTriggerSvc.cargarTrigger(trigger, mallasCreadas);
      });
      await new Promise(resolve => setTimeout(resolve, 15));
    }

    if (!this.sessionSvc.isSessionActive(sessionId)) return;

    mallasCreadas.forEach((mesh, uid) => {
      const entity = this.entityManager.getEntityByUid(uid);
      if (entity && entity.parentId) {
        const parentNode = mallasCreadas.get(entity.parentId) || scene.getMeshByName(entity.parentId);
        if (parentNode) mesh.setParent(parentNode);
      }
    });

    if (isPlaying) {
        const resolvedPlayer = await this.spawnManager.resolvePlayerForSession(null, false);
        if (persistentPlayer && resolvedPlayer && resolvedPlayer.uid === persistentPlayer.uid) {
            this.cameraSvc.transicionEntradaPlataforma(persistentPlayer);
            this.triggerSvc.resetTransitionState();
        }
    }

    if (!this.sessionSvc.isSessionActive(sessionId)) return;

    setTimeout(() => {
      if (!this.sessionSvc.isSessionActive(sessionId)) return;
      mallasCreadas.forEach((mesh) => {
        const entity = this.entityManager.getEntityByMesh(mesh);
        if (entity?.type === 'image_plane') {
          this.projectionSvc.actualizarProyeccion(mesh);
        }
      });
    }, 150);

    this.dynamicLighting.prepareAllLights(); 
    this.shadowOrchestrator.asignarObjetosASombrasDeLuces();

    await new Promise<void>((resolve) => {
      if (!this.sessionSvc.isSessionActive(sessionId)) return resolve();
      scene.executeWhenReady(() => {
        if (!this.sessionSvc.isSessionActive(sessionId)) return resolve();
        const actCam = scene.activeCamera;
        let originalPos = Vector3.Zero();
        let originalTarget = Vector3.Zero();

        if (actCam) {
            originalPos.copyFrom(actCam.globalPosition);
            if ((actCam as any).getTarget) originalTarget.copyFrom((actCam as any).getTarget());
            
            const spawnPoint = this.entityManager.getAllEntities().find(e => e.rol === 'spawn_point' || e.rol === 'player');
            if (spawnPoint && spawnPoint.view) {
                actCam.position.copyFrom(spawnPoint.view.getAbsolutePosition());
                actCam.position.y += 1.6;
                const fwd = spawnPoint.view.forward;
                if ((actCam as any).setTarget) {
                    (actCam as any).setTarget(actCam.position.add(fwd.scale(10)));
                }
            }
        }

        this.dynamicLighting.start(); 
        this.shadowOrchestrator.start(); 

        if (actCam) {
            actCam.position.copyFrom(originalPos);
            if ((actCam as any).setTarget) (actCam as any).setTarget(originalTarget);
        }
        
        resolve();
      });
    });
  }

  public async instantiatePrefab(prefab: any, positionTarget: Vector3, rotationEuler?: Vector3, scale?: Vector3, parentNode?: AbstractMesh): Promise<Map<string, Mesh>> {
    const sessionId = this.sessionSvc.getSessionId();
    const mallasCreadas = new Map<string, Mesh>();
    const uidMap = new Map<string, string>(); 

    const hierarchy = prefab.properties?.prefabHierarchy || [prefab];
    const promesasCarga: any[] = [];

    for (const item of hierarchy) {
        if (!this.sessionSvc.isSessionActive(sessionId)) return mallasCreadas;
        const newUid = window.crypto.randomUUID();
        const originalUidForMap = (item as any).originalUid || item.uid || window.crypto.randomUUID();
        uidMap.set(originalUidForMap, newUid);

        const isRoot = item === hierarchy[0];
        
        const propsClone = JSON.parse(JSON.stringify(item.properties || {}));
        this.utilsSvc.renovarIdsDeSecuencias(propsClone);

        const itemPos = item.position || { x: 0, y: 0, z: 0 };
        const itemRot = item.rotation || { x: 0, y: 0, z: 0 };
        const itemScale = item.scale || { x: 1, y: 1, z: 1 };

        let finalPos = { ...itemPos };
        let finalRot = { ...itemRot };
        let finalScale = { ...itemScale };

        if (isRoot) {
            finalPos = { x: positionTarget.x, y: positionTarget.y, z: positionTarget.z };
            if (rotationEuler) finalRot = { x: rotationEuler.x, y: rotationEuler.y, z: rotationEuler.z };
            // 🔥 FASE 2 FIX: Aplicar la escala deseada directamente, sin multiplicar por la escala nativa
            // para evitar el crecimiento cuadrático (30 -> 900) o la reducción extrema (0.003 -> 0.000009)
            if (scale) finalScale = { x: scale.x, y: scale.y, z: scale.z };
        }

        const mockDbObject: SceneObjectDto = {
            uid: newUid,
            type: item.type,
            name: item.name + '_' + Math.floor(Math.random() * 1000),
            position: finalPos,
            rotation: finalRot,
            scale: finalScale,
            properties: propsClone,
            assetId: item.assetId,
            asset: { path: propsClone.path },
            parentId: isRoot ? (parentNode?.metadata?.uid || parentNode?.name || null) : uidMap.get((item as any).parentOriginalUid) 
        };

        const isModel = mockDbObject.type === 'model';
        const isLight = mockDbObject.type?.startsWith('light_');

        if (isModel || (isLight && mockDbObject.assetId)) {
            promesasCarga.push(this.loaderModelSvc.cargarModeloAsync(mockDbObject, mallasCreadas));
        } else {
            this.loaderPrimitiveSvc.cargarPrimitiva(mockDbObject, mallasCreadas);
        }
    }

    await Promise.all(promesasCarga);
    if (!this.sessionSvc.isSessionActive(sessionId)) return mallasCreadas;

    mallasCreadas.forEach((mesh, uid) => {
        const entity = this.entityManager.getEntityByUid(uid);
        if (entity && entity.parentId) {
            const parentMesh = mallasCreadas.get(entity.parentId) || this.motor3d.getScene().getMeshByName(entity.parentId);
            if (parentMesh) {
                mesh.setParent(parentMesh);
                entity.syncTransformFromView();
            }
        }
    });

    this.dynamicLighting.prepareAllLights(); 
    this.shadowOrchestrator.asignarObjetosASombrasDeLuces();
    return mallasCreadas;
  }
}