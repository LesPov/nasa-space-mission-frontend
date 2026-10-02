
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

@Component({
  selector: 'app-prop-bubble',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-bubble.html',
  styleUrls: ['./prop-bubble.css']
})
export class PropBubble implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  private editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  respawnTime: number = 8;

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onMapChanged.pipe(auditTime(100)).subscribe(() => {
        this.syncData();
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  syncData() {
    if (this.objeto) {
      const entity = this.entityManager.getEntityByMesh(this.objeto);
      if (entity && entity.interaction) {
        this.respawnTime = entity.interaction.respawnTime ?? 8;
        this.cdr.detectChanges();
      }
    }
  }

  aplicarBurbuja() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    
    if (entity) {
      entity.interaction.respawnTime = this.respawnTime;
      entity.syncToView();
    } 
    
    this.editorSvc.onMapChanged.next();
  }
}