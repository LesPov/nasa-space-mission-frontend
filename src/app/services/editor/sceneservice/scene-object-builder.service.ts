import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh, MeshBuilder, Tags, Vector3 } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { HistorialService } from '../../historial.service';
import { SceneNodesService } from './scene-nodes.service';
import { CorePrimitiveLoaderService } from '../../../core/engine/scene/utils/core-primitive-loader.service';
import { CoreModelLoaderService } from '../../../core/engine/scene/utils/core-model-loader.service';
import { BuilderTriggerService } from './builder-trigger.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { ShadowOrchestratorService } from '../../../core/engine/runtime/shadows/shadow-orchestrator.service';
import { DynamicLightingSystem } from '../../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { AssetDto, SceneObjectDto } from '../../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class SceneObjectBuilderService {
  private mapaSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private nodesSvc = inject(SceneNodesService);
  private modelLoader = inject(CoreModelLoaderService);
  private primitiveLoader = inject(CorePrimitiveLoaderService);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private triggerBuilderSvc = inject(BuilderTriggerService);
  private entityManager = inject(EntityManagerService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.triggerBuilderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null, actionType: string = 'show_message'): void {
    this.triggerBuilderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode, actionType);
  }

  public async agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: AssetDto | null,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null,
    position?: Vector3,
    localRotation?: Vector3 
  ): Promise<void> {
    
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
      this.triggerBuilderSvc.agregarTriggerCustom(nombre, 'cube', tipo === 'trigger_compuesto', mensaje, sizeX, sizeY, sizeZ, parentNode, 'show_message');
      return;
    }

    const isLight = tipo.startsWith('light_');

    if (isLight) {
        sizeX = 1;
        sizeY = 1;
        sizeZ = 1;
    } else if (tipo === 'model' && asset) {
        sizeX = 1;
        sizeY = 1;
        sizeZ = 1;
    }

    let resolvedParentUid: string | null = null;
    if (parentNode) {
      const parentEntity = this.entityManager.getEntityByMesh(parentNode);
      resolvedParentUid = parentEntity ? parentEntity.uid : (parentNode.metadata?.entityUid || parentNode.metadata?.uid || null);
    }

    // 🔥 FIX ESTRICTO: Solo cargamos el AssetContainer si existe una ruta real a un archivo (.glb).
    // Si la luz no tiene un archivo asignado, entrará al Primitive Loader como corresponde, sin generar cubos de error.
    const hasValidAssetPath = !!((asset as any)?.path || (asset as any)?.asset?.path || (asset as any)?.properties?.path);

    const mockDbObject: SceneObjectDto & { isNewCreation?: boolean } = {
      uid: window.crypto.randomUUID(),
      name: nombre,
      type: tipo,
      isNewCreation: true, 
      properties: {
        rol: isLight ? 'light' : rol,
        color: colorHex,
        colorBW: colorHex,
        isSolid: isLight ? false : isSolid,
        isSelectable: isSelectable,
        mensaje: mensaje,
        path: hasValidAssetPath ? ((asset as any)?.path || (asset as any)?.asset?.path || (asset as any)?.properties?.path) : undefined
      },
      assetId: asset?.id || null,
      position: position ? { x: position.x, y: position.y, z: position.z } : (parentNode ? { x: 0, y: 0.5, z: 0 } : { x: 0, y: 0, z: 0 }),
      rotation: localRotation ? { x: localRotation.x, y: localRotation.y, z: localRotation.z } : { x: 0, y: 0, z: 0 },
      scale: { x: sizeX, y: sizeY, z: sizeZ },
      parentId: resolvedParentUid
    };

    if (isLight) {
        mockDbObject.properties!.intensity = 5;
        mockDbObject.properties!.lightColor = colorHex;
        mockDbObject.properties!.lightColorBW = colorHex;
        mockDbObject.properties!.angle = 45;
        mockDbObject.properties!.isEnabled = true;
        (mockDbObject.properties as any).castShadows = true;
    }

    const isModel = tipo === 'model';
    const mallasCreadas = new Map<string, Mesh>();

    // 🔥 Flujo resuelto: Modelos importados van al modelo, primitivas y luces vacías van a primitiva.
    if (isModel || (isLight && hasValidAssetPath)) {
      await this.modelLoader.cargarModeloAsync(mockDbObject, mallasCreadas);
    } else {
      this.primitiveLoader.cargarPrimitiva(mockDbObject, mallasCreadas);
    }

    const newMesh = mallasCreadas.get(mockDbObject.uid);
    if (newMesh) {
      if (parentNode) {
         newMesh.setParent(parentNode);
         
         if (isLight) {
            newMesh.computeWorldMatrix(true);
            const absScale = new Vector3();
            newMesh.getWorldMatrix().decompose(absScale);
            const visual = newMesh.getChildMeshes().find(m => Tags.MatchesQuery(m, "light_visual") || (m as any).metadata?.isLightVisual);
            if (visual) {
               visual.scaling.set(
                 0.4 / Math.max(0.0001, Math.abs(absScale.x)),
                 0.4 / Math.max(0.0001, Math.abs(absScale.y)),
                 0.4 / Math.max(0.0001, Math.abs(absScale.z))
               );
               visual.renderingGroupId = 1;
            }
         }
      }
      
      const ent = this.entityManager.getEntityByMesh(newMesh);
      if (ent) {
          ent.parentId = resolvedParentUid;
          ent.syncTransformFromView(); 
          ent.isDirty = true;
      }
      
      this.dynamicLighting.prepareAllLights();
      this.shadowOrchestrator.asignarObjetosASombrasDeLuces();
      
      this.nodesSvc.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(newMesh);
      this.mapaSvc.onMapChanged.next();
    }
  }
}