import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Color3,
  Color4,
  HemisphericLight,
  Scene,
  Vector3
} from '@babylonjs/core';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';

type VisualMode = 'normal' | 'bw';

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

  clearColorHex = '#0d1729';

  ambientIntensity = 0.6;
  ambientColorHex = '#ffffff';
  groundColorHex = '#333333';
  ambientDirX = 0;
  ambientDirY = 1;
  ambientDirZ = 0;

  gravedadY = -0.25;
  visualMode: VisualMode = 'normal';

  ngOnInit() {
    this.leerEstadoActual();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => this.leerEstadoActual())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  leerEstadoActual() {
    const scene = this.motor3dSvc.scene;
    if (!scene) return;

    this.clearColorHex = scene.metadata?.globalClearColor || scene.clearColor.toHexString().substring(0, 7);
    
    this.visualMode = scene.metadata?.globalVisualMode === 'bw' ? 'bw' : 'normal';
    this.motor3dSvc.setVisualMode(this.visualMode);

    const ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight | undefined;
    if (ambient) {
      this.ambientIntensity = ambient.intensity;
      this.ambientColorHex = ambient.diffuse.toHexString().substring(0, 7);
      this.groundColorHex = ambient.groundColor.toHexString().substring(0, 7);
      this.ambientDirX = parseFloat(ambient.direction.x.toFixed(2));
      this.ambientDirY = parseFloat(ambient.direction.y.toFixed(2));
      this.ambientDirZ = parseFloat(ambient.direction.z.toFixed(2));
    }

    this.gravedadY = scene.gravity?.y ?? -0.25;
    this.cdr.detectChanges();
  }

  aplicarModoVisualCambiado() {
    const scene = this.motor3dSvc.scene;
    scene.metadata = { ...(scene.metadata || {}), globalVisualMode: this.visualMode };
    this.motor3dSvc.setVisualMode(this.visualMode);

    // 🔥 MAGIA: Cuando cambiamos el modo, recorremos toda la escena y le aplicamos 
    // su color B&N o su color Normal a todos los objetos geométricos al instante.
    scene.meshes.forEach(mesh => {
      const meta = mesh.metadata;
      if (meta && ['cube', 'sphere', 'cylinder', 'plane'].includes(meta.type)) {
        const colorToApply = this.visualMode === 'bw' 
          ? (meta.colorBW || meta.color || '#ffffff') 
          : (meta.color || '#ffffff');
          
        if (mesh.material && (mesh.material as any).diffuseColor) {
          (mesh.material as any).diffuseColor = Color3.FromHexString(colorToApply);
        }
      }
    });

    this.editorSvc.triggerUpdate();
  }

  aplicarFondo() {
    const scene = this.motor3dSvc.scene;
    scene.clearColor = Color4.FromHexString(this.clearColorHex + 'ff');
    scene.metadata = { ...(scene.metadata || {}), globalClearColor: this.clearColorHex };
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
}