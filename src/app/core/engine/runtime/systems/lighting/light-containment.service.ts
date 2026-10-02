import { Injectable, inject } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags, Mesh, InstancedMesh, Node, MultiMaterial, Material } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';

export interface LightContainmentAuditReport {
  lightUid: string;
  containerUid: string;
  containerFound: boolean;
  containerName: string;
  runtimeRootName: string;
  totalDescendants: number;
  totalRenderableMeshes: number;
  totalReceivers: number;
  rejectedCount: number;
  rejectedDetails: Array<{ meshName: string; reason: string }>;
  materialsSummary: Array<{ meshName: string; materialType: string; isMulti: boolean; subMaterialsCount: number; maxLights: number }>;
}

@Injectable({ providedIn: 'root' })
export class LightContainmentService {
  private entityManager = inject(EntityManagerService);

  private containerRenderablesCache = new Map<string, AbstractMesh[]>();
  private strictInteriorReceiversCache = new Map<string, AbstractMesh[]>();
  private lastAuditReport: LightContainmentAuditReport | null = null;

  public metrics = {
    containmentRebuilds: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  public markDirty(containerOrLightUid?: string): void {
    if (containerOrLightUid) {
      this.containerRenderablesCache.delete(containerOrLightUid);
      this.strictInteriorReceiversCache.delete(containerOrLightUid);
    } else {
      this.clearAllCache();
    }
  }

  public clearAllCache(): void {
    this.containerRenderablesCache.clear();
    this.strictInteriorReceiversCache.clear();
    this.lastAuditReport = null;
    this.metrics.containmentRebuilds = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
  }

  public getLastAuditReport(): LightContainmentAuditReport | null {
    return this.lastAuditReport;
  }

  /**
   * Resuelve la entidad contenedora (modelo padre) a la cual está asociada la luz.
   */
  public resolveContainerEntity(lightEntity: GameEntity, scene: Scene): GameEntity | null {
    const lightComp = lightEntity.light;
    if (!lightComp) return null;

    // 1. Contenedor explícito asignado por UI/Inspector
    if (lightComp.containerEntityUid) {
      const explicit = this.entityManager.getEntityByUid(lightComp.containerEntityUid);
      if (explicit && explicit.view) return explicit;
    }

    // 2. Padre jerárquico directo en ECS
    if (lightEntity.parentId) {
      const parentEnt = this.entityManager.getEntityByUid(lightEntity.parentId);
      if (parentEnt && parentEnt.view) {
        return parentEnt;
      }
    }

    // 3. Padre físico en el grafo de escena de Babylon
    if (lightEntity.view && lightEntity.view.parent) {
      let currentParent: Node | null = lightEntity.view.parent;
      while (currentParent) {
        const ent = this.entityManager.getEntityByMesh(currentParent as AbstractMesh);
        if (ent && ent.uid !== lightEntity.uid && (ent.type === 'model' || ent.type === 'cube')) {
          return ent;
        }
        currentParent = currentParent.parent;
      }
    }

    // 4. Fallback por detección de volumen espacial (Bounding Box)
    const lightPos = lightEntity.view
      ? lightEntity.view.getAbsolutePosition()
      : new Vector3(
          lightEntity.transform.position.x,
          lightEntity.transform.position.y,
          lightEntity.transform.position.z
        );

    const candidates = this.entityManager
      .getAllEntities()
      .filter(
        e =>
          e.uid !== lightEntity.uid &&
          (e.type === 'model' || e.type === 'cube') &&
          e.view &&
          !e.view.isDisposed()
      );

    let closestContainer: GameEntity | null = null;
    let smallestVolume = Number.MAX_VALUE;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand.view) continue;

      cand.view.computeWorldMatrix(true);
      const bounds = cand.view.getHierarchyBoundingVectors(true);
      const min = bounds.min;
      const max = bounds.max;

      const inside =
        lightPos.x >= min.x &&
        lightPos.x <= max.x &&
        lightPos.y >= min.y &&
        lightPos.y <= max.y &&
        lightPos.z >= min.z &&
        lightPos.z <= max.z;

      if (inside) {
        const size = max.subtract(min);
        const volume = Math.abs(size.x * size.y * size.z);
        if (volume < smallestVolume) {
          smallestVolume = volume;
          closestContainer = cand;
        }
      }
    }

    return closestContainer;
  }

  /**
   * RECORRIDO RECURSIVO PURO DE TODO EL ÁRBOL DEL MODELO.
   * Encuentra TODOS los AbstractMesh renderizables que pertenezcan al modelo padre,
   * sin importar TransformNodes intermedios, profundidad de anidación o partOverrides.
   */
  public getAllRenderableMeshesFromModel(rootNode: Node): {
    renderables: AbstractMesh[];
    totalDescendantsCount: number;
    rejected: Array<{ meshName: string; reason: string }>;
  } {
    const renderables: AbstractMesh[] = [];
    const rejected: Array<{ meshName: string; reason: string }> = [];
    let totalDescendantsCount = 0;

    const visitedNodes = new Set<Node>();

    const traverse = (node: Node) => {
      if (!node || visitedNodes.has(node)) return;
      visitedNodes.add(node);
      totalDescendantsCount++;

      if (node.isDisposed()) {
        rejected.push({ meshName: node.name, reason: 'Nodo descartado (disposed)' });
        return;
      }

      // Si es un nodo de sistema, auxiliar o visual de luz, se excluye legítimamente
      if (
        Tags.MatchesQuery(
          node,
          'editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual || ignore_raycast'
        )
      ) {
        rejected.push({ meshName: node.name, reason: 'Etiqueta de sistema/colisionador (Tags exclude)' });
        return;
      }

      if (node instanceof AbstractMesh) {
        const className = node.getClassName();

        if (className === 'InstancedMesh') {
          const instanced = node as InstancedMesh;
          if (instanced.sourceMesh && !instanced.sourceMesh.isDisposed()) {
            renderables.push(instanced);
          } else {
            rejected.push({ meshName: node.name, reason: 'InstancedMesh sin sourceMesh válido' });
          }
        } else if (className === 'Mesh') {
          const mesh = node as Mesh;
          // Un mesh es renderizable si tiene geometría o si contiene subMeshes con vértices
          if (mesh.getTotalVertices() > 0) {
            renderables.push(mesh);
          } else {
            rejected.push({ meshName: node.name, reason: 'Mesh sin vértices (contenedor transformational puro)' });
          }
        } else {
          // Otros subtipos de AbstractMesh (Ground, Ribbon, etc.)
          if (node.getTotalVertices && node.getTotalVertices() > 0) {
            renderables.push(node);
          } else {
            rejected.push({ meshName: node.name, reason: `Clase ${className} sin vértices geométricos` });
          }
        }
      }

      const children = node.getChildren(undefined, false);
      for (let i = 0; i < children.length; i++) {
        traverse(children[i]);
      }
    };

    // Iniciar traversal en la raíz y en todos sus descendientes
    traverse(rootNode);

    return { renderables, totalDescendantsCount, rejected };
  }

  /**
   * Obtiene la lista completa de mallas receptoras para una PointLight en modo INTERIOR.
   */
  public getInteriorMeshesStrict(lightEntity: GameEntity, scene: Scene): AbstractMesh[] {
    const cacheKey = `${lightEntity.uid}_${lightEntity.light?.containerEntityUid || 'auto'}`;

    if (this.strictInteriorReceiversCache.has(cacheKey)) {
      this.metrics.cacheHits++;
      return this.strictInteriorReceiversCache.get(cacheKey)!;
    }

    this.metrics.cacheMisses++;
    this.metrics.containmentRebuilds++;

    const container = this.resolveContainerEntity(lightEntity, scene);
    if (!container || !container.view) {
      this.strictInteriorReceiversCache.set(cacheKey, []);
      this.lastAuditReport = {
        lightUid: lightEntity.uid,
        containerUid: lightEntity.light?.containerEntityUid || 'none',
        containerFound: false,
        containerName: 'NOT_FOUND',
        runtimeRootName: 'NONE',
        totalDescendants: 0,
        totalRenderableMeshes: 0,
        totalReceivers: 0,
        rejectedCount: 0,
        rejectedDetails: [],
        materialsSummary: []
      };
      return [];
    }

    // 1. Recolección exhaustiva de todos los renderables del modelo contenedor
    const { renderables, totalDescendantsCount, rejected } = this.getAllRenderableMeshesFromModel(container.view);

    // 2. Comprobación y ajuste de capacidad de iluminación en los materiales
    const materialsSummary: LightContainmentAuditReport['materialsSummary'] = [];
    const finalReceiversSet = new Set<AbstractMesh>();

    for (let i = 0; i < renderables.length; i++) {
      const mesh = renderables[i];
      finalReceiversSet.add(mesh);

      // Auditar y garantizar que el material soporte la luz
      const mat = mesh.material;
      if (mat) {
        if (mat.getClassName() === 'MultiMaterial') {
          const multi = mat as MultiMaterial;
          const subMats = multi.subMaterials || [];
          subMats.forEach((sub: Material | null) => {
            if (sub && (sub as any).maxSimultaneousLights !== undefined) {
              if ((sub as any).maxSimultaneousLights < 8) {
                (sub as any).maxSimultaneousLights = 8;
              }
            }
          });
          materialsSummary.push({
            meshName: mesh.name,
            materialType: 'MultiMaterial',
            isMulti: true,
            subMaterialsCount: subMats.length,
            maxLights: 8
          });
        } else {
          if ((mat as any).maxSimultaneousLights !== undefined) {
            if ((mat as any).maxSimultaneousLights < 8) {
              (mat as any).maxSimultaneousLights = 8;
            }
          }
          materialsSummary.push({
            meshName: mesh.name,
            materialType: mat.getClassName(),
            isMulti: false,
            subMaterialsCount: 1,
            maxLights: (mat as any).maxSimultaneousLights ?? 4
          });
        }
      } else {
        materialsSummary.push({
          meshName: mesh.name,
          materialType: 'NO_MATERIAL',
          isMulti: false,
          subMaterialsCount: 0,
          maxLights: 0
        });
      }
    }

    // 3. Incorporar otros objetos que residan espacialmente dentro del volumen del modelo
    const containerBounds = container.view.getHierarchyBoundingVectors(true);
    const cMin = containerBounds.min;
    const cMax = containerBounds.max;

    const allEntities = this.entityManager.getAllEntities();
    for (let i = 0; i < allEntities.length; i++) {
      const e = allEntities[i];
      if (e === container || e === lightEntity || !e.view) continue;
      if (e.type.startsWith('light_') || e.type === 'trigger' || e.type === 'trigger_compuesto') continue;

      const ePos = e.view.getAbsolutePosition();
      const isInside =
        ePos.x >= cMin.x &&
        ePos.x <= cMax.x &&
        ePos.y >= cMin.y &&
        ePos.y <= cMax.y &&
        ePos.z >= cMin.z &&
        ePos.z <= cMax.z;

      if (isInside) {
        const extra = this.getAllRenderableMeshesFromModel(e.view);
        extra.renderables.forEach(m => finalReceiversSet.add(m));
      }
    }

    const finalReceivers = Array.from(finalReceiversSet);
    this.strictInteriorReceiversCache.set(cacheKey, finalReceivers);

    // Registro de diagnóstico completo
    this.lastAuditReport = {
      lightUid: lightEntity.uid,
      containerUid: container.uid,
      containerFound: true,
      containerName: container.name,
      runtimeRootName: container.view.name,
      totalDescendants: totalDescendantsCount,
      totalRenderableMeshes: renderables.length,
      totalReceivers: finalReceivers.length,
      rejectedCount: rejected.length,
      rejectedDetails: rejected,
      materialsSummary: materialsSummary
    };

    return finalReceivers;
  }

  /**
   * Aplica la contención a la PointLight/SpotLight física de Babylon.js.
   */
  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';

    // Fast-path: Evitar re-evaluaciones innecesarias si nada relevante cambió
    const cacheStamp = `${mode}_${entity.light?.containerEntityUid || ''}_${entity.uid}`;
    if ((light as any)._containmentAppliedStamp === cacheStamp && !entity.isDirty) {
      return;
    }

    if (mode === 'INTERIOR') {
      const receivers = this.getInteriorMeshesStrict(entity, scene);
      if (receivers.length > 0) {
        light.includedOnlyMeshes = [...receivers];
        light.excludedMeshes = [];
      } else {
        light.includedOnlyMeshes = [];
        light.excludedMeshes = [];
      }
    } else if (mode === 'EXTERIOR') {
      const receivers = this.getInteriorMeshesStrict(entity, scene);
      light.includedOnlyMeshes = [];
      light.excludedMeshes = [...receivers];
    } else {
      // GLOBAL
      light.includedOnlyMeshes = [];
      light.excludedMeshes = [];
    }

    (light as any)._containmentAppliedStamp = cacheStamp;
  }

  public clearContainment(light: PointLight | SpotLight): void {
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
    (light as any)._containmentAppliedStamp = undefined;
  }
}