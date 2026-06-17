
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Color3, PointLight, SpotLight, DirectionalLight, TransformNode, Light, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

interface AttachedNodeOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-prop-light',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-light.html',
  styleUrls: ['./prop-light.css']
})
export class PropLight implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;

  private editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  isPoint = false;
  isSpot = false;
  isDirectional = false;

  lightColor = '#ffffff';
  intensity = 1.0;
  range = 50;
  angle = 60;

  lightPosX = 0;
  lightPosY = 0;
  lightPosZ = 0;

  public childNodes: AttachedNodeOption[] = [];
  public attachedNodePath: string = '';
  public attachedNodeName: string = '';

  animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) {
      this.syncData();
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private formatNum(val: number): number { return parseFloat(Number(val || 0).toFixed(3)); }

  private getAllAttachableNodes(): Array<TransformNode | AbstractMesh> {
    if (!this.objeto) return [];

    const nodes = [
      ...(this.objeto.getChildTransformNodes(false) || []),
      ...(this.objeto.getChildMeshes(false) || [])
    ] as Array<TransformNode | AbstractMesh>;

    const unique = new Map<string, TransformNode | AbstractMesh>();
    for (const n of nodes) {
      if (!n?.name) continue;
      if (n === this.objeto) continue;
      if (!unique.has(n.name)) unique.set(n.name, n);
    }

    return Array.from(unique.values());
  }

  private buildNodePath(node: any): string {
    const parts: string[] = [];
    let current: any = node;

    while (current) {
      if (current.name) {
        parts.unshift(current.name);
      }

      const parent: any = current.parent;
      if (!parent || parent === this.objeto) {
        if (parent && parent !== this.objeto && parent.name) {
          parts.unshift(parent.name);
        }
        break;
      }

      current = parent;
    }

    return parts.join('/');
  }

  private resolveNodeByPath(path: string): TransformNode | AbstractMesh | null {
    if (!this.objeto || !path) return null;

    const nodes = this.getAllAttachableNodes();

    const byPath = nodes.find(n => this.buildNodePath(n) === path);
    if (byPath) return byPath;

    const byName = nodes.find(n => n.name === path);
    if (byName) return byName;

    return null;
  }

  private getAttachedLight(): Light | null {
    if (!this.objeto) return null;

    const found = this.objeto.getDescendants(false).find(
      (child): child is Light =>
        child instanceof PointLight ||
        child instanceof SpotLight ||
        child instanceof DirectionalLight
    );

    return found || null;
  }

  private applyAttachment(light: Light | null) {
    if (!light || !this.objeto) return;

    const targetNode = this.attachedNodePath !== "" ? (
      this.resolveNodeByPath(this.attachedNodePath) ||
      this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName) ||
      null
    ) : null;

    if (targetNode) {
      light.parent = targetNode;
    } else {
      light.parent = this.objeto;
    }
  }

  private getAnimatedNodeNames(): Set<string> {
    const scene = this.objeto?.getScene?.();
    const names = new Set<string>();
    if (!scene) return names;

    for (const ag of scene.animationGroups || []) {
      for (const ta of ag.targetedAnimations || []) {
        const target: any = ta?.target;
        if (target?.name) names.add(target.name);
      }
    }

    return names;
  }

  syncData() {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity || !entity.light) return;

    this.isPoint = entity.type === 'light_point';
    this.isSpot = entity.type === 'light_spot';
    this.isDirectional = entity.type === 'light_directional';

    this.lightColor = entity.light.lightColor || '#ffffff';
    this.intensity = entity.light.intensity ?? 1.0;
    this.range = entity.light.range ?? 50;
    this.angle = entity.light.angle ?? 60;
    
    this.lightPosX = this.formatNum(entity.light.lightPosX ?? 0);
    this.lightPosY = this.formatNum(entity.light.lightPosY ?? 0);
    this.lightPosZ = this.formatNum(entity.light.lightPosZ ?? 0);

    this.attachedNodePath = entity.light.attachedNodePath || '';
    this.attachedNodeName = entity.light.attachedNodeName || '';

    if (!this.attachedNodePath && this.attachedNodeName) {
      const found = this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName);
      if (found) this.attachedNodePath = this.buildNodePath(found);
    }

    const allNodes = this.getAllAttachableNodes();
    const animatedNames = this.getAnimatedNodeNames();

    const filtered = allNodes
      .filter(n => {
        if (!animatedNames.size) return true;
        return animatedNames.has(n.name);
      })
      .map(n => ({
        label: n.name,
        value: this.buildNodePath(n)
      }));

    this.childNodes = filtered.length > 0 ? filtered : allNodes.map(n => ({
      label: n.name,
      value: this.buildNodePath(n)
    }));

    this.cdr.detectChanges();
  }

  aplicarLuz() {
    if (this.attachedNodePath === "") {
        this.attachedNodeName = "";
    }

    const light = this.getAttachedLight();

    if (light) {
      light.intensity = this.intensity;
      light.diffuse = Color3.FromHexString(this.lightColor);

      if (light instanceof PointLight || light instanceof SpotLight) {
        light.range = this.range;
      }

      if (light instanceof SpotLight) {
        light.angle = this.angle * (Math.PI / 180);
        light.direction = new Vector3(0, -1, 0);
      }

      if (light instanceof DirectionalLight) {
        light.direction = new Vector3(0, -1, 0);
      }

      this.applyAttachment(light);
      
      if ((light as any).position) {
         (light as any).position.copyFromFloats(this.lightPosX, this.lightPosY, this.lightPosZ);
      }
    }

    const targetNode = this.attachedNodePath !== "" ? (
      this.resolveNodeByPath(this.attachedNodePath) ||
      this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName) ||
      null
    ) : null;

    this.attachedNodeName = targetNode?.name || '';
    this.attachedNodePath = targetNode ? this.buildNodePath(targetNode) : '';

    if (this.objeto.material) {
      (this.objeto.material as any).emissiveColor = Color3.FromHexString(this.lightColor);
    }

    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity && entity.light) {
      entity.light.lightPosX = this.lightPosX;
      entity.light.lightPosY = this.lightPosY;
      entity.light.lightPosZ = this.lightPosZ;
      entity.light.lightColor = this.lightColor;
      entity.light.intensity = this.intensity;
      entity.light.range = this.range;
      entity.light.angle = this.angle;
      entity.light.attachedNodeName = this.attachedNodeName;
      entity.light.attachedNodePath = this.attachedNodePath;
      
      entity.syncToView(); 
    }

    this.editorSvc.triggerUpdate();
    this.animStatus = '💡 Luz actualizada y re-anclada';
  }
}