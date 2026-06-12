import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Color3, Color4, HemisphericLight, Vector3, Scene } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-prop-world',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-world.html',
  styleUrls: ['./prop-world.css'] 
})
export class PropWorld implements OnInit, OnDestroy {
  private editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  clearColorHex: string = '#0d1729';
  
  ambientIntensity: number = 0.6;
  ambientColorHex: string = '#ffffff';
  groundColorHex: string = '#333333';
  ambientDirX: number = 0;
  ambientDirY: number = 1;
  ambientDirZ: number = 0;

  gravedadY: number = -0.25;
  
  fogEnabled: boolean = false;
  fogColorHex: string = '#0d1729';
  fogStart: number = 20;
  fogEnd: number = 100;

  ngOnInit() {
    this.leerEstadoActual();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
        this.leerEstadoActual();
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  leerEstadoActual() {
    const scene = this.motor3dSvc.scene;
    if(!scene) return;
    
    this.clearColorHex = scene.clearColor.toHexString().substring(0, 7);

    // Solo cargamos la luz ambiental
    const ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;
    if (ambient) {
      this.ambientIntensity = ambient.intensity;
      this.ambientColorHex = ambient.diffuse.toHexString().substring(0, 7);
      this.groundColorHex = ambient.groundColor.toHexString().substring(0, 7);
      this.ambientDirX = parseFloat(ambient.direction.x.toFixed(2));
      this.ambientDirY = parseFloat(ambient.direction.y.toFixed(2));
      this.ambientDirZ = parseFloat(ambient.direction.z.toFixed(2));
    }

    this.gravedadY = scene.gravity.y;

    this.fogEnabled = scene.fogMode !== Scene.FOGMODE_NONE;
    this.fogColorHex = scene.fogColor.toHexString().substring(0, 7);
    this.fogStart = scene.fogStart;
    this.fogEnd = scene.fogEnd;

    this.cdr.detectChanges();
  }

  aplicarFondo() {
    const scene = this.motor3dSvc.scene;
    scene.clearColor = Color4.FromHexString(this.clearColorHex + 'ff');
    this.editorSvc.triggerUpdate(); 
  }

  aplicarIluminacion() {
    const scene = this.motor3dSvc.scene;
    
    let ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;
    if (!ambient) {
        ambient = new HemisphericLight('ambientLight', new Vector3(this.ambientDirX, this.ambientDirY, this.ambientDirZ), scene);
    }
    
    ambient.direction = new Vector3(this.ambientDirX, this.ambientDirY, this.ambientDirZ);
    ambient.intensity = this.ambientIntensity;
    ambient.diffuse = Color3.FromHexString(this.ambientColorHex);
    ambient.groundColor = Color3.FromHexString(this.groundColorHex);
    ambient.specular = new Color3(0, 0, 0); 
    
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
      scene.fogMode = Scene.FOGMODE_LINEAR; 
      scene.fogColor = Color3.FromHexString(this.fogColorHex);
      scene.fogStart = this.fogStart;
      scene.fogEnd = this.fogEnd;
      // Optimizacion: Evitamos renderizar todo lo que la niebla tapa
      scene.cameras.forEach(cam => cam.maxZ = this.fogEnd + 5);
    } else {
      scene.fogMode = Scene.FOGMODE_NONE; 
      scene.cameras.forEach(cam => cam.maxZ = 10000);
    }
    this.editorSvc.triggerUpdate();
  }
}