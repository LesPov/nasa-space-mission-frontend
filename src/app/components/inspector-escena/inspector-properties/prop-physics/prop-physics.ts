
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
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
  private entityManager = inject(EntityManagerService); // 🔥 Inyectado
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  colliderType = 'box';
  colliderSizeX = 0.5; colliderSizeY = 0.5; colliderSizeZ = 0.5;
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
    const meta = this.objeto.metadata || {};
    
    this.esPersonaje = meta.type === 'model' || meta.rol === 'npc' || meta.rol === 'spawn_point';
    
    if (meta.collider) {
      this.colliderType = meta.collider.type || 'box';
      this.colliderSizeX = this.formatNum(meta.collider.sizeX ?? 0.5);
      this.colliderSizeY = this.formatNum(meta.collider.sizeY ?? 0.5);
      this.colliderSizeZ = this.formatNum(meta.collider.sizeZ ?? 0.5);
      this.colliderOffX = this.formatNum(meta.collider.offsetX ?? 0);
      this.colliderOffY = this.formatNum(meta.collider.offsetY ?? 0);
      this.colliderOffZ = this.formatNum(meta.collider.offsetZ ?? 0);
    }

    if (meta.camOffset) {
      this.camPosX = this.formatNum(meta.camOffset.x ?? 0);
      this.camPosY = this.formatNum(meta.camOffset.y ?? 1.6);
      this.camPosZ = this.formatNum(meta.camOffset.z ?? 0);
    }
    
    this.cdr.detectChanges();
  }

  aplicarCollider() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);

    const colliderData = { 
        type: this.colliderType, 
        sizeX: this.colliderSizeX, sizeY: this.colliderSizeY, sizeZ: this.colliderSizeZ, 
        offsetX: this.colliderOffX, offsetY: this.colliderOffY, offsetZ: this.colliderOffZ 
    };

    if (entity) {
      entity.collider = colliderData;
      entity.syncToView(); // 🔥 Guarda y sincroniza la Entidad
    } else {
      if (!this.objeto.metadata) this.objeto.metadata = {};
      this.objeto.metadata.collider = colliderData;
    }
    
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
    }
    
    if (this.colliderType === 'mesh' && this.editorSvc.subObjetoSeleccionado() === 'collider') {
        this.editorSvc.subObjetoSeleccionado.set(null);
    }
    
    this.editorSvc.triggerUpdate();
  }

  aplicarCamara() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    const camData = { x: this.camPosX, y: this.camPosY, z: this.camPosZ };

    if (entity) {
      entity.camOffset = camData;
      entity.syncToView(); // 🔥 Guarda y sincroniza la Entidad
    } else {
      if (!this.objeto.metadata) this.objeto.metadata = {};
      this.objeto.metadata.camOffset = camData;
    }
    
    this.editorSvc.triggerUpdate();
  }
}