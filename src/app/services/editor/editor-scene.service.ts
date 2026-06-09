import { Injectable, inject } from '@angular/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { HistorialService } from '../historial.service';
import { MeshBuilder, Vector3, Color4, AbstractMesh, Mesh, Quaternion, SceneLoader, StandardMaterial, Color3 } from '@babylonjs/core';

// 🔥 OBLIGATORIO: Permite que SceneLoader lea los modelos 3D (.glb)
import '@babylonjs/loaders/glTF';

@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);

  crearEntornoVisual(): void {
    const scene = this.motor3d.scene;
    const size = 50;
    MeshBuilder.CreateLines("ejeX", { points: [new Vector3(-size, 0, 0), new Vector3(size, 0, 0)], colors: [new Color4(1, 0.2, 0.2, 1), new Color4(1, 0.2, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines("ejeY", { points: [new Vector3(0, -size, 0), new Vector3(0, size, 0)], colors: [new Color4(0.2, 1, 0.2, 1), new Color4(0.2, 1, 0.2, 1)] }, scene).isPickable = false;
    MeshBuilder.CreateLines("ejeZ", { points: [new Vector3(0, 0, -size), new Vector3(0, 0, size)], colors: [new Color4(0.2, 0.5, 1, 1), new Color4(0.2, 0.5, 1, 1)] }, scene).isPickable = false;

    const ptsGrid: Vector3[][] = []; const colorsGrid: Color4[][] = [];
    const colorGris = new Color4(0.3, 0.3, 0.3, 0.5);
    for (let i = -60; i <= 60; i += 2) {
      if (i === 0) continue;
      ptsGrid.push([new Vector3(i, 0, -60), new Vector3(i, 0, 60)]); colorsGrid.push([colorGris, colorGris]);
      ptsGrid.push([new Vector3(-60, 0, i), new Vector3(60, 0, i)]); colorsGrid.push([colorGris, colorGris]);
    }
    MeshBuilder.CreateLineSystem("gridHelper", { lines: ptsGrid, colors: colorsGrid }, scene).isPickable = false;
  }

  crearSuelo(): void {
    const scene = this.motor3d.scene;
    const suelo = MeshBuilder.CreateBox("sueloInvisible", { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5; suelo.checkCollisions = true; suelo.isVisible = false; suelo.isPickable = true;
    this.actualizarListaNodos();
  }

  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = ''
  ): void {
    const scene = this.motor3d.scene;

    const isModel = tipo === 'model';
    
    // 🔥 Diferenciamos orígenes: Un .glb nace en los pies (Y=0). Un Cubo nace en el centro (Y=0.5).
    const defaultCapsule = isModel 
        ? { radiusX: 0.4, heightY: 0.9, radiusZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
        : { radiusX: 0.5, heightY: 0.5, radiusZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 }; 

    const defaultCamOffset = isModel
        ? { x: 0, y: 1.6, z: 0 }
        : { x: 0, y: 0.8, z: 0 }; 

    if (isModel && asset) {
      const fullPath = 'http://localhost:4000' + asset.path;
      const lastSlash = fullPath.lastIndexOf('/');
      const rootUrl = fullPath.substring(0, lastSlash + 1);
      const filename = fullPath.substring(lastSlash + 1);

      SceneLoader.ImportMeshAsync("", rootUrl, filename, scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        rootNode.name = nombre;
        rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);
        if (!rootNode.rotationQuaternion) rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rootNode.rotation.x, rootNode.rotation.y, rootNode.rotation.z);
        rootNode.position = new Vector3(0, 0, 0); // Modelos al suelo perfecto
        rootNode.checkCollisions = false;
        rootNode.isPickable = true;

        result.meshes.forEach(m => {
          if (m !== rootNode) {
            m.isPickable = true;
            m.checkCollisions = isSolid;
          }
        });

        const anims = result.animationGroups || [];
        anims.forEach(ag => ag.stop());

        rootNode.metadata = { 
            type: 'model', rol, assetId: asset.id, path: asset.path, 
            isSolid, isSelectable, animations: anims, mensaje,
            capsule: { ...defaultCapsule },
            camOffset: { ...defaultCamOffset }
        };

        rootNode.ellipsoid = new Vector3(defaultCapsule.radiusX * sizeX, defaultCapsule.heightY * sizeY, defaultCapsule.radiusZ * sizeZ);
        rootNode.ellipsoidOffset = new Vector3(defaultCapsule.offsetX * sizeX, defaultCapsule.offsetY * sizeY, defaultCapsule.offsetZ * sizeZ);

        this.state.objetoSeleccionado.set(rootNode);
        this.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(rootNode);
        this.state.triggerUpdate();
      });
    } else {
      let mesh!: Mesh;
      let offsetColisionY = 0.5; // Porque los objetos primitivos de Babylon se crean desde el centro
      
      switch (tipo) {
        case 'cube': mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
        case 'sphere': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreateGround(nombre, { width: 1, height: 1 }, scene); offsetColisionY = 0.02; break;
      }
      
      // 🔥 TRUCO MAGISTRAL: Como le aplicamos offsetColisionY multiplicado por sizeY, las primitivas quedan sobre el suelo idéntico a un GLB
      mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);
      mesh.position = new Vector3(0, offsetColisionY * sizeY, 0); 
      
      mesh.metadata = { 
          type: tipo, rol, color: colorHex, isSolid, isSelectable, mensaje,
          capsule: { ...defaultCapsule },
          camOffset: { ...defaultCamOffset }
      };

      mesh.isPickable = true;
      mesh.checkCollisions = isSolid;
      
      mesh.ellipsoid = new Vector3(defaultCapsule.radiusX * sizeX, defaultCapsule.heightY * sizeY, defaultCapsule.radiusZ * sizeZ);
      mesh.ellipsoidOffset = new Vector3(defaultCapsule.offsetX * sizeX, defaultCapsule.offsetY * sizeY, defaultCapsule.offsetZ * sizeZ);

      const mat = new StandardMaterial("mat_" + nombre, scene);
      mat.diffuseColor = Color3.FromHexString(colorHex);
      if (rol === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
      mesh.material = mat;

      this.state.objetoSeleccionado.set(mesh);
      this.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(mesh);
      this.state.triggerUpdate();
    }
  }

  cargarEscenaDesdeDatos(objetosBD: any[]): void {
    if (!objetosBD || objetosBD.length === 0) return;
    const scene = this.motor3d.scene;
    
    objetosBD.forEach(obj => {
      const isModel = obj.type === 'model';
      const defaultCapsule = isModel 
          ? { radiusX: 0.4, heightY: 0.9, radiusZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
          : { radiusX: 0.5, heightY: 0.5, radiusZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 }; 

      const defaultCamOffset = isModel
          ? { x: 0, y: 1.6, z: 0 }
          : { x: 0, y: 0.8, z: 0 }; 

      const rolSaved = obj.properties?.rol || 'prop';
      const isSolidSaved = obj.properties?.isSolid ?? true;
      const isSelectableSaved = obj.properties?.isSelectable ?? true;
      const mensajeSaved = obj.properties?.mensaje || '';
      
      const savedCapsule = obj.properties?.capsule || { ...defaultCapsule };
      const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };

      if (isModel && obj.assetId) {
        const path = obj.properties?.path || obj.asset?.path;
        if (!path) return;
        const fullPath = 'http://localhost:4000' + path;
        const lastSlash = fullPath.lastIndexOf('/');
        SceneLoader.ImportMeshAsync("", fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
          const rootNode = result.meshes[0] as Mesh;
          rootNode.name = obj.name;
          rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
          rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
          rootNode.checkCollisions = false;
          rootNode.isPickable = true;

          result.meshes.forEach(m => {
            if (m !== rootNode) {
              m.isPickable = true;
              m.checkCollisions = isSolidSaved;
            }
          });

          const anims = result.animationGroups || [];
          anims.forEach(ag => ag.stop());

          rootNode.metadata = { 
              type: 'model', rol: rolSaved, assetId: obj.assetId, path, 
              isSolid: isSolidSaved, isSelectable: isSelectableSaved, 
              animations: anims, mensaje: mensajeSaved,
              capsule: savedCapsule, camOffset: savedCamOffset
          };
          
          rootNode.ellipsoid = new Vector3(savedCapsule.radiusX * obj.scale.x, savedCapsule.heightY * obj.scale.y, savedCapsule.radiusZ * obj.scale.z);
          rootNode.ellipsoidOffset = new Vector3(savedCapsule.offsetX * obj.scale.x, savedCapsule.offsetY * obj.scale.y, savedCapsule.offsetZ * obj.scale.z);

          this.actualizarListaNodos();
        });
      } else {
        let mesh!: Mesh;
        switch (obj.type) {
          case 'cube': mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene); break;
          case 'sphere': mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene); break;
          case 'cylinder': mesh = MeshBuilder.CreateCylinder(obj.name, { height: 1, diameter: 1 }, scene); break;
          case 'plane': mesh = MeshBuilder.CreateGround(obj.name, { width: 1, height: 1 }, scene); break;
          default: return;
        }
        mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
        mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
        const savedColor = obj.properties?.color || '#888888';
        
        mesh.metadata = { 
            type: obj.type, rol: rolSaved, color: savedColor, 
            isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
            capsule: savedCapsule, camOffset: savedCamOffset
        };
        mesh.isPickable = true;
        mesh.checkCollisions = isSolidSaved;

        mesh.ellipsoid = new Vector3(savedCapsule.radiusX * obj.scale.x, savedCapsule.heightY * obj.scale.y, savedCapsule.radiusZ * obj.scale.z);
        mesh.ellipsoidOffset = new Vector3(savedCapsule.offsetX * obj.scale.x, savedCapsule.offsetY * obj.scale.y, savedCapsule.offsetZ * obj.scale.z);

        const mat = new StandardMaterial("mat_" + obj.name, scene);
        mat.diffuseColor = Color3.FromHexString(savedColor);
        if (rolSaved === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
        mesh.material = mat;
      }
    });
    this.actualizarListaNodos();
  }

  obtenerDatosParaGuardar(): any[] {
    return this.state.nodosEscena().map(nodo => {
      if (nodo instanceof AbstractMesh && nodo.metadata?.type) {
        let rot = nodo.rotationQuaternion ? nodo.rotationQuaternion.toEulerAngles() : nodo.rotation;
        let baseData = {
          name: nodo.name,
          position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
          rotation: { x: rot.x, y: rot.y, z: rot.z },
          scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z }
        };

        const propertiesToSave = {
            rol: nodo.metadata.rol,
            isSolid: nodo.metadata.isSolid,
            isSelectable: nodo.metadata.isSelectable,
            mensaje: nodo.metadata.mensaje,
            capsule: nodo.metadata.capsule,
            camOffset: nodo.metadata.camOffset
        };

        if (nodo.metadata.type === 'model') {
          return {
            ...baseData,
            type: 'model',
            assetId: nodo.metadata.assetId,
            properties: { path: nodo.metadata.path, ...propertiesToSave }
          };
        }
        return {
          ...baseData,
          type: nodo.metadata.type,
          properties: { color: nodo.metadata.color, ...propertiesToSave }
        };
      }
      return null;
    }).filter(n => n !== null);
  }

  eliminarSeleccionado(): void {
    const obj = this.state.objetoSeleccionado();
    if (obj && obj instanceof Mesh) {
      this.state.objetoSeleccionado.set(null);
      obj.dispose(false, true);
      this.actualizarListaNodos();
      this.state.triggerUpdate();
    }
  }

  actualizarListaNodos(): void {
    if (!this.motor3d.scene) return;
    const scene = this.motor3d.scene;
    this.state.nodosEscena.set([
      ...scene.cameras, ...scene.lights,
      ...scene.meshes.filter(m =>
        !['ejeX', 'ejeY', 'ejeZ', 'gridHelper', 'sueloInvisible'].includes(m.name) &&
        !m.name.includes('gizmo') && !m.name.includes('highlight') && m.parent === null
      )
    ]);
  }

  limpiarEstado(): void {
    this.state.nodosEscena().forEach((nodo) => { 
      if (nodo instanceof AbstractMesh && nodo.name !== "sueloInvisible") nodo.dispose(false, true); 
    });
    this.state.nodosEscena.set([]);
  }
}