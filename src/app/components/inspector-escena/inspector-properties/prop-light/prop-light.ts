
// file: src/app/components/inspector-escena/inspector-properties/prop-light/prop-light.ts
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, TransformNode } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';
import { LightContainmentMode, LightDistanceReferenceMode } from '../../../../core/engine/entities/game.entity';
import { LightContainmentService } from '../../../../core/engine/runtime/systems/lighting/light-containment.service';
import { DynamicLightingSystem } from '../../../../core/engine/runtime/systems/lighting/dynamic-lighting.system';

interface AttachedNodeOption {
  label: string;
  value: string;
}

interface ContainerOption {
  label: string;
  uid: string;
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
  private stateSvc = inject(EditorStateService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private containmentSvc = inject(LightContainmentService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  isPoint = false;
  isSpot = false;
  isDirectional = false;

  lightColor = '#ffffff';
  lightColorBW = '#ffffff';
  intensity = 1.0;
  range = 50;
  angle = 60;
  enabled = true;
  castShadows = true;

  // --- CONTAINMENT PROPERTIES ---
  containmentMode: LightContainmentMode = 'GLOBAL';
  containerEntityUid: string = '';
  affectDescendantsOnly: boolean = true;
  shadowDarkness: number = 0.0;
  shadowBias: number = 0.0005;
  shadowNormalBias: number = 0.01;
  excludeExteriorMeshes: boolean = true;

  // --- DISTANCE & HYSTERESIS PROPERTIES ---
  distanceControlEnabled: boolean = true;
  activationDistance: number = 65;
  deactivationDistance: number = 75;
  distanceShadowsEnabled: boolean = true;
  shadowActivationDistance: number = 30;
  shadowDeactivationDistance: number = 36;
  distanceReferenceMode: LightDistanceReferenceMode = 'AUTO';

  // --- TELEMETRÍA EN VIVO ---
  currentDistance: number = 0;
  isLightActiveStatus: boolean = false;
  isShadowActiveStatus: boolean = false;

  public childNodes: AttachedNodeOption[] = [];
  public containerOptions: ContainerOption[] = [];
  public attachedNodePath: string = '';
  public attachedNodeName: string = '';

  animStatus = '';
  private telemetryInterval: any = null;

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );

    this.telemetryInterval = setInterval(() => {
      this.updateTelemetry();
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) {
      this.syncData();
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  private updateTelemetry(): void {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    const vl = this.dynamicLighting.getVirtualLightByUid(entity.uid);
    if (vl) {
      this.currentDistance = parseFloat(vl.lastEvaluatedDistance.toFixed(2));
      this.isLightActiveStatus = vl.isLightInRange && (entity.light?.enabled ?? true);
      this.isShadowActiveStatus = vl.isShadowInRange && (entity.light?.castShadows ?? true);
      this.cdr.detectChanges();
    }
  }

  private getAllAttachableNodes(): Array<TransformNode | AbstractMesh> {
    if (!this.objeto) return [];

    const root = this.stateSvc.encontrarRaiz(this.objeto);
    if (!root) return [];

    const nodes = [
      ...(root.getChildren(undefined, false).filter((node): node is TransformNode => node instanceof TransformNode) || []),
      ...(root.getChildMeshes(false) || [])
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
    const root = this.stateSvc.encontrarRaiz(this.objeto);

    while (current) {
      if (current.name) {
        parts.unshift(current.name);
      }

      const parent: any = current.parent;
      if (!parent || parent === root) {
        if (parent && parent !== root && parent.name) {
          parts.unshift(parent.name);
        }
        break;
      }

      current = parent;
    }

    return parts.join('/ ');
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
    this.lightColorBW = entity.light.lightColorBW || this.lightColor;
    this.intensity = entity.light.intensity ?? 1.0;
    this.range = entity.light.range ?? 50;
    this.angle = entity.light.angle ?? 60;
    
    this.enabled = entity.light.enabled ?? true;
    this.castShadows = entity.light.castShadows ?? true;

    // --- CONTAINMENT SYNC ---
    this.containmentMode = entity.light.containmentMode ?? 'GLOBAL';
    this.containerEntityUid = entity.light.containerEntityUid ?? '';
    this.affectDescendantsOnly = entity.light.affectDescendantsOnly ?? true;
    this.shadowDarkness = entity.light.shadowDarkness ?? 0.0;
    this.shadowBias = entity.light.shadowBias ?? 0.0005;
    this.shadowNormalBias = entity.light.shadowNormalBias ?? 0.01;
    this.excludeExteriorMeshes = entity.light.excludeExteriorMeshes ?? true;

    // --- DISTANCE & HYSTERESIS SYNC ---
    this.distanceControlEnabled = entity.light.distanceControlEnabled ?? true;
    this.activationDistance = entity.light.activationDistance ?? 65;
    this.deactivationDistance = entity.light.deactivationDistance ?? 75;
    this.distanceShadowsEnabled = entity.light.distanceShadowsEnabled ?? true;
    this.shadowActivationDistance = entity.light.shadowActivationDistance ?? 30;
    this.shadowDeactivationDistance = entity.light.shadowDeactivationDistance ?? 36;
    this.distanceReferenceMode = entity.light.distanceReferenceMode ?? 'AUTO';

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

    this.containerOptions = this.entityManager.getAllEntities()
      .filter(e => e.uid !== entity.uid && (e.type === 'model' || e.type === 'cube'))
      .map(e => ({ label: e.name, uid: e.uid }));

    this.dynamicLighting.syncLightImmediate(entity);
    this.updateTelemetry();
    this.cdr.detectChanges();
  }

  aplicarLuz() {
    if (this.attachedNodePath === "") {
        this.attachedNodeName = "";
    }

    const targetNode = this.attachedNodePath !== "" ? (
      this.resolveNodeByPath(this.attachedNodePath) ||
      this.getAllAttachableNodes().find(n => n.name === this.attachedNodeName) ||
      null
    ) : null;

    this.attachedNodeName = targetNode?.name || '';
    this.attachedNodePath = targetNode ? this.buildNodePath(targetNode) : '';

    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (entity && entity.light) {
      if (targetNode && targetNode instanceof AbstractMesh) {
         // 🔥 FIX PARENTING SEGURO: Evita el error de dependencia circular impidiendo que se intente hacer hijo de sí mismo
         if (this.objeto.parent !== targetNode && !targetNode.isDescendantOf(this.objeto)) {
             this.objeto.setParent(targetNode);
             entity.syncTransformFromView();
         }
      } else {
         const root = this.stateSvc.encontrarRaiz(this.objeto);
         if (root && root !== this.objeto && this.objeto.parent !== root) {
             this.objeto.setParent(root as AbstractMesh);
             entity.syncTransformFromView();
         }
      }

      if (this.deactivationDistance < this.activationDistance) {
        this.deactivationDistance = this.activationDistance + 5;
      }
      if (this.shadowDeactivationDistance < this.shadowActivationDistance) {
        this.shadowDeactivationDistance = this.shadowActivationDistance + 4;
      }

      entity.light.lightColor = this.lightColor;
      entity.light.lightColorBW = this.lightColorBW;
      entity.light.intensity = this.intensity;
      entity.light.renderIntensity = this.intensity;
      entity.light.range = this.range;
      entity.light.angle = this.angle;
      entity.light.enabled = this.enabled;
      entity.light.castShadows = this.castShadows;
      entity.light.attachedNodeName = this.attachedNodeName;
      entity.light.attachedNodePath = this.attachedNodePath;

      entity.light.containmentMode = this.containmentMode;
      entity.light.containerEntityUid = this.containerEntityUid;
      entity.light.affectDescendantsOnly = this.affectDescendantsOnly;
      entity.light.shadowDarkness = this.shadowDarkness;
      entity.light.shadowBias = this.shadowBias;
      entity.light.shadowNormalBias = this.shadowNormalBias;
      entity.light.excludeExteriorMeshes = this.excludeExteriorMeshes;

      entity.light.distanceControlEnabled = this.distanceControlEnabled;
      entity.light.activationDistance = this.activationDistance;
      entity.light.deactivationDistance = this.deactivationDistance;
      entity.light.distanceShadowsEnabled = this.distanceShadowsEnabled;
      entity.light.shadowActivationDistance = this.shadowActivationDistance;
      entity.light.shadowDeactivationDistance = this.shadowDeactivationDistance;
      entity.light.distanceReferenceMode = this.distanceReferenceMode;
      
      entity.isDirty = true;
      entity.syncToView(); 

      this.containmentSvc.markDirty(entity.uid);
      this.dynamicLighting.syncLightImmediate(entity);
      this.updateTelemetry();
    }

    this.editorSvc.onMapChanged.next();
    this.animStatus = '💡 Parámetros de iluminación y distancia actualizados';
  }
}