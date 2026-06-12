import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Color3, PointLight, SpotLight, DirectionalLight } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';

@Component({
  selector: 'app-prop-light',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-light.html',
  styleUrls: ['./prop-light.css']
})
export class PropLight implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  isPoint = false;
  isSpot = false;
  isDirectional = false;

  lightColor = '#ffffff';
  intensity = 1.0;
  range = 50;
  angle = 60;
  animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  syncData() {
    if (!this.objeto) return;
    const meta = this.objeto.metadata || {};
    
    this.isPoint = meta.type === 'light_point';
    this.isSpot = meta.type === 'light_spot';
    this.isDirectional = meta.type === 'light_directional';

    this.lightColor = meta.lightColor || '#ffffff';
    this.intensity = meta.intensity ?? 1.0;
    this.range = meta.range ?? 50;
    this.angle = meta.angle ?? 60;
    
    this.cdr.detectChanges();
  }

  aplicarLuz() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    
    this.objeto.metadata.lightColor = this.lightColor;
    this.objeto.metadata.intensity = this.intensity;
    this.objeto.metadata.range = this.range;
    this.objeto.metadata.angle = this.angle;

    // Obtener la luz real asociada al mesh proxy
    const light = this.objeto.getChildren().find(
      (child): child is PointLight | SpotLight | DirectionalLight =>
        child instanceof PointLight || child instanceof SpotLight || child instanceof DirectionalLight
    );
    if (light) {
      light.intensity = this.intensity;
      light.diffuse = Color3.FromHexString(this.lightColor);
      
      if (light instanceof PointLight || light instanceof SpotLight) {
        light.range = this.range;
      }
      if (light instanceof SpotLight) {
        light.angle = this.angle * (Math.PI / 180); // Convertir grados a radianes
      }
    }

    // Actualizar el material del proxy para que brille con el mismo color
    if (this.objeto.material) {
        (this.objeto.material as any).emissiveColor = Color3.FromHexString(this.lightColor);
    }
    
    this.editorSvc.triggerUpdate();
    this.animStatus = '💡 Luz actualizada';
  }
}