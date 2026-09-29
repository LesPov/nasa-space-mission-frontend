
import { Component, OnInit, OnDestroy, inject, effect, untracked, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Node, AbstractMesh, Tags, Mesh, Light, TransformNode } from '@babylonjs/core';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { OutlinerStateService } from '../outliner-state.service';
import { EditorCameraService } from '../../../../services/editor/editor-camera.service';
import { SceneNodesService } from '../../../../services/editor/sceneservice/scene-nodes.service';
import { ToolsClipboardService } from '../../../../services/editor/toolsservice/tools-clipboard.service';
import { PrefabManagerService } from '../../../../services/editor/prefab-manager.service';
import { Subscription } from 'rxjs';
import { OutlinerNodeItemComponent } from '../outliner-node-item/outliner-node-item';

@Component({
  selector: 'app-scene-outliner',
  standalone: true,
  imports: [CommonModule, OutlinerNodeItemComponent],
  templateUrl: './scene-outliner.html',
  styleUrls: ['./scene-outliner.css']
})
export class SceneOutlinerComponent implements OnInit, OnDestroy {
  private stateSvc = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private mapaSvc = inject(EditorMapaService);
  public outlinerState = inject(OutlinerStateService);
  private cdr = inject(ChangeDetectorRef);
  
  private cameraSvc = inject(EditorCameraService);
  private nodesSvc = inject(SceneNodesService);
  private clipboardSvc = inject(ToolsClipboardService);
  private prefabManager = inject(PrefabManagerService);

  public rootNodes: Node[] = [];
  private mapChangeSub!: Subscription;

  constructor() {
    effect(() => {
      const nodos = this.stateSvc.nodosEscena();
      untracked(() => {
        this.calculateRoots(nodos);
      });
    });
  }

  ngOnInit() {
    this.calculateRoots(this.stateSvc.nodosEscena());
    this.mapChangeSub = this.mapaSvc.onMapChanged.subscribe(() => {
        this.calculateRoots(this.stateSvc.nodosEscena());
    });
  }

  ngOnDestroy() {
    if (this.mapChangeSub) this.mapChangeSub.unsubscribe();
  }

  private calculateRoots(allNodes: Node[]) {
    const roots = allNodes.filter(n => {
      if (n.parent && n.parent.name !== '__root__') return false;
      return this.isValidOutlinerNode(n);
    });
    
    this.rootNodes = roots.sort((a, b) => {
      const eA = this.entityManager.getEntityByMesh(a as AbstractMesh);
      const eB = this.entityManager.getEntityByMesh(b as AbstractMesh);
      return (eA?.orderIndex || 0) - (eB?.orderIndex || 0);
    });
    
    this.cdr.detectChanges();
  }

  private isValidOutlinerNode(child: Node): boolean {
    if (Tags.MatchesQuery(child, "system_element || fog_element || debug_element || proxy_collider || decal || editor_only || invisible_floor")) return false;
    const name = child.name.toLowerCase();
    if (name.includes('backgroundhelper') || name.includes('skybox') || name.includes('environment')) return false;
    return true;
  }

  public trackByUid(index: number, node: Node): string {
    return node.uniqueId.toString();
  }

  // --- ROOT DRAG & DROP ---

  public onDragOverRoot(event: DragEvent) {
    event.preventDefault();
  }

  public onDragLeaveRoot(event: DragEvent) {
  }

  public onDropRoot(event: DragEvent) {
    event.preventDefault();
    const draggedNode = this.outlinerState.draggedNode();
    
    if (draggedNode && draggedNode.parent) {
      if (typeof (draggedNode as any).setParent === 'function') {
        (draggedNode as any).setParent(null);
      } else {
        draggedNode.parent = null;
      }
      
      const draggedEntity = this.entityManager.getEntityByMesh(draggedNode as AbstractMesh);
      if (draggedEntity) {
          draggedEntity.parentId = null;
          draggedEntity.syncTransformFromView();
          draggedEntity.isDirty = true;
      }

      this.mapaSvc.onMapChanged.next();
      this.calculateRoots(this.stateSvc.nodosEscena());
    }
    this.outlinerState.draggedNode.set(null);
  }

  // --- CONTEXT MENU ACTIONS ---

  public closeContextMenu() {
    this.outlinerState.contextMenuOpen.set(false);
  }

  public focusNode() {
    const node = this.outlinerState.contextMenuNode();
    if (node) this.cameraSvc.enfocarObjetoEnEditor(node);
    this.closeContextMenu();
  }

  public duplicateNode() {
    const node = this.outlinerState.contextMenuNode();
    if (node) {
      this.stateSvc.seleccionarObjeto(node);
      this.clipboardSvc.copiarObjeto();
      this.clipboardSvc.pegarObjeto();
    }
    this.closeContextMenu();
  }

  public saveAsPrefab() {
    const node = this.outlinerState.contextMenuNode();
    if (node && node instanceof AbstractMesh) {
      const nombreDefecto = node.name + '_Prefab';
      const nombre = prompt('Ingresa un nombre para el nuevo Prefab:', nombreDefecto);
      
      if (nombre && nombre.trim() !== '') {
        this.prefabManager.createPrefabFromMesh(node, nombre).then(() => {
            alert('📦 Prefab guardado exitosamente.\nBúscalo en la pestaña "Prefabs" de la Línea de Tiempo.');
        }).catch(err => {
            alert('Error al crear Prefab: ' + err);
        });
      }
    }
    this.closeContextMenu();
  }

  public deleteNode() {
    const node = this.outlinerState.contextMenuNode();
    if (node) {
      this.stateSvc.seleccionarObjeto(node);
      this.nodesSvc.eliminarSeleccionado();
    }
    this.closeContextMenu();
  }
}