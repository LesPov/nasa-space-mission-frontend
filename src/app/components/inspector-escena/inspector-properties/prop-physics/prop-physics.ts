
// file: src/app/components/inspector-escena/inspector-properties/prop-physics/prop-physics.ts
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Vector3, MeshBuilder, Mesh, Tags, Quaternion } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
 
@Component({
  selector: 'app-prop-physics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-physics.html',
  styleUrls: ['./prop-physics.css'] 
})
export class PropPhysics implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  public stateSvc = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  colliderType = 'box';
  colliderSizeX = 1; colliderSizeY = 1; colliderSizeZ = 1;
  colliderOffX = 0; colliderOffY = 0; colliderOffZ = 0;
  colliderRotX = 0; colliderRotY = 0; colliderRotZ = 0;
  colliderScaleX = 1; colliderScaleY = 1; colliderScaleZ = 1;
  
  esPersonaje = false;

  get estaEditandoColliderGizmo(): boolean {
    return this.stateSvc.subObjetoSeleccionado() === 'collider';
  }

  constructor() {
    effect(() => {
      this.stateSvc.subObjetoSeleccionado();
      this.syncData();
    });
  }

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.pipe(auditTime(80)).subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.pipe(auditTime(80)).subscribe(() => this.syncData())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    if (this.stateSvc.subObjetoSeleccionado() === 'collider') {
      this.stateSvc.setSubObjetoSeleccionado(null);
    }
  }

  public toggleEditarColliderGizmo(): void {
    if (this.estaEditandoColliderGizmo) {
      this.stateSvc.setSubObjetoSeleccionado(null);
    } else {
      this.stateSvc.setSubObjetoSeleccionado('collider');
    }
    this.editorSvc.onMapChanged.next();
  }

  private formatNum(val: number): number { 
    return parseFloat(Number(val || 0).toFixed(3)); 
  }

  syncData() {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;
    
    this.esPersonaje = !!entity.characterConfig;
    
    if (entity.collider) {
      this.colliderType = entity.collider.type || (this.esPersonaje ? 'capsule' : 'box');
      this.colliderSizeX = this.formatNum(entity.collider.sizeX ?? 1);
      this.colliderSizeY = this.formatNum(entity.collider.sizeY ?? 1);
      this.colliderSizeZ = this.formatNum(entity.collider.sizeZ ?? 1);
      this.colliderOffX = this.formatNum(entity.collider.offsetX ?? 0);
      this.colliderOffY = this.formatNum(entity.collider.offsetY ?? 0);
      this.colliderOffZ = this.formatNum(entity.collider.offsetZ ?? 0);

      this.colliderRotX = this.formatNum(entity.collider.rotation?.x ?? 0);
      this.colliderRotY = this.formatNum(entity.collider.rotation?.y ?? 0);
      this.colliderRotZ = this.formatNum(entity.collider.rotation?.z ?? 0);

      this.colliderScaleX = this.formatNum(entity.collider.scale?.x ?? 1);
      this.colliderScaleY = this.formatNum(entity.collider.scale?.y ?? 1);
      this.colliderScaleZ = this.formatNum(entity.collider.scale?.z ?? 1);
    }
    
    this.cdr.detectChanges();
  }

  aplicarCollider() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    entity.collider.type = this.colliderType;
    entity.collider.sizeX = this.colliderSizeX;
    entity.collider.sizeY = this.colliderSizeY;
    entity.collider.sizeZ = this.colliderSizeZ;
    entity.collider.offsetX = this.colliderOffX;
    entity.collider.offsetY = this.colliderOffY;
    entity.collider.offsetZ = this.colliderOffZ;

    entity.collider.rotation = {
      x: this.colliderRotX,
      y: this.colliderRotY,
      z: this.colliderRotZ
    };

    entity.collider.scale = {
      x: this.colliderScaleX,
      y: this.colliderScaleY,
      z: this.colliderScaleZ
    };

    entity.isDirty = true;
    entity.syncToView(); 
    
    if (this.colliderType !== 'mesh') {
      const ws = new Vector3();
      this.objeto.getWorldMatrix().decompose(ws);
      
      this.objeto.ellipsoid = new Vector3(
          this.colliderSizeX * Math.abs(ws.x) * this.colliderScaleX, 
          this.colliderSizeY * Math.abs(ws.y) * this.colliderScaleY, 
          this.colliderSizeZ * Math.abs(ws.z) * this.colliderScaleZ
      );
      this.objeto.ellipsoidOffset = new Vector3(
          this.colliderOffX * Math.abs(ws.x), 
          this.colliderOffY * Math.abs(ws.y), 
          this.colliderOffZ * Math.abs(ws.z)
      );

      const proxies = this.objeto.getChildMeshes(true).filter(m => Tags.MatchesQuery(m, "proxy_collider") && m.name.startsWith("col_"));
      proxies.forEach(p => p.dispose());

      if (entity.visual.isSolid && !this.esPersonaje) {
          const scene = this.objeto.getScene();
          let colMesh: Mesh;

          const dimX = this.colliderSizeX * 2 * this.colliderScaleX;
          const dimY = this.colliderSizeY * 2 * this.colliderScaleY;
          const dimZ = this.colliderSizeZ * 2 * this.colliderScaleZ;

          if (this.colliderType === 'sphere') {
              colMesh = MeshBuilder.CreateSphere(`col_${entity.uid}`, { diameterX: dimX, diameterY: dimY, diameterZ: dimZ }, scene);
          } else if (this.colliderType === 'capsule') {
              const r = Math.max(dimX, dimZ) / 2; 
              colMesh = MeshBuilder.CreateCapsule(`col_${entity.uid}`, { radius: r, height: dimY }, scene);
          } else if (this.colliderType === 'cylinder') {
              const diam = Math.max(dimX, dimZ);
              colMesh = MeshBuilder.CreateCylinder(`col_${entity.uid}`, { diameter: diam, height: dimY }, scene);
          } else {
              colMesh = MeshBuilder.CreateBox(`col_${entity.uid}`, { width: dimX, height: dimY, depth: dimZ }, scene);
          }

          colMesh.parent = this.objeto;
          colMesh.position.set(this.colliderOffX, this.colliderOffY, this.colliderOffZ);
          colMesh.rotationQuaternion = Quaternion.FromEulerAngles(
            this.colliderRotX * (Math.PI / 180),
            this.colliderRotY * (Math.PI / 180),
            this.colliderRotZ * (Math.PI / 180)
          );
          
          colMesh.isVisible = true;
          colMesh.visibility = 0;
          colMesh.checkCollisions = true;
          Tags.AddTagsTo(colMesh, "proxy_collider system_element ignore_raycast");
      }
    } else {
       const proxies = this.objeto.getChildMeshes(true).filter(m => Tags.MatchesQuery(m, "proxy_collider") && m.name.startsWith("col_"));
       proxies.forEach(p => p.dispose());
       
       this.objeto.getChildMeshes(false).forEach(m => {
           if (!Tags.MatchesQuery(m, "decal || proxy_collider || system_element || editor_only") && m.getTotalVertices() > 0) {
               m.checkCollisions = true;
           }
       });
    }
    
    this.editorSvc.onMapChanged.next();
  }
}