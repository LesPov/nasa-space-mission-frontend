import { Injectable, inject } from '@angular/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { HistorialService } from '../historial.service';
import {
  MeshBuilder, Vector3, Color4, AbstractMesh, Mesh, Quaternion, SceneLoader, StandardMaterial, Color3, TransformNode, Matrix
} from '@babylonjs/core';

import '@babylonjs/loaders/glTF';
import { cloneDefaultPlayerConfig, mergePlayerConfig } from './player-config.model';

@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);

  crearEntornoVisual(): void {
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

  crearSuelo(): void {
    const scene = this.motor3d.scene;
    const suelo = MeshBuilder.CreateBox('sueloInvisible', { width: 200, depth: 200, height: 1 }, scene);
    suelo.position.y = -0.5;
    suelo.checkCollisions = true;
    suelo.isVisible = false;
    suelo.isPickable = true;
    this.actualizarListaNodos();
  }

  reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    const scene = this.motor3d.scene;
    let newMesh!: Mesh;
    
    switch (nuevaForma) {
        case 'sphere': newMesh = MeshBuilder.CreateSphere(oldMesh.name, { diameter: 1 }, scene); break;
        case 'cylinder': newMesh = MeshBuilder.CreateCylinder(oldMesh.name, { height: 1, diameter: 1 }, scene); break;
        default: newMesh = MeshBuilder.CreateBox(oldMesh.name, { size: 1 }, scene); break;
    }

    newMesh.position = oldMesh.position.clone();
    if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
    else newMesh.rotation = oldMesh.rotation.clone();
    newMesh.scaling = oldMesh.scaling.clone();
    
    newMesh.metadata = JSON.parse(JSON.stringify(oldMesh.metadata));
    newMesh.metadata.triggerShape = nuevaForma;

    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2); 
    mat.alpha = 0.3; 
    mat.wireframe = true;
    newMesh.material = mat;
    
    newMesh.isPickable = true;
    newMesh.checkCollisions = false;
    newMesh.isVisible = this.state.rolSimulado() === 'admin';

    if (this.state.objetoSeleccionado() === oldMesh) {
        this.state.objetoSeleccionado.set(newMesh);
    }
    oldMesh.dispose();
    this.actualizarListaNodos();
    return newMesh;
  }

  agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number): void {
    const scene = this.motor3d.scene;
    let mesh!: Mesh;
    switch (shape) {
        case 'sphere': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
    }
    
    mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);
    mesh.position = new Vector3(0, sizeY / 2, 0);

    const mat = new StandardMaterial('mat_trigger_' + nombre, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2); 
    mat.alpha = 0.3; 
    mat.wireframe = true;
    mesh.material = mat;

    mesh.metadata = {
      type: 'trigger',
      isComposite: isComposite,
      triggerShape: shape || 'cube',
      
      // Compuesto
      conditions: isComposite ? ['on_enter'] : [],
      mensajeEntrada: isComposite ? mensaje : '',
      mensajeSalida: '',
      soundUrlEntrada: '',
      soundUrlSalida: '',
      seqEntrada: '',
      seqSalida: '',
      timeEntrada: 4.5,
      timeSalida: 4.5,
      videoEntrada: '',
      videoSalida: '',

      // Normal
      condition: 'on_enter',
      mensaje: isComposite ? '' : mensaje,
      soundUrl: '',
      interactSequenceId: '', 
      timeNorm: 4.5,
      videoNorm: '',

      isRepeatable: false,
      isEnabled: true,
      hasTriggeredEnter: false,
      hasTriggeredExit: false
    };

    mesh.isPickable = true;
    mesh.checkCollisions = false; 
    mesh.isVisible = this.state.rolSimulado() === 'admin';

    this.state.objetoSeleccionado.set(mesh);
    this.actualizarListaNodos();
    this.historialSvc.registrarAccionCrear(mesh);
    this.state.triggerUpdate();
  }

  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = ''
  ): void {
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
        const isComposite = tipo === 'trigger_compuesto';
        this.agregarTriggerCustom(nombre, 'cube', isComposite, mensaje, sizeX, sizeY, sizeZ);
        return;
    }

    const scene = this.motor3d.scene;
    const isModel = tipo === 'model';

    const defaultCollider = isModel
      ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
      : { type: tipo === 'sphere' ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };

    const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
    const defaultPlayerConfig = cloneDefaultPlayerConfig();

    if (isModel && asset) {
      const fullPath = 'http://localhost:4000' + asset.path;
      const lastSlash = fullPath.lastIndexOf('/');
      const rootUrl = fullPath.substring(0, lastSlash + 1);
      const filename = fullPath.substring(lastSlash + 1);

      SceneLoader.ImportMeshAsync('', rootUrl, filename, scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        rootNode.name = nombre;
        rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);
        if (!rootNode.rotationQuaternion) rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rootNode.rotation.x, rootNode.rotation.y, rootNode.rotation.z);
        rootNode.position = new Vector3(0, 0, 0);
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

        let initialHeadLocal: Vector3 | null = null;
        const headNode = rootNode.getChildTransformNodes(false).find(n =>
          n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')
        ) as TransformNode;

        if (headNode) {
          headNode.computeWorldMatrix(true);
          rootNode.computeWorldMatrix(true);
          initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
        }

        rootNode.metadata = {
          type: 'model', rol, assetId: asset.id, path: asset.path, isSolid, isSelectable, mensaje,
          interactDistanceFPS: 3.0, interactDistanceTPS: 5.0, interactSequenceIdFPS: '', interactSequenceIdTPS: '',
          animationNames: anims.map(a => a.name), collider: { ...defaultCollider }, camOffset: { ...defaultCamOffset },
          playerConfig: defaultPlayerConfig, initialHeadLocal
        };

        rootNode.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
        rootNode.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

        this.state.objetoSeleccionado.set(rootNode);
        this.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(rootNode);
        this.state.triggerUpdate();
      });
    } else {
      let mesh!: Mesh;
      switch (tipo) {
        case 'cube': mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
        case 'sphere': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
        case 'plane': mesh = MeshBuilder.CreateGround(nombre, { width: 1, height: 1 }, scene); break;
        default: return;
      }

      mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);
      mesh.position = new Vector3(0, 0.5 * sizeY, 0);

      mesh.metadata = {
        type: tipo, rol, color: colorHex, isSolid, isSelectable, mensaje,
        interactDistanceFPS: 3.0, interactDistanceTPS: 5.0, interactSequenceIdFPS: '', interactSequenceIdTPS: '',
        collider: { ...defaultCollider }, camOffset: { ...defaultCamOffset }, playerConfig: defaultPlayerConfig
      };

      mesh.isPickable = true;
      mesh.checkCollisions = isSolid;
      mesh.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
      mesh.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

      const mat = new StandardMaterial('mat_' + nombre, scene);
      mat.diffuseColor = Color3.FromHexString(colorHex);
      if (rol === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
      mesh.material = mat;

      this.state.objetoSeleccionado.set(mesh);
      this.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(mesh);
      this.state.triggerUpdate();
    }
  }

  cargarEscenaDesdeDatos(dataBD: any): void {
    if (!dataBD) return;
    const scene = this.motor3d.scene;

    const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
    const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);

    const isAdmin = this.state.rolSimulado() === 'admin';

    objetosBD.forEach((obj: any) => {
      const isModel = obj.type === 'model';
      const defaultCollider = isModel
        ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
        : { type: obj.type === 'sphere' ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
      const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
      const defaultPlayerConfig = cloneDefaultPlayerConfig();

      const rolSaved = obj.properties?.rol || 'prop';
      const isSolidSaved = obj.properties?.isSolid ?? true;
      const isSelectableSaved = obj.properties?.isSelectable ?? true;
      const mensajeSaved = obj.properties?.mensaje || '';
      
      const interactDistanceFPS = obj.properties?.interactDistanceFPS ?? 3.0;
      const interactDistanceTPS = obj.properties?.interactDistanceTPS ?? 5.0;
      const interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
      const interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';

      const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
      if (savedCollider.radiusX !== undefined) {
        savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
        savedCollider.type = isModel ? 'capsule' : 'box';
        delete savedCollider.radiusX; delete savedCollider.heightY; delete savedCollider.radiusZ;
      }
      if (!savedCollider.type) savedCollider.type = isModel ? 'capsule' : 'box';

      const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };
      const savedPlayerConfig = mergePlayerConfig(obj.properties?.playerConfig || null);

      if (isModel && obj.assetId) {
        const path = obj.properties?.path || obj.asset?.path;
        if (!path) return;
        const fullPath = 'http://localhost:4000' + path;
        const lastSlash = fullPath.lastIndexOf('/');

        SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
          const rootNode = result.meshes[0] as Mesh;
          rootNode.name = obj.name;
          rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
          rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
          rootNode.checkCollisions = false; rootNode.isPickable = true;

          result.meshes.forEach(m => { if (m !== rootNode) { m.isPickable = true; m.checkCollisions = isSolidSaved; } });
          const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

          let initialHeadLocal: Vector3 | null = null;
          const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
          if (headNode) {
            headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
            initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
          }

          rootNode.metadata = {
            type: 'model', rol: rolSaved, assetId: obj.assetId, path, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
            interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
            animationNames: anims.map(a => a.name), collider: savedCollider, camOffset: savedCamOffset, playerConfig: savedPlayerConfig, initialHeadLocal
          };
          rootNode.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
          rootNode.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);
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
          type: obj.type, rol: rolSaved, color: savedColor, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
          interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
          collider: savedCollider, camOffset: savedCamOffset, playerConfig: savedPlayerConfig
        };

        mesh.isPickable = true; mesh.checkCollisions = isSolidSaved;
        mesh.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
        mesh.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);

        const mat = new StandardMaterial('mat_' + obj.name, scene);
        mat.diffuseColor = Color3.FromHexString(savedColor);
        if (rolSaved === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
        mesh.material = mat;
      }
    });

    triggersBD.forEach((trigger: any) => {
        let mesh = scene.getMeshByName(trigger.name) as Mesh;
        const shape = trigger.actionProperties?.triggerShape || 'cube';
        const isComposite = trigger.actionProperties?.isComposite ?? false;

        if (!mesh) {
            switch (shape) {
                case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
                case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
                default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
            }

            mesh.position = new Vector3(trigger.position.x, trigger.position.y, trigger.position.z);
            mesh.scaling = new Vector3(trigger.size.x, trigger.size.y, trigger.size.z);
            
            const mat = new StandardMaterial('mat_trigger_' + trigger.name, scene);
            mat.diffuseColor = new Color3(0.2, 1, 0.2); 
            mat.alpha = 0.3; 
            mat.wireframe = true;
            mesh.material = mat;
            mesh.isPickable = true;
            mesh.checkCollisions = false;

            mesh.isVisible = isAdmin;

            mesh.metadata = {
                type: 'trigger',
                triggerShape: shape,
                isComposite: isComposite,

                conditions: [],
                mensajeEntrada: '', mensajeSalida: '',
                soundUrlEntrada: '', soundUrlSalida: '',
                seqEntrada: '', seqSalida: '',
                timeEntrada: 4.5, timeSalida: 4.5,
                videoEntrada: '', videoSalida: '',

                condition: 'on_enter',
                mensaje: '',
                soundUrl: '',
                interactSequenceId: '',
                timeNorm: 4.5, videoNorm: '',

                isRepeatable: trigger.isRepeatable,
                isEnabled: trigger.isEnabled,
                hasTriggeredEnter: false,
                hasTriggeredExit: false
            };
        }

        if (isComposite) {
            if (trigger.condition && !mesh.metadata.conditions.includes(trigger.condition)) {
                mesh.metadata.conditions.push(trigger.condition);
            }
            if (trigger.condition === 'on_enter') {
                mesh.metadata.mensajeEntrada = trigger.actionProperties?.mensaje || '';
                mesh.metadata.soundUrlEntrada = trigger.actionProperties?.soundUrl || '';
                mesh.metadata.seqEntrada = trigger.actionProperties?.seqEntrada || '';
                mesh.metadata.timeEntrada = trigger.actionProperties?.timeEntrada ?? 4.5;
                mesh.metadata.videoEntrada = trigger.actionProperties?.videoEntrada || '';
            } else if (trigger.condition === 'on_exit') {
                mesh.metadata.mensajeSalida = trigger.actionProperties?.mensaje || '';
                mesh.metadata.soundUrlSalida = trigger.actionProperties?.soundUrl || '';
                mesh.metadata.seqSalida = trigger.actionProperties?.seqSalida || '';
                mesh.metadata.timeSalida = trigger.actionProperties?.timeSalida ?? 4.5;
                mesh.metadata.videoSalida = trigger.actionProperties?.videoSalida || '';
            }
        } else {
            mesh.metadata.condition = trigger.condition || 'on_enter';
            mesh.metadata.mensaje = trigger.actionProperties?.mensaje || '';
            mesh.metadata.soundUrl = trigger.actionProperties?.soundUrl || '';
            mesh.metadata.interactSequenceId = trigger.actionProperties?.interactSequenceId || '';
            mesh.metadata.timeNorm = trigger.actionProperties?.timeNorm ?? 4.5;
            mesh.metadata.videoNorm = trigger.actionProperties?.videoNorm || '';
        }
    });

    this.actualizarListaNodos();
  }

  obtenerDatosParaGuardar(): { sceneObjects: any[], triggers: any[] } {
    const sceneObjects: any[] = [];
    const triggers: any[] = [];

    this.state.nodosEscena().forEach(nodo => {
      if (nodo instanceof AbstractMesh && nodo.metadata?.type) {
        const rot = nodo.rotationQuaternion ? nodo.rotationQuaternion.toEulerAngles() : nodo.rotation;
        
        if (nodo.metadata.type === 'trigger') {
            if (nodo.metadata.isComposite) {
                const conditions = nodo.metadata.conditions || [];
                conditions.forEach((cond: string) => {
                    let actionProps: any = { 
                        triggerShape: nodo.metadata.triggerShape,
                        isComposite: true
                    };
                    
                    if (cond === 'on_enter') {
                        actionProps.mensaje = nodo.metadata.mensajeEntrada || '';
                        actionProps.soundUrl = nodo.metadata.soundUrlEntrada || '';
                        actionProps.seqEntrada = nodo.metadata.seqEntrada || '';
                        actionProps.timeEntrada = nodo.metadata.timeEntrada ?? 4.5;
                        actionProps.videoEntrada = nodo.metadata.videoEntrada || '';
                    }
                    if (cond === 'on_exit') {
                        actionProps.mensaje = nodo.metadata.mensajeSalida || '';
                        actionProps.soundUrl = nodo.metadata.soundUrlSalida || '';
                        actionProps.seqSalida = nodo.metadata.seqSalida || '';
                        actionProps.timeSalida = nodo.metadata.timeSalida ?? 4.5;
                        actionProps.videoSalida = nodo.metadata.videoSalida || '';
                    }

                    triggers.push({
                        name: nodo.name,
                        position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
                        scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z }, 
                        properties: {
                            condition: cond,
                            actionType: 'show_message', 
                            targetObjectName: '',
                            isRepeatable: nodo.metadata.isRepeatable,
                            isEnabled: nodo.metadata.isEnabled,
                            ...actionProps
                        }
                    });
                });
            } else {
                triggers.push({
                    name: nodo.name,
                    position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
                    scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z }, 
                    properties: {
                        condition: nodo.metadata.condition,
                        actionType: 'show_message', 
                        targetObjectName: '',
                        isRepeatable: nodo.metadata.isRepeatable,
                        isEnabled: nodo.metadata.isEnabled,
                        triggerShape: nodo.metadata.triggerShape,
                        mensaje: nodo.metadata.mensaje,
                        soundUrl: nodo.metadata.soundUrl,
                        interactSequenceId: nodo.metadata.interactSequenceId,
                        timeNorm: nodo.metadata.timeNorm ?? 4.5,
                        videoNorm: nodo.metadata.videoNorm || '',
                        isComposite: false
                    }
                });
            }
            return; 
        }

        const baseData = {
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
          interactDistanceFPS: nodo.metadata.interactDistanceFPS ?? 3.0,
          interactDistanceTPS: nodo.metadata.interactDistanceTPS ?? 5.0,
          interactSequenceIdFPS: nodo.metadata.interactSequenceIdFPS || '',
          interactSequenceIdTPS: nodo.metadata.interactSequenceIdTPS || '',
          collider: nodo.metadata.collider,
          camOffset: nodo.metadata.camOffset,
          playerConfig: nodo.metadata.playerConfig || null,
          animationNames: nodo.metadata.animationNames || []
        };

        if (nodo.metadata.type === 'model') {
          sceneObjects.push({
            ...baseData,
            type: 'model',
            assetId: nodo.metadata.assetId,
            properties: { path: nodo.metadata.path, ...propertiesToSave }
          });
        } else {
          sceneObjects.push({
            ...baseData,
            type: nodo.metadata.type,
            properties: { color: nodo.metadata.color, ...propertiesToSave }
          });
        }
      }
    });

    return { sceneObjects, triggers };
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
      ...scene.cameras,
      ...scene.lights,
      ...scene.meshes.filter(m =>
        !['ejeX', 'ejeY', 'ejeZ', 'gridHelper', 'sueloInvisible'].includes(m.name) &&
        !m.name.includes('gizmo') &&
        !m.name.includes('highlight') &&
        m.parent === null
      )
    ]);
  }

  limpiarEstado(): void {
    this.state.nodosEscena().forEach((nodo) => {
      if (nodo instanceof AbstractMesh && nodo.name !== 'sueloInvisible') nodo.dispose(false, true);
    });
    this.state.nodosEscena.set([]);
  }
}