
import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
  SimpleChanges,
  OnChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AbstractMesh,
  Color3,
  PointLight,
  SpotLight,
  DirectionalLight,
  TransformNode,
  Light,
  Vector3
} from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';

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
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  isPoint = false;
  isSpot = false;
  isDirectional = false;

  lightColor = '#ffffff';
  intensity = 1.0;
  range = 50;
  angle = 60;

  public childNodes: AttachedNodeOption[] = [];
  public attachedNodePath: string = '';
  public attachedNodeName: string = '';

  // 🔥 Corrección de orientación para que la luz siga apuntando al piso
  // cuando el modelo visual está rotado 180°.
  public lightRotationFixX: number = Math.PI;
  public lightRotationFixY: number = 0;
  public lightRotationFixZ: number = 0;

  animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
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

    const targetNode =
      this.resolveNodeByPath(this.attachedNodePath) ||
      this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName) ||
      null;

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

    const meta = this.objeto.metadata || {};

    this.isPoint = meta.type === 'light_point';
    this.isSpot = meta.type === 'light_spot';
    this.isDirectional = meta.type === 'light_directional';

    this.lightColor = meta.lightColor || '#ffffff';
    this.intensity = meta.intensity ?? 1.0;
    this.range = meta.range ?? 50;
    this.angle = meta.angle ?? 60;

    this.attachedNodePath = meta.attachedNodePath || '';
    this.attachedNodeName = meta.attachedNodeName || '';

    this.lightRotationFixX = typeof meta.lightRotationFixX === 'number' ? meta.lightRotationFixX : Math.PI;
    this.lightRotationFixY = typeof meta.lightRotationFixY === 'number' ? meta.lightRotationFixY : 0;
    this.lightRotationFixZ = typeof meta.lightRotationFixZ === 'number' ? meta.lightRotationFixZ : 0;

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
    if (!this.objeto.metadata) this.objeto.metadata = {};

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
    }

    const targetNode =
      this.resolveNodeByPath(this.attachedNodePath) ||
      this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName) ||
      null;

    this.attachedNodeName = targetNode?.name || '';
    this.attachedNodePath = targetNode ? this.buildNodePath(targetNode) : '';

    this.objeto.metadata.lightColor = this.lightColor;
    this.objeto.metadata.intensity = this.intensity;
    this.objeto.metadata.range = this.range;
    this.objeto.metadata.angle = this.angle;
    this.objeto.metadata.attachedNodeName = this.attachedNodeName;
    this.objeto.metadata.attachedNodePath = this.attachedNodePath;

    this.objeto.metadata.lightRotationFixX = this.lightRotationFixX;
    this.objeto.metadata.lightRotationFixY = this.lightRotationFixY;
    this.objeto.metadata.lightRotationFixZ = this.lightRotationFixZ;

    if (this.objeto.material) {
      (this.objeto.material as any).emissiveColor = Color3.FromHexString(this.lightColor);
    }

    this.editorSvc.triggerUpdate();
    this.animStatus = '💡 Luz actualizada';
  }
}
