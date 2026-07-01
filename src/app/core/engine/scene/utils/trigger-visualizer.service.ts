import { Injectable } from '@angular/core';
import { AbstractMesh, Color3, LinesMesh, MeshBuilder, Vector3, Tags } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class TriggerVisualizerService {
  
  public createOrUpdateWireframe(mesh: AbstractMesh, shape: string, isComposite: boolean, actionType: string): void {
    // 🔥 FIX: Casteamos a LinesMesh para poder acceder a la propiedad .color sin errores de TypeScript
    let wireframe = mesh.getChildMeshes(true).find(m => Tags.MatchesQuery(m, "trigger_wireframe")) as LinesMesh;

    // Colores base de Debug (Estilo Unreal/Unity)
    let baseColor = new Color3(0, 1, 0); // Verde normal
    if (isComposite) baseColor = new Color3(0, 0.8, 1); // Cyan compuesto
    if (!isComposite && actionType === 'change_scene') baseColor = new Color3(1, 0.2, 0.2); // Rojo transición

    if (!wireframe) {
      let lines: Vector3[][] = [];
      if (shape === 'sphere') lines = this.getSphereLines();
      else if (shape === 'cylinder') lines = this.getCylinderLines();
      else lines = this.getBoxLines();

      wireframe = MeshBuilder.CreateLineSystem('wireframe_' + mesh.name, { lines: lines, updatable: true }, mesh.getScene());
      wireframe.parent = mesh;
      
      // Optimizaciones extremas para Bounding Box Lines
      wireframe.isPickable = false;
      wireframe.checkCollisions = false;
      wireframe.receiveShadows = false;
      wireframe.applyFog = false;
      wireframe.doNotSyncBoundingInfo = true;
      wireframe.alwaysSelectAsActiveMesh = false;
      
      // 🔥 FIX 2: Eliminamos 'editor_only' para que su visibilidad dependa exclusivamente 
      // de la malla padre (el Trigger). Así, en Test Live (cuando isDebugMode es true) 
      // el padre lo mostrará automáticamente sin que sea desactivado por el modo de juego.
      Tags.AddTagsTo(wireframe, "system_element trigger_wireframe ignore_raycast");
    }

    // Cacheamos el color base para poder restaurarlo después de los Hovers
    if (!wireframe.metadata) wireframe.metadata = {};
    wireframe.metadata.baseColor = baseColor;
    wireframe.color = baseColor;
  }

  public setHighlight(mesh: AbstractMesh, state: 'hover' | 'selected' | 'none'): void {
    // 🔥 FIX: Casteamos a LinesMesh para evitar error TS2339
    let wireframe = mesh.getChildMeshes(true).find(m => Tags.MatchesQuery(m, "trigger_wireframe")) as LinesMesh;
    if (!wireframe) return;

    let color = wireframe.metadata?.baseColor || new Color3(0, 1, 0);
    if (state === 'hover') color = new Color3(0.2, 0.5, 1); // Azul hover
    if (state === 'selected') color = new Color3(1, 0.8, 0); // Amarillo seleccionado

    wireframe.color = color;
  }

  private getBoxLines(): Vector3[][] {
    const hs = 0.5;
    return [
      [new Vector3(-hs, -hs, -hs), new Vector3(hs, -hs, -hs), new Vector3(hs, -hs, hs), new Vector3(-hs, -hs, hs), new Vector3(-hs, -hs, -hs)],
      [new Vector3(-hs, hs, -hs), new Vector3(hs, hs, -hs), new Vector3(hs, hs, hs), new Vector3(-hs, hs, hs), new Vector3(-hs, hs, -hs)],
      [new Vector3(-hs, -hs, -hs), new Vector3(-hs, hs, -hs)],
      [new Vector3(hs, -hs, -hs), new Vector3(hs, hs, -hs)],
      [new Vector3(hs, -hs, hs), new Vector3(hs, hs, hs)],
      [new Vector3(-hs, -hs, hs), new Vector3(-hs, hs, hs)]
    ];
  }

  private getSphereLines(): Vector3[][] {
    const segments = 32;
    const lines: Vector3[][] = [[], [], []];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle) * 0.5;
      const sin = Math.sin(angle) * 0.5;
      lines[0].push(new Vector3(cos, sin, 0));
      lines[1].push(new Vector3(cos, 0, sin));
      lines[2].push(new Vector3(0, cos, sin));
    }
    return lines;
  }

  private getCylinderLines(): Vector3[][] {
    const segments = 32;
    const lines: Vector3[][] = [[], []];
    const hs = 0.5;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle) * 0.5;
      const sin = Math.sin(angle) * 0.5;
      lines[0].push(new Vector3(cos, hs, sin));
      lines[1].push(new Vector3(cos, -hs, sin));
    }
    lines.push([new Vector3(0.5, hs, 0), new Vector3(0.5, -hs, 0)]);
    lines.push([new Vector3(-0.5, hs, 0), new Vector3(-0.5, -hs, 0)]);
    lines.push([new Vector3(0, hs, 0.5), new Vector3(0, -hs, 0.5)]);
    lines.push([new Vector3(0, hs, -0.5), new Vector3(0, -hs, -0.5)]);
    return lines;
  }
}