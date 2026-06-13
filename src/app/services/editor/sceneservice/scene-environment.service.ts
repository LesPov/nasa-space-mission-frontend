import { Injectable, inject } from '@angular/core';
import { Color3, Color4, HemisphericLight, MeshBuilder, Scene, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { SceneNodesService } from './scene-nodes.service';

@Injectable({ providedIn: 'root' })
export class SceneEnvironmentService {
  private motor3d = inject(Motor3dService);
  private nodesSvc = inject(SceneNodesService);

  public crearEntornoVisual(): void {
    const scene = this.motor3d.scene;
    const size = 50;
    MeshBuilder.CreateLines('ejeX', { points: [new Vector3(-size, 0, 0), new Vector3(size, 0, 0)], colors: [new Color4(1, 0.2, 0.2, 1), new Color4(1, 0.2, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines('ejeY', { points: [new Vector3(0, -size, 0), new Vector3(0, size, 0)], colors: [new Color4(0.2, 1, 0.2, 1), new Color4(0.2, 1, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines('ejeZ', { points: [new Vector3(0, 0, -size), new Vector3(0, 0, size)], colors: [new Color4(0.2, 0.5, 1, 1), new Color4(0.2, 0.5, 1, 1)] }, scene).isPickable = false;

    const ptsGrid: Vector3[][] = [];
    const colorsGrid: Color4[][] = [];
    const colorGris = new Color4(0.3, 0.3, 0.3, 0.5);

    for (let i = -60; i <= 60; i += 2) {
      if (i === 0) continue;
      ptsGrid.push([new Vector3(i, 0, -60), new Vector3(i, 0, 60)]); colorsGrid.push([colorGris, colorGris]);
      ptsGrid.push([new Vector3(-60, 0, i), new Vector3(60, 0, i)]); colorsGrid.push([colorGris, colorGris]);
    }
    MeshBuilder.CreateLineSystem('gridHelper', { lines: ptsGrid, colors: colorsGrid }, scene).isPickable = false;
  }

  public crearSuelo(): void {
    const scene = this.motor3d.scene;
    const suelo = MeshBuilder.CreateBox('sueloInvisible', { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5;
    suelo.checkCollisions = true;
    suelo.isVisible = false;
    suelo.isPickable = true;
    suelo.receiveShadows = true;
    this.nodesSvc.actualizarListaNodos();
  }

  public configurarAmbienteGlobal(scene: Scene, props: any): void {
    let ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;
    if (!ambient) {
      ambient = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
    }
    ambient.direction = new Vector3(props.ambientDirX ?? 0, props.ambientDirY ?? 1, props.ambientDirZ ?? 0);
    ambient.intensity = props.ambientIntensity ?? 0.6;
    ambient.diffuse = Color3.FromHexString(props.ambientDiffuse || '#ffffff');
    ambient.groundColor = Color3.FromHexString(props.ambientGround || '#333333');
    ambient.specular = new Color3(0, 0, 0);

    if (!scene.environmentTexture) {
      scene.createDefaultEnvironment({
        createSkybox: false,
        createGround: false,
        enableGroundShadow: false,
        setupImageProcessing: false
      });
    }

    const oldGlobal = scene.lights.find(l => l.name === 'globalLight');
    if (oldGlobal) oldGlobal.dispose();
    const oldSun = scene.lights.find(l => l.name === 'sunLight');
    if (oldSun) oldSun.dispose();
  }
}