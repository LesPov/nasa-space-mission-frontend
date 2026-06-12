import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Color3, Color4, HemisphericLight, Vector3 } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';

@Component({
  selector: 'app-prop-world',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-world.html',
  styleUrls: ['./prop-world.css'] // Apunta a su propio CSS que acabamos de crear
})
export class PropWorld implements OnInit {
  private editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);

  clearColorHex: string = '#0d1729';
  
  ambientIntensity: number = 1.0;
  ambientColorHex: string = '#ffffff';
  groundColorHex: string = '#333333';
  lightDirX: number = 0;
  lightDirY: number = 1;
  lightDirZ: number = 0;

  gravedadY: number = -0.25;
  
  fogEnabled: boolean = false;
  fogColorHex: string = '#0d1729';
  fogDensity: number = 0.01;

  ngOnInit() {
    this.leerEstadoActual();
  }

  leerEstadoActual() {
    const scene = this.motor3dSvc.scene;
    
    this.clearColorHex = scene.clearColor.toHexString().substring(0, 7);

    const light = scene.lights.find(l => l.name === 'globalLight') as HemisphericLight;
    if (light) {
      this.ambientIntensity = light.intensity;
      this.ambientColorHex = light.diffuse.toHexString();
      this.groundColorHex = light.groundColor.toHexString();
      this.lightDirX = light.direction.x;
      this.lightDirY = light.direction.y;
      this.lightDirZ = light.direction.z;
    }

    this.gravedadY = scene.gravity.y;

    this.fogEnabled = scene.fogMode !== 0;
    this.fogColorHex = scene.fogColor.toHexString();
    this.fogDensity = scene.fogDensity;

    this.cdr.detectChanges();
  }

  aplicarFondo() {
    const scene = this.motor3dSvc.scene;
    scene.clearColor = Color4.FromHexString(this.clearColorHex + 'ff');
    this.editorSvc.triggerUpdate(); 
  }

  aplicarIluminacion() {
    const scene = this.motor3dSvc.scene;
    let light = scene.lights.find(l => l.name === 'globalLight') as HemisphericLight;
    if (!light) {
      light = new HemisphericLight('globalLight', new Vector3(this.lightDirX, this.lightDirY, this.lightDirZ), scene);
    }
    
    light.direction = new Vector3(this.lightDirX, this.lightDirY, this.lightDirZ);
    light.intensity = this.ambientIntensity;
    light.diffuse = Color3.FromHexString(this.ambientColorHex);
    light.groundColor = Color3.FromHexString(this.groundColorHex);
    this.editorSvc.triggerUpdate();
  }

  aplicarGravedad() {
    const scene = this.motor3dSvc.scene;
    scene.gravity = new Vector3(0, this.gravedadY, 0);
    this.editorSvc.triggerUpdate();
  }

  aplicarNiebla() {
    const scene = this.motor3dSvc.scene;
    if (this.fogEnabled) {
      scene.fogMode = 1; // 1 = FOGMODE_EXP
      scene.fogColor = Color3.FromHexString(this.fogColorHex);
      scene.fogDensity = this.fogDensity;
    } else {
      scene.fogMode = 0; // 0 = NONE
    }
    this.editorSvc.triggerUpdate();
  }
}