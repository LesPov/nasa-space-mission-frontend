import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';

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

  respawnTime: number = 8;

  ngOnInit() {
    if (this.objeto && this.objeto.metadata) {
      this.respawnTime = this.objeto.metadata.respawnTime ?? 8;
    }
  }

  aplicarBurbuja() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    this.objeto.metadata.respawnTime = this.respawnTime;
    this.editorSvc.triggerUpdate();
  }
}