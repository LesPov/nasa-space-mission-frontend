
// file: src/app/components/inspector-escena/inspector-properties/prop-light/prop-light.ts
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, TransformNode } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';
import { LightContainmentMode, LightDistanceReferenceMode, LightInteriorActivationMode, ConfiguredPortal } from '../../../../core/engine/entities/game.entity';
import { LightContainmentService } from '../../../../core/engine/runtime/systems/lighting/light-containment.service';
import { DynamicLightingSystem } from '../../../../core/engine/runtime/systems/lighting/dynamic-lighting.system';
import { LightPoolService } from '../../../../core/engine/runtime/systems/lighting/light-pool.service';
import { ToolsDebugPortalsService } from '../../../../services/editor/toolsservice/tools-debug-portals.service';
import { ToolsDebugLightRangeService } from '../../../../services/editor/toolsservice/tools-debug-light-range.service';

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
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private containmentSvc = inject(LightContainmentService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private lightPool = inject(LightPoolService);
  private debugPortalsSvc = inject(ToolsDebugPortalsService);
  private debugLightRangeSvc = inject(ToolsDebugLightRangeService);
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
  exponent = 1.0;
  enabled = true;
  castShadows = true;

  lightScaleX = 1.0;
  lightScaleY = 1.0;
  lightScaleZ = 1.0;

  showRangeSphereHelper = false;
  showContainerBoxHelper = false;

  containmentMode: LightContainmentMode = 'GLOBAL';
  interiorActivationMode: LightInteriorActivationMode = 'VOLUME';
  preEntryEnabled: boolean = true;
  preEntryDistance: number = 8.0;
  linkShadowPreEntryToLightPreEntry: boolean = true;
  shadowPreEntryDistance: number = 8.0;

  portals: ConfiguredPortal[] = [];
  selectedPortalIndex = 0;

  containerEntityUid: string = '';
  affectDescendantsOnly: boolean = false;
  shadowDarkness: number = 0.0;
  shadowBias: number = 0.0005;
  shadowNormalBias: number = 0.01;
  excludeExteriorMeshes: boolean = true;

  distanceControlEnabled: boolean = true;
  activationDistance: number = 52;
  deactivationDistance: number = 56;
  distanceShadowsEnabled: boolean = true;
  shadowActivationDistance: number = 52;
  shadowDeactivationDistance: number = 56;
  distanceReferenceMode: LightDistanceReferenceMode = 'AUTO';

  currentDistance: number = 0;
  currentMultiplier: number = 1.0;
  currentTransitionProgress: number = 0;
  currentEffectiveIntensity: number = 0.0;
  isLightActiveStatus: boolean = false;
  isShadowActiveStatus: boolean = false;
  shadowTierText: string = 'N/A';
  closestActorName: string = 'N/A';
  poolRankText: string = '-';
  referenceModeDisplay: string = 'ACTOR (Player/NPC)';

  isInteriorLight: boolean = false;
  isInsideVolume: boolean = false;
  isInPreEntry: boolean = false;
  isInPreExit: boolean = false;
  spatialContextText: string = 'GLOBAL';
  containmentSourceText: string = 'N/A';
  distanceToBoundaryText: string = 'N/A';
  signedDistanceText: string = 'N/A';
  activePortalIdText: string = 'N/A';
  corridorZoneText: string = 'N/A';
  decisionText: string = 'EVALUANDO';

  public childNodes: AttachedNodeOption[] = [];
  public containerOptions: ContainerOption[] = [];
  public attachedNodePath: string = '';
  public attachedNodeName: string = '';

  animStatus = '';
  private telemetryInterval: any = null;

  get isModelPreEntryActive(): boolean {
    return this.containmentMode === 'INTERIOR' && this.preEntryEnabled && this.interiorActivationMode !== 'DISTANCE';
  }

  ngOnInit() {
    this.showRangeSphereHelper = this.debugLightRangeSvc.showRangeSphereHelper;
    this.showContainerBoxHelper = this.debugLightRangeSvc.showContainerBoxHelper;

    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.pipe(auditTime(100)).subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.pipe(auditTime(100)).subscribe(() => this.syncData())
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
    this.debugPortalsSvc.dispose();
  }

  public onScaleChange(): void {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    const sx = Math.max(0.01, Number(this.lightScaleX) || 1.0);
    const sy = Math.max(0.01, Number(this.lightScaleY) || 1.0);
    const sz = Math.max(0.01, Number(this.lightScaleZ) || 1.0);

    entity.transform.scale = { x: sx, y: sy, z: sz };
    this.objeto.scaling.set(sx, sy, sz);
    entity.isDirty = true;
    entity.syncToView();

    this.editorSvc.onMapChanged.next();
  }

  public onPortalRadiusChange(portal: ConfiguredPortal): void {
    portal.width = (portal.radius || 1.75) * 2;
    this.aplicarLuz();
  }

  public onDebugHelpersChange(): void {
    this.debugLightRangeSvc.showRangeSphereHelper = this.showRangeSphereHelper;
    this.debugLightRangeSvc.showContainerBoxHelper = this.showContainerBoxHelper;
    const scene = this.objeto?.getScene();
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (scene && entity) {
      this.debugLightRangeSvc.update(scene, this.objeto, entity, null);
    }
  }

  private updateTelemetry(): void {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    const vl = this.dynamicLighting.getVirtualLightByUid(entity.uid);
    if (vl) {
      this.currentDistance = parseFloat(vl.lastEvaluatedDistance.toFixed(2));
      this.currentMultiplier = vl.currentMultiplier;
      this.currentTransitionProgress = vl.transitionProgress ?? 0;
      this.currentEffectiveIntensity = (entity.light?.intensity ?? 1.0) * vl.currentMultiplier;
      
      const slot = this.lightPool.findSlotByUid(entity.uid);
      this.isLightActiveStatus = !!slot && slot.light.isEnabled() && slot.currentIntensity > 0.00005;
      
      this.isShadowActiveStatus = vl.isShadowInRange && (entity.light?.castShadows ?? true);
      this.shadowTierText = vl.shadowTier || 'OFF';
      this.closestActorName = vl.closestActorName || 'Actor';
      this.poolRankText = vl.poolRank && vl.poolRank > 0 ? `${vl.poolRank} / 3 (ACTIVA)` : (vl.lifecycleStage === 'PREPARED' ? 'Preparada (Slot 3/4)' : 'Fuera de Pool (INACTIVA)');
      this.referenceModeDisplay = this.distanceReferenceMode === 'AUTO' 
        ? 'ACTOR (Player/NPC)' 
        : this.distanceReferenceMode;

      this.isInteriorLight = vl.isInterior;
      this.isInsideVolume = vl.insideVolume;
      this.isInPreEntry = vl.inPreEntryZone;
      this.isInPreExit = vl.inPreExitZone ?? false;
      this.containmentSourceText = vl.containmentSource || 'N/A';
      this.distanceToBoundaryText = vl.distanceToBoundary !== undefined ? `${vl.distanceToBoundary.toFixed(2)} m` : 'N/A';
      this.signedDistanceText = vl.signedDistanceToPortal !== undefined ? `${vl.signedDistanceToPortal.toFixed(2)} m` : 'N/A';
      this.activePortalIdText = vl.matchedPortalId || 'Ninguno';

      const hop = vl.topologicalHop !== undefined ? vl.topologicalHop : 0;
      const zoneName = vl.corridorZoneName || vl.containerName || 'Desconocido';
      this.corridorZoneText = `${zoneName} (Salto ${hop}${hop === 0 ? ' - ACTUAL' : (hop === 1 ? ' - VECINO' : ' - DESCONECTADO')})`;
      this.decisionText = vl.decisionText || (vl.rejectionReason ? `RECHAZADA (${vl.rejectionReason})` : 'EVALUANDO');

      if (vl.isInterior) {
        if (this.isModelPreEntryActive) {
          if (vl.spatialState === 'INSIDE') {
            this.spatialContextText = `INTERIOR (${vl.containerName || 'Dentro'}) - INSIDE (100%)`;
          } else if (vl.spatialState === 'PRE_ENTRY') {
            this.spatialContextText = `PRE-ENTRADA (${vl.containerName || 'Portal'}) - FADE IN (${(vl.currentMultiplier * 100).toFixed(2)}%)`;
          } else if (vl.spatialState === 'PRE_EXIT') {
            this.spatialContextText = `PRE-SALIDA (${vl.containerName || 'Portal'}) - FADE OUT (${(vl.currentMultiplier * 100).toFixed(2)}%)`;
          } else {
            this.spatialContextText = `FUERA DEL PASILLO (${vl.containerName || 'Pared exterior'}) - APAGADA`;
          }
        } else {
          this.spatialContextText = vl.insideVolume 
            ? `INTERIOR (${vl.containerName || 'Dentro'}) - RADIAL` 
            : `FUERA DEL VOLUMEN (${vl.containerName || 'Exterior'})`;
        }
      } else {
        this.spatialContextText = 'GLOBAL / EXTERIOR';
      }

      this.cdr.detectChanges();
    }
  }

  public seleccionarPortal(index: number): void {
    this.selectedPortalIndex = index;
    const portal = this.portals[index];
    if (portal) {
      this.debugPortalsSvc.setSelectedPortalId(portal.id);
    }
  }

  public agregarPortal(): void {
    const newPortal: ConfiguredPortal = {
      id: window.crypto.randomUUID(),
      name: `Portal ${this.portals.length + 1}`,
      localPosition: { x: 0, y: 0, z: this.portals.length === 0 ? -10 : 10 },
      localNormal: { x: 0, y: 0, z: this.portals.length === 0 ? -1 : 1 },
      radius: 1.75,
      width: 3.5,
      height: 3.5,
      depth: 1.5,
      preEntryDistance: this.preEntryDistance,
      enabled: true
    };
    this.portals.push(newPortal);
    this.selectedPortalIndex = this.portals.length - 1;
    this.aplicarLuz();
  }

  public eliminarPortal(index: number): void {
    this.portals.splice(index, 1);
    if (this.selectedPortalIndex >= this.portals.length) {
      this.selectedPortalIndex = Math.max(0, this.portals.length - 1);
    }
    this.aplicarLuz();
  }

  public autocalibrarDosPortales(): void {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    const container = entity ? this.containmentSvc.resolveContainerEntity(entity, this.objeto.getScene()) : null;
    
    let halfDepth = 15;
    let radius = 1.75;
    if (container && container.view) {
      container.view.computeWorldMatrix(true);
      const b = container.view.getBoundingInfo().boundingBox;
      halfDepth = Math.max(5, (b.maximum.z - b.minimum.z) * 0.5);
      radius = Math.max(1.2, (b.maximum.x - b.minimum.x) * 0.45);
    }

    this.portals = [
      {
        id: 'portal_front',
        name: 'Portal 1 (Extremo Z-)',
        localPosition: { x: 0, y: 0, z: -halfDepth },
        localNormal: { x: 0, y: 0, z: -1 },
        radius: parseFloat(radius.toFixed(2)),
        width: parseFloat((radius * 2).toFixed(2)),
        height: 3.5,
        depth: 1.5,
        preEntryDistance: this.preEntryDistance,
        enabled: true
      },
      {
        id: 'portal_back',
        name: 'Portal 2 (Extremo Z+)',
        localPosition: { x: 0, y: 0, z: halfDepth },
        localNormal: { x: 0, y: 0, z: 1 },
        radius: parseFloat(radius.toFixed(2)),
        width: parseFloat((radius * 2).toFixed(2)),
        height: 3.5,
        depth: 1.5,
        preEntryDistance: this.preEntryDistance,
        enabled: true
      }
    ];

    this.selectedPortalIndex = 0;
    this.aplicarLuz();
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
      if (current.name) parts.unshift(current.name);
      const parent: any = current.parent;
      if (!parent || parent === root) {
        if (parent && parent !== root && parent.name) parts.unshift(parent.name);
        break;
      }
      current = parent;
    }

    return parts.join('/ ');
  }

  private resolveNodeByPath(path: string): TransformNode | AbstractMesh | null {
    if (!this.objeto || !path) return null;
    const nodes = this.getAllAttachableNodes();
    return nodes.find(n => this.buildNodePath(n) === path) || nodes.find(n => n.name === path) || null;
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

  public onPreEntryDistanceChange(): void {
    if (this.linkShadowPreEntryToLightPreEntry) {
      this.shadowPreEntryDistance = this.preEntryDistance;
    }
    this.portals.forEach(p => p.preEntryDistance = this.preEntryDistance);
    this.aplicarLuz();
  }

  public onSyncShadowToggle(): void {
    if (this.linkShadowPreEntryToLightPreEntry) {
      this.shadowPreEntryDistance = this.preEntryDistance;
    }
    this.aplicarLuz();
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
    this.exponent = entity.light.exponent ?? 1.0;
    
    this.lightScaleX = parseFloat((entity.transform.scale.x || 1.0).toFixed(3));
    this.lightScaleY = parseFloat((entity.transform.scale.y || 1.0).toFixed(3));
    this.lightScaleZ = parseFloat((entity.transform.scale.z || 1.0).toFixed(3));

    this.enabled = entity.light.enabled ?? true;
    this.castShadows = entity.light.castShadows ?? true;

    this.containmentMode = entity.light.containmentMode ?? (entity.parentId ? 'INTERIOR' : 'GLOBAL');
    this.interiorActivationMode = entity.light.interiorActivationMode || (this.containmentMode === 'INTERIOR' ? 'VOLUME' : 'DISTANCE');
    this.preEntryEnabled = entity.light.preEntryEnabled ?? true;
    this.preEntryDistance = entity.light.preEntryDistance ?? 8.0;
    
    this.portals = entity.light.portals ? JSON.parse(JSON.stringify(entity.light.portals)) : [];

    this.linkShadowPreEntryToLightPreEntry = entity.light.linkShadowPreEntryToLightPreEntry !== false;
    this.shadowPreEntryDistance = entity.light.shadowPreEntryDistance ?? this.preEntryDistance;

    this.containerEntityUid = entity.light.containerEntityUid ?? '';
    this.affectDescendantsOnly = entity.light.affectDescendantsOnly ?? false;
    this.shadowDarkness = entity.light.shadowDarkness ?? 0.0;
    this.shadowBias = entity.light.shadowBias ?? 0.0005;
    this.shadowNormalBias = entity.light.shadowNormalBias ?? 0.01;
    this.excludeExteriorMeshes = entity.light.excludeExteriorMeshes ?? true;

    this.distanceControlEnabled = entity.light.distanceControlEnabled ?? true;
    this.activationDistance = entity.light.activationDistance ?? 52;
    this.deactivationDistance = entity.light.deactivationDistance ?? 56;
    this.distanceShadowsEnabled = entity.light.distanceShadowsEnabled ?? true;
    this.shadowActivationDistance = entity.light.shadowActivationDistance ?? 52;
    this.shadowDeactivationDistance = entity.light.shadowDeactivationDistance ?? 56;
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
      .filter(n => animatedNames.size ? animatedNames.has(n.name) : true)
      .map(n => ({ label: n.name, value: this.buildNodePath(n) }));

    this.childNodes = filtered.length > 0 ? filtered : allNodes.map(n => ({
      label: n.name,
      value: this.buildNodePath(n)
    }));

    this.containerOptions = this.entityManager.getAllEntities()
      .filter(e => e.uid !== entity.uid && (e.type === 'model' || e.type === 'cube'))
      .map(e => ({ label: e.name, uid: e.uid }));

    const scene = this.objeto.getScene();
    if (scene) {
      const activePortalId = this.portals[this.selectedPortalIndex]?.id || null;
      this.debugPortalsSvc.update(scene, entity, activePortalId);
      this.debugLightRangeSvc.update(scene, this.objeto, entity, null);
    }

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

      if (this.deactivationDistance <= this.activationDistance) {
        this.deactivationDistance = this.activationDistance + 2;
      }
      if (this.shadowDeactivationDistance <= this.shadowActivationDistance) {
        this.shadowDeactivationDistance = this.shadowActivationDistance + 2;
      }

      entity.light.lightColor = this.lightColor;
      entity.light.lightColorBW = this.lightColorBW;
      entity.light.intensity = this.intensity;
      entity.light.range = this.range;
      entity.light.angle = this.angle;
      entity.light.exponent = this.exponent;
      entity.light.enabled = this.enabled;
      entity.light.castShadows = this.castShadows;
      entity.light.attachedNodeName = this.attachedNodeName;
      entity.light.attachedNodePath = this.attachedNodePath;

      entity.light.containmentMode = this.containmentMode;
      entity.light.interiorActivationMode = this.interiorActivationMode;
      entity.light.preEntryEnabled = this.preEntryEnabled;
      entity.light.preEntryDistance = this.preEntryDistance;
      entity.light.linkShadowPreEntryToLightPreEntry = this.linkShadowPreEntryToLightPreEntry;
      entity.light.shadowPreEntryDistance = this.linkShadowPreEntryToLightPreEntry ? this.preEntryDistance : this.shadowPreEntryDistance;
      entity.light.portals = JSON.parse(JSON.stringify(this.portals));

      entity.light.containerEntityUid = this.containerEntityUid;
      entity.light.affectDescendantsOnly = this.affectDescendantsOnly;
      entity.light.shadowDarkness = this.shadowDarkness;
      entity.light.shadowBias = this.shadowBias;
      entity.light.shadowNormalBias = this.shadowNormalBias;
      entity.light.excludeExteriorMeshes = this.excludeExteriorMeshes;

      if (!this.isModelPreEntryActive) {
        entity.light.distanceControlEnabled = this.distanceControlEnabled;
        entity.light.activationDistance = this.activationDistance;
        entity.light.deactivationDistance = this.deactivationDistance;
        entity.light.distanceShadowsEnabled = this.distanceShadowsEnabled;
        entity.light.shadowActivationDistance = this.shadowActivationDistance;
        entity.light.shadowDeactivationDistance = this.shadowDeactivationDistance;
        entity.light.distanceReferenceMode = this.distanceReferenceMode;
      }
      
      entity.isDirty = true;
      entity.syncToView(); 

      this.containmentSvc.markDirty(entity.uid);
      if (this.containerEntityUid) {
        this.containmentSvc.markDirty(this.containerEntityUid);
      }

      const scene = this.objeto.getScene();
      if (scene) {
        const activePortalId = this.portals[this.selectedPortalIndex]?.id || null;
        this.debugPortalsSvc.update(scene, entity, activePortalId);
        this.debugLightRangeSvc.update(scene, this.objeto, entity, null);
      }
      
      this.dynamicLighting.syncLightImmediate(entity, true);
      this.updateTelemetry();
    }

    this.editorSvc.onMapChanged.next();
    this.animStatus = '💡 Parámetros de luz actualizados en vivo';
    setTimeout(() => this.animStatus = '', 2000);
  }
}