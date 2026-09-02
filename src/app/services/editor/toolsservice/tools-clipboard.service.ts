
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { EditorStateService } from '../editor-state.service';
import { EditorSceneService } from '../editor-scene.service';
import { EditorMapaService } from '../../editor-mapa.service';
import { CoreSceneUtilsService } from '../../../core/engine/scene/utils/core-scene-utils.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { GameContextService } from '../../../core/engine/session/game-context.service';

@Injectable({ providedIn: 'root' })
export class ToolsClipboardService {
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private sceneSvc = inject(EditorSceneService);
  private utilsSvc = inject(CoreSceneUtilsService);
  private entityManager = inject(EntityManagerService);
  private gameContext = inject(GameContextService);

  private objetoEnPortapapeles: AbstractMesh | null = null;
  private listenerCtrlZAgregado = false;

  public initKeyboardListeners(): void {
    if (!this.listenerCtrlZAgregado) {
      window.addEventListener('keydown', this.manejarCtrlZGlobal, true);
      this.listenerCtrlZAgregado = true;
    }
  }

  private manejarCtrlZGlobal = (event: KeyboardEvent) => {
    const canEdit = this.gameContext.authorityProfile().canEdit;
    if (!canEdit) return;

    const playState = this.state.playState();
    if (!(playState === 'EDITOR' || playState === 'EDITING_IN_GAME')) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() !== 'z') return;
    
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    
    event.preventDefault();
    event.stopPropagation();
    this.deshacerAccion();
  };

  public copiarObjeto(): void {
    const obj = this.state.objetoSeleccionado() as AbstractMesh;
    if (obj) this.objetoEnPortapapeles = obj;
  }

  public pegarObjeto(): void {
    if (!this.objetoEnPortapapeles) return;
    
    const objOriginal = this.objetoEnPortapapeles;
    const entityOriginal = this.entityManager.getEntityByMesh(objOriginal);
    if (!entityOriginal) return;

    let clon: AbstractMesh;
    const nuevoNombre = objOriginal.name + '_Copia_' + Math.floor(Math.random() * 1000);

    const hasAsset = !!entityOriginal.visual.assetId;
    const isModelOrLightModel = entityOriginal.type === 'model' || (entityOriginal.type?.startsWith('light_') && hasAsset);

    if (isModelOrLightModel) {
      const parentClone = objOriginal.instantiateHierarchy(null, { doNotInstantiate: true });
      clon = parentClone as AbstractMesh;
      clon.name = nuevoNombre;
      clon.checkCollisions = objOriginal.checkCollisions;
      clon.isPickable = true;
      clon.getChildMeshes().forEach((m, i) => {
        m.isPickable = true;
        m.checkCollisions = objOriginal.getChildMeshes()[i]?.checkCollisions ?? true;
      });
    } else {
      clon = objOriginal.clone(nuevoNombre, null) as AbstractMesh;
    }

    clon.position = objOriginal.position.clone();
    clon.position.x += 1;
    clon.position.z += 1;

    if (objOriginal.rotationQuaternion) clon.rotationQuaternion = objOriginal.rotationQuaternion.clone();
    else clon.rotation = objOriginal.rotation.clone();

    clon.scaling = objOriginal.scaling.clone();
    
    const newEntity = new GameEntity(window.crypto.randomUUID(), nuevoNombre, entityOriginal.type, entityOriginal.rol);
    newEntity.transform = JSON.parse(JSON.stringify(entityOriginal.transform));
    newEntity.visual = JSON.parse(JSON.stringify(entityOriginal.visual));
    newEntity.collider = JSON.parse(JSON.stringify(entityOriginal.collider));
    newEntity.interaction = JSON.parse(JSON.stringify(entityOriginal.interaction));
    newEntity.selectionRange = JSON.parse(JSON.stringify(entityOriginal.selectionRange));
    
    if (entityOriginal.playerConfig) newEntity.playerConfig = JSON.parse(JSON.stringify(entityOriginal.playerConfig));
    if (entityOriginal.light) newEntity.light = JSON.parse(JSON.stringify(entityOriginal.light));
    if (entityOriginal.media) newEntity.media = JSON.parse(JSON.stringify(entityOriginal.media));
    if (entityOriginal.trigger) newEntity.trigger = JSON.parse(JSON.stringify(entityOriginal.trigger));
    
    newEntity.camOffset = JSON.parse(JSON.stringify(entityOriginal.camOffset));
    newEntity.animationNames = [...entityOriginal.animationNames];
    newEntity.autoAnim = JSON.parse(JSON.stringify(entityOriginal.autoAnim));
    if (entityOriginal.initialHeadLocal) {
       newEntity.initialHeadLocal = entityOriginal.initialHeadLocal.clone();
    }

    this.utilsSvc.renovarIdsDeSecuencias(newEntity);

    newEntity.bindView(clon);
    this.entityManager.addEntity(newEntity);

    clon.isPickable = true;

    this.sceneSvc.actualizarListaNodos();
    this.state.seleccionarObjeto(clon);
    this.historialSvc.registrarAccionCrear(clon);
    this.mapaSvc.onMapChanged.next();
  }

  public deshacerAccion(): void {
    if (this.historialSvc.deshacer()) {
      this.sceneSvc.actualizarListaNodos();
      this.mapaSvc.onGizmoDrag.next();
      this.mapaSvc.onMapChanged.next();
    }
  }
}