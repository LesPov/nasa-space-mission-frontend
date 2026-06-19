
import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Color3,
  Color4,
  HemisphericLight,
  Scene,
  Vector3,
  StandardMaterial,
  Mesh
} from '@babylonjs/core';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

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
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  clearColorHex = '#0d1729';
  clearColorHexBW = '#555555';

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

    this.clearColorHex = scene.metadata?.globalClearColor || '#0d1729';
    this.clearColorHexBW = scene.metadata?.globalClearColorBW || '#555555';
    
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

    const isBW = this.visualMode === 'bw';

    this.aplicarFondo();

    this.entityManager.getAllEntities().forEach(entity => {
      const mesh = entity.view as Mesh;
      if (!mesh) return;

      const activeColorHex = isBW ? (entity.visual.colorBW || entity.visual.color || '#ffffff') : (entity.visual.color || '#ffffff');
      const c3 = Color3.FromHexString(activeColorHex);

      // 🔥 Se mapea a Runtime puro para la textura generada proceduralmente
      if (entity.type === 'image_plane' && entity.mediaRuntime?.runtimeDecalMaterial) {
        const decalMat = entity.mediaRuntime.runtimeDecalMaterial as StandardMaterial;
        const brillo = Number(entity.visual.brilloIntensidad ?? 1.0);
        
        decalMat.diffuseColor = c3;
        decalMat.emissiveColor = c3.scale(brillo);
      } 
      else if (['cube', 'sphere', 'cylinder', 'plane', 'model'].includes(entity.type)) {
        if (mesh.material && (mesh.material as any).diffuseColor) {
          const mat = mesh.material as StandardMaterial;
          mat.diffuseColor = c3;

          if (entity.visual.esEmisivo) {
            const brillo = Number(entity.visual.brilloIntensidad ?? 1.0);
            mat.emissiveColor = c3.scale(brillo);
          } else {
            mat.emissiveColor = new Color3(0, 0, 0);
          }
        }
      }
      else if (entity.type.startsWith('light_')) {
          const activeLightColorHex = isBW ? (entity.light?.lightColorBW || entity.light?.lightColor || '#ffffff') : (entity.light?.lightColor || '#ffffff');
          const c3Light = Color3.FromHexString(activeLightColorHex);

          if (mesh.material && (mesh.material as any).emissiveColor) {
              (mesh.material as StandardMaterial).emissiveColor = c3Light;
          }
          const lightObj = mesh.getDescendants(false).find(c => c.name.startsWith('l_')) as any;
          if (lightObj && lightObj.diffuse) {
              lightObj.diffuse = c3Light;
          }
      }
    });

    this.editorSvc.triggerUpdate();
  }

  aplicarFondo() {
    const scene = this.motor3dSvc.scene;
    scene.metadata = { 
      ...(scene.metadata || {}), 
      globalClearColor: this.clearColorHex,
      globalClearColorBW: this.clearColorHexBW 
    };

    const activeClearHex = this.visualMode === 'bw' ? this.clearColorHexBW : this.clearColorHex;
    scene.clearColor = Color4.FromHexString(activeClearHex + 'ff');

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