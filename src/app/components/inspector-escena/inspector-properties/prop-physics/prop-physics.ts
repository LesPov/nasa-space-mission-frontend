
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Vector3, MeshBuilder, Mesh, Tags } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
 
@Component({
  selector: 'app-prop-physics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-physics.html',
  styleUrls: ['../inspector-properties.css'] 
})
export class PropPhysics implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private stateSvc = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  colliderType = 'box';
  colliderSizeX = 1; colliderSizeY = 1; colliderSizeZ = 1;
  colliderOffX = 0; colliderOffY = 0; colliderOffZ = 0;
  camPosX = 0; camPosY = 1.6; camPosZ = 0;
  
  esPersonaje = false;

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private formatNum(val: number): number { return parseFloat(Number(val || 0).toFixed(3)); }

  syncData() {
    if (!this.objeto) return;
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;
    
    this.esPersonaje = !!entity.characterConfig;
    
    if (entity.collider) {
      this.colliderType = entity.collider.type || 'box';
      this.colliderSizeX = this.formatNum(entity.collider.sizeX ?? 1);
      this.colliderSizeY = this.formatNum(entity.collider.sizeY ?? 1);
      this.colliderSizeZ = this.formatNum(entity.collider.sizeZ ?? 1);
      this.colliderOffX = this.formatNum(entity.collider.offsetX ?? 0);
      this.colliderOffY = this.formatNum(entity.collider.offsetY ?? 0);
      this.colliderOffZ = this.formatNum(entity.collider.offsetZ ?? 0);
    }

    if (entity.camOffset) {
      this.camPosX = this.formatNum(entity.camOffset.x ?? 0);
      this.camPosY = this.formatNum(entity.camOffset.y ?? 1.6);
      this.camPosZ = this.formatNum(entity.camOffset.z ?? 0);
    }
    
    this.cdr.detectChanges();
  }

  aplicarCollider() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    entity.collider = { 
        type: this.colliderType, 
        sizeX: this.colliderSizeX, sizeY: this.colliderSizeY, sizeZ: this.colliderSizeZ, 
        offsetX: this.colliderOffX, offsetY: this.colliderOffY, offsetZ: this.colliderOffZ 
    };

    entity.isDirty = true;
    entity.syncToView(); 
    
    if (this.colliderType !== 'mesh') {
      const ws = new Vector3();
      this.objeto.getWorldMatrix().decompose(ws);
      
      this.objeto.ellipsoid = new Vector3(
          this.colliderSizeX * Math.abs(ws.x), 
          this.colliderSizeY * Math.abs(ws.y), 
          this.colliderSizeZ * Math.abs(ws.z)
      );
      this.objeto.ellipsoidOffset = new Vector3(
          this.colliderOffX * Math.abs(ws.x), 
          this.colliderOffY * Math.abs(ws.y), 
          this.colliderOffZ * Math.abs(ws.z)
      );

      // Limpiamos los proxies generados automáticamente, no los personalizados del GLTF
      const proxies = this.objeto.getChildMeshes(true).filter(m => Tags.MatchesQuery(m, "proxy_collider") && m.name.startsWith("col_"));
      proxies.forEach(p => p.dispose());

      if (entity.visual.isSolid && !this.esPersonaje) {
          const scene = this.objeto.getScene();
          let colMesh: Mesh;
          if (this.colliderType === 'sphere') {
              colMesh = MeshBuilder.CreateSphere(`col_${entity.uid}`, { diameterX: this.colliderSizeX, diameterY: this.colliderSizeY, diameterZ: this.colliderSizeZ }, scene);
          } else if (this.colliderType === 'capsule') {
              const r = Math.max(this.colliderSizeX, this.colliderSizeZ) / 2;
              colMesh = MeshBuilder.CreateCapsule(`col_${entity.uid}`, { radius: r, height: this.colliderSizeY }, scene);
          } else {
              colMesh = MeshBuilder.CreateBox(`col_${entity.uid}`, { width: this.colliderSizeX, height: this.colliderSizeY, depth: this.colliderSizeZ }, scene);
          }
          colMesh.parent = this.objeto;
          colMesh.position.set(this.colliderOffX, this.colliderOffY, this.colliderOffZ);
          colMesh.isVisible = false;
          colMesh.checkCollisions = true;
          Tags.AddTagsTo(colMesh, "proxy_collider system_element");
      }
    } else {
       // Si es malla exacta, eliminamos los primitivos
       const proxies = this.objeto.getChildMeshes(true).filter(m => Tags.MatchesQuery(m, "proxy_collider") && m.name.startsWith("col_"));
       proxies.forEach(p => p.dispose());
       
       // Activamos la colisión real en la geometría del modelo
       this.objeto.getChildMeshes(false).forEach(m => {
           // Ignoramos decals, permitimos colliders personalizados (proxycol) y geometría con vértices
           if (!Tags.MatchesQuery(m, "decal") && m.getTotalVertices() > 0) {
               m.checkCollisions = true;
           }
       });
    }
    
    if (this.colliderType === 'mesh' && this.stateSvc.subObjetoSeleccionado() === 'collider') {
        this.stateSvc.subObjetoSeleccionado.set(null);
    }
    
    this.editorSvc.onMapChanged.next();
  }

  aplicarCamara() {
    if (this.esPersonaje) return; 
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;
    
    entity.camOffset = { x: this.camPosX, y: this.camPosY, z: this.camPosZ };
    entity.isDirty = true;
    entity.syncToView(); 
    
    this.editorSvc.onMapChanged.next();
  }
}