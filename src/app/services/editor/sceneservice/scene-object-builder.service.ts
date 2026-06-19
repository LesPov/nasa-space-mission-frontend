
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Mesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { HistorialService } from '../../historial.service';
import { SceneNodesService } from './scene-nodes.service';
import { CorePrimitiveLoaderService } from '../../../core/engine/scene/utils/core-primitive-loader.service';
import { CoreModelLoaderService } from '../../../core/engine/scene/utils/core-model-loader.service';
import { CoreSceneShadowsService } from '../../../core/engine/scene/utils/core-scene-shadows.service';
import { BuilderTriggerService } from './builder-trigger.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class SceneObjectBuilderService {
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private nodesSvc = inject(SceneNodesService);
  private modelLoader = inject(CoreModelLoaderService);
  private primitiveLoader = inject(CorePrimitiveLoaderService);
  private shadowsSvc = inject(CoreSceneShadowsService);
  private triggerBuilderSvc = inject(BuilderTriggerService);
  private entityManager = inject(EntityManagerService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    return this.triggerBuilderSvc.reconstruirMallaTrigger(oldMesh, nuevaForma);
  }

  public agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null): void {
    this.triggerBuilderSvc.agregarTriggerCustom(nombre, shape, isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode);
  }

  public async agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): Promise<void> {
    
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
      this.triggerBuilderSvc.agregarTriggerCustom(nombre, 'cube', tipo === 'trigger_compuesto', mensaje, sizeX, sizeY, sizeZ, parentNode);
      return;
    }

    const mockDbObject = {
      uid: window.crypto.randomUUID(),
      name: nombre,
      type: tipo,
      properties: {
        rol: tipo.startsWith('light_') ? 'light' : rol,
        color: colorHex,
        colorBW: colorHex,
        isSolid: isSolid,
        isSelectable: isSelectable,
        mensaje: mensaje,
        path: asset?.path
      },
      assetId: asset?.id,
      position: parentNode ? {x:0, y: (tipo==='image_plane' ? -2 : 0), z:0} : { x: 0, y: tipo.startsWith('light_') ? 2 : (0.5 * sizeY), z: 0 },
      scale: { x: sizeX, y: sizeY, z: sizeZ },
      parentId: parentNode?.metadata?.uid || null
    };

    const isModel = tipo === 'model';
    const isLight = tipo.startsWith('light_');
    const mallasCreadas = new Map<string, Mesh>();

    if ((isLight && asset) || (isModel && asset)) {
      await this.modelLoader.cargarModeloAsync(mockDbObject, mallasCreadas);
    } else {
      this.primitiveLoader.cargarPrimitiva(mockDbObject, mallasCreadas);
    }

    const newMesh = mallasCreadas.get(mockDbObject.uid);
    if (newMesh) {
      const ent = this.entityManager.getEntityByMesh(newMesh);
      if (ent) ent.isDirty = true;
      if (parentNode) newMesh.setParent(parentNode);
      this.shadowsSvc.asignarObjetosASombrasDeLuces();
      this.state.objetoSeleccionado.set(newMesh);
      this.nodesSvc.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(newMesh);
      this.state.triggerUpdate();
    }
  }
}