// src/app/components/inspector-escena/inspector-properties/prop-bubble/prop-bubble.ts
import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

@Component({
  selector: 'app-prop-bubble',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-bubble.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropBubble implements OnInit {
  @Input() objeto!: AbstractMesh;
  private editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService); // 🔥 Inyectado

  respawnTime: number = 8;

  ngOnInit() {
    if (this.objeto) {
      const entity = this.entityManager.getEntityByMesh(this.objeto);
      // Extraemos desde el InteractionComponent puro
      if (entity && entity.interaction) {
        this.respawnTime = entity.interaction.respawnTime ?? 8;
      } else if (this.objeto.metadata) {
        // Fallback
        this.respawnTime = this.objeto.metadata.respawnTime ?? 8;
      }
    }
  }

  aplicarBurbuja() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    
    if (entity) {
      // Modificamos lógica y pedimos actualización visual
      entity.interaction.respawnTime = this.respawnTime;
      entity.syncToView();
    } else {
      if (!this.objeto.metadata) this.objeto.metadata = {};
      this.objeto.metadata.respawnTime = this.respawnTime;
    }
    
    this.editorSvc.triggerUpdate();
  }
}