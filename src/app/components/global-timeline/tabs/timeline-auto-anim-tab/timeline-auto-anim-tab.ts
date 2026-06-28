
import { Component, ChangeDetectorRef, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

@Component({
  selector: 'app-timeline-auto-anim-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-auto-anim-tab.html',
  styleUrls: ['./timeline-auto-anim-tab.css']
})
export class TimelineAutoAnimTab {
  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public currentObjectId: string | null = null;
  public autoAnimConfig = {
    enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false
  };

  constructor() {
    effect(() => {
      const obj = this.stateSvc.objetoSeleccionado() as any;
      const entity = this.entityManager.getEntityByMesh(obj);
      const objId = entity ? entity.uid : null;
      
      if (this.currentObjectId !== objId) {
          this.currentObjectId = objId;
          this.leerAutoAnimacionDelObjeto();
      }
    });
  }

  leerAutoAnimacionDelObjeto() {
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity && entity.autoAnim) {
      this.autoAnimConfig = { ...entity.autoAnim };
    } else {
      this.autoAnimConfig = { enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2, stopBaked: false };
    }
    this.cdr.detectChanges();
  }

  guardarAutoAnimacion() {
    const obj = this.stateSvc.objetoSeleccionado() as any;
    const entity = this.entityManager.getEntityByMesh(obj);
    if (entity) {
        entity.autoAnim = { ...this.autoAnimConfig };
        entity.syncToView();
        this.mapaSvc.onMapChanged.next(); 
    }
  }
}