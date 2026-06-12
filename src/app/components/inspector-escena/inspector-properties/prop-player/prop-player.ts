import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig, mergePlayerConfig, PlayerActionKey } from '../../../../services/editor/player-config.model';
@Component({
selector: 'app-prop-player',
standalone: true,
imports: [CommonModule, FormsModule],
templateUrl: './prop-player.html',
styleUrls: ['../inspector-properties.css']
})
export class PropPlayer implements OnInit {
@Input() objeto!: AbstractMesh;
private editorSvc = inject(EditorMapaService);
// 🔥 Añadimos "fog" a los acordeones
acordeonesPlayer: Record<string, boolean> = { movement: true, jump: false, fog: false, camera: false, physics: false, animEnabled: false };
playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
ngOnInit() {
const meta = this.objeto.metadata || {};
this.playerConfig = mergePlayerConfig(meta.playerConfig || null);
}
toggleAcordeon(s: string) { this.acordeonesPlayer[s] = !this.acordeonesPlayer[s]; }
aplicarPlayerConfig() {
this.objeto.metadata.playerConfig = JSON.parse(JSON.stringify(this.playerConfig));
this.editorSvc.triggerUpdate();
}
cambiarHabilitadoAnim(actionKey: PlayerActionKey, value: boolean) {
this.playerConfig.animationEnabled[actionKey] = value;
this.aplicarPlayerConfig();
}
restaurarPlayerConfigDefault() {
this.playerConfig = cloneDefaultPlayerConfig();
this.aplicarPlayerConfig();
}
}