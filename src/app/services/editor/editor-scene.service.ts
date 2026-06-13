
import { Injectable, inject } from '@angular/core';
import {
  MeshBuilder, Vector3, Color4, AbstractMesh, Mesh, Quaternion, SceneLoader,
  StandardMaterial, Color3, TransformNode, Matrix, HemisphericLight, PointLight,
  SpotLight, DirectionalLight, Scene, ShadowGenerator, CascadedShadowGenerator,
  FresnelParameters, VideoTexture
} from '@babylonjs/core';

import '@babylonjs/loaders/glTF';
import { cloneDefaultPlayerConfig, mergePlayerConfig } from './player-config.model';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { HistorialService } from '../historial.service';

@Injectable({ providedIn: 'root' })
export class EditorSceneService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private normalizarSelectionRange(raw: any) {
    return {
      fpsAdminMax: this.normalizarNumero(raw?.fpsAdminMax, 10000),
      fpsUserMax: this.normalizarNumero(raw?.fpsUserMax, 3)
    };
  }

  private extraerSelectionRange(meta: any) {
    const source = meta?.playerConfig?.selectionRange || meta?.selectionRange || null;
    return this.normalizarSelectionRange(source);
  }

  private prepararPlayerConfigConSelectionRange(rawPlayerConfig: any, rawSelectionRange?: any) {
    const cfg = mergePlayerConfig(rawPlayerConfig || null) as any;
    const range = this.normalizarSelectionRange(
      rawSelectionRange || cfg.selectionRange || rawPlayerConfig?.selectionRange || null
    );

    cfg.selectionRange = {
      fpsAdminMax: range.fpsAdminMax,
      fpsUserMax: range.fpsUserMax
    };

    return cfg;
  }

  private ajustarMaterialGLB(material: any): void {
    if (!material) return;
    if (material.getClassName() === 'MultiMaterial' && material.subMaterials) {
      material.subMaterials.forEach((subMat: any) => this.ajustarMaterialGLB(subMat));
      return;
    }
    material.maxSimultaneousLights = 16;
    if (material.getClassName().includes('PBR')) {
      material.usePhysicalLightFalloff = false;
      material.metallic = 0.1;
      material.roughness = 0.8;
      material.environmentIntensity = 0.5;
    }
  }

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
    suelo.receiveShadows = true;
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
    newMesh.parent = oldMesh.parent;
    newMesh.position = oldMesh.position.clone();
    if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
    else newMesh.rotation = oldMesh.rotation.clone();
    newMesh.scaling = oldMesh.scaling.clone();
    newMesh.metadata = JSON.parse(JSON.stringify(oldMesh.metadata));
    newMesh.metadata.triggerShape = nuevaForma;

    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2);
    mat.alpha = 0.3; mat.wireframe = true;
    mat.maxSimultaneousLights = 16;
    newMesh.material = mat;
    newMesh.isPickable = true; newMesh.checkCollisions = false;
    newMesh.isVisible = this.state.rolSimulado() === 'admin';

    if (this.state.objetoSeleccionado() === oldMesh) this.state.objetoSeleccionado.set(newMesh);
    oldMesh.dispose(); this.actualizarListaNodos(); return newMesh;
  }

  agregarTriggerCustom(nombre: string, shape: string, isComposite: boolean, mensaje: string, sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null): void {
    const scene = this.motor3d.scene;
    let mesh!: Mesh;
    switch (shape) {
      case 'sphere': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
      case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
      default: mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
    }
    
    if (parentNode) {
        mesh.parent = parentNode;
        mesh.position = Vector3.Zero();
    } else {
        mesh.position = new Vector3(0, sizeY / 2, 0);
    }
    
    mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);

    const mat = new StandardMaterial('mat_trigger_' + nombre, scene);
    mat.diffuseColor = new Color3(0.2, 1, 0.2); mat.alpha = 0.3; mat.wireframe = true;
    mat.maxSimultaneousLights = 16;
    mesh.material = mat;

    mesh.metadata = {
      type: 'trigger', isComposite: isComposite, triggerShape: shape || 'cube',
      conditions: isComposite ? ['on_enter'] : [], mensajeEntrada: isComposite ? mensaje : '', mensajeSalida: '',
      soundUrlEntrada: '', soundUrlSalida: '', seqEntrada: '', seqSalida: '', timeEntrada: 4.5, timeSalida: 4.5, videoEntrada: '', videoSalida: '',
      condition: 'on_enter', mensaje: isComposite ? '' : mensaje, soundUrl: '', interactSequenceId: '', timeNorm: 4.5, videoNorm: '',
      isRepeatable: false, isEnabled: true, hasTriggeredEnter: false, hasTriggeredExit: false
    };

    mesh.isPickable = true; mesh.checkCollisions = false; mesh.isVisible = this.state.rolSimulado() === 'admin';
    this.state.objetoSeleccionado.set(mesh); this.actualizarListaNodos(); this.historialSvc.registrarAccionCrear(mesh); this.state.triggerUpdate();
  }

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.scene;
    const lights = scene.lights.filter(l => l instanceof DirectionalLight || l instanceof SpotLight);

    lights.forEach(light => {
      let sg: any = light.getShadowGenerator();
      if (!sg) {
        if (light instanceof DirectionalLight) {
          const csg = new CascadedShadowGenerator(2048, light);
          csg.usePercentageCloserFiltering = true;
          csg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
          csg.setDarkness(0.4);
          csg.autoCalcDepthBounds = true; 
          sg = csg;
        } else {
          const regularSg = new ShadowGenerator(1024, light as SpotLight);
          regularSg.usePercentageCloserFiltering = true;
          regularSg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
          regularSg.setDarkness(0.4);
          sg = regularSg;
        }
      }

      const renderList = sg.getShadowMap()?.renderList;
      if (renderList) {
        renderList.length = 0;
        scene.meshes.forEach(m => {
          const isValidShadowCaster = m.isVisible &&
            !m.name.includes('proxyCol') &&
            !m.name.includes('gizmo') &&
            !m.name.includes('highlight') &&
            m.name !== 'centerDragPos' &&
            m.name !== 'debugCollider' &&
            m.name !== 'debugCamBox' &&
            m.name !== 'debugFogSphere' &&
            m.metadata?.type !== 'trigger' &&
            m.metadata?.type !== 'bubble' &&
            m.metadata?.type !== 'video_plane' &&
            !m.metadata?.type?.startsWith('light_');

          if (isValidShadowCaster) {
            sg.addShadowCaster(m, false);
            m.receiveShadows = true;
          }
        });
      }
    });
  }

  agregarObjetoCustom(
    tipo: string, nombre: string, rol: string, colorHex: string,
    sizeX: number, sizeY: number, sizeZ: number, asset?: any,
    isSolid: boolean = true, isSelectable: boolean = true, mensaje: string = '',
    parentNode: AbstractMesh | null = null
  ): void {
    if (tipo === 'trigger' || tipo === 'trigger_compuesto') {
      const isComposite = tipo === 'trigger_compuesto';
      this.agregarTriggerCustom(nombre, 'cube', isComposite, mensaje, sizeX, sizeY, sizeZ, parentNode); return;
    }

    const scene = this.motor3d.scene;
    const isModel = tipo === 'model';
    const isLight = tipo.startsWith('light_');
    const isVideo = tipo === 'video_plane';

    const defaultCollider = isModel
      ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
      : { type: (tipo === 'sphere' || tipo === 'bubble') ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    
    const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
    const defaultPlayerConfig = cloneDefaultPlayerConfig();

    const attachSelectionRange = (cfg: any) => {
      cfg.selectionRange = cfg.selectionRange || { fpsAdminMax: 10000, fpsUserMax: 3 };
      cfg.selectionRange.fpsAdminMax = this.normalizarNumero(cfg.selectionRange.fpsAdminMax, 10000);
      cfg.selectionRange.fpsUserMax = this.normalizarNumero(cfg.selectionRange.fpsUserMax, 3);
      return cfg;
    };

    if (isLight) {
      if (asset) {
        const fullPath = 'http://localhost:4000' + asset.path;
        const lastSlash = fullPath.lastIndexOf('/');
        SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
          const rootNode = result.meshes[0] as Mesh;
          rootNode.name = nombre; rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);
          if (!rootNode.rotationQuaternion) rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rootNode.rotation.x, rootNode.rotation.y, rootNode.rotation.z);
          
          if (parentNode) {
              rootNode.parent = parentNode;
              rootNode.position = Vector3.Zero();
          } else {
              rootNode.position = new Vector3(0, 0, 0); 
          }
          
          rootNode.checkCollisions = false; rootNode.isPickable = true;
          rootNode.applyFog = true;

          result.meshes.forEach(m => {
            if (m !== rootNode) {
              m.isPickable = true;
              m.checkCollisions = isSolid;
              m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
              m.receiveShadows = true;
              m.applyFog = true;
            }
            if (m.material) {
                this.ajustarMaterialGLB(m.material);
            }
          });
          const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

          const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));
          rootNode.metadata = {
            type: tipo, rol: 'light', assetId: asset.id, path: asset.path, isSolid, isSelectable, mensaje,
            ignoraNiebla: false,
            lightColor: colorHex, intensity: 1.0, range: 50, angle: 60, attachedNodePath: '', attachedNodeName: '',
            animationNames: anims.map(a => a.name),
            collider: { ...defaultCollider },
            camOffset: { ...defaultCamOffset },
            playerConfig,
            selectionRange: { ...playerConfig.selectionRange }
          };

          let lightObj: any;
          if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 2.5, 0), scene);
          else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
          else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

          lightObj.parent = rootNode;
          lightObj.intensity = 1.0;
          lightObj.diffuse = Color3.FromHexString(colorHex);
          lightObj.specular = new Color3(0, 0, 0);

          this.asignarObjetosASombrasDeLuces();
          this.state.objetoSeleccionado.set(rootNode);
          this.actualizarListaNodos();
          this.historialSvc.registrarAccionCrear(rootNode);
          this.state.triggerUpdate();
        });
        return;
      } else {
        const mesh = MeshBuilder.CreateSphere(nombre, { diameter: 0.4 }, scene);
        if (parentNode) {
            mesh.parent = parentNode;
            mesh.position = Vector3.Zero();
        } else {
            mesh.position = new Vector3(0, 2, 0);
        }

        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = Color3.FromHexString(colorHex);
        mat.wireframe = true;
        mat.maxSimultaneousLights = 16;
        mesh.material = mat;
        mesh.applyFog = true;

        let lightObj: any;
        if (tipo === 'light_point') lightObj = new PointLight('l_' + nombre, new Vector3(0, 2.5, 0), scene);
        else if (tipo === 'light_spot') lightObj = new SpotLight('l_' + nombre, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
        else if (tipo === 'light_directional') lightObj = new DirectionalLight('l_' + nombre, new Vector3(0, -1, 0), scene);

        lightObj.parent = mesh;
        lightObj.intensity = 1.0;
        lightObj.diffuse = Color3.FromHexString(colorHex);
        lightObj.specular = new Color3(0, 0, 0);

        const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));
        mesh.metadata = {
          type: tipo, rol: 'light', isSolid: false, isSelectable: true,
          ignoraNiebla: false,
          lightColor: colorHex, intensity: 1.0, range: 50, angle: 60,
          attachedNodePath: '', attachedNodeName: '', playerConfig,
          selectionRange: { ...playerConfig.selectionRange }
        };

        mesh.isPickable = true;
        mesh.checkCollisions = false;
        mesh.isVisible = this.state.rolSimulado() === 'admin';

        this.asignarObjetosASombrasDeLuces();
        this.state.objetoSeleccionado.set(mesh);
        this.actualizarListaNodos();
        this.historialSvc.registrarAccionCrear(mesh);
        this.state.triggerUpdate();
        return;
      }
    }

    if (isModel && asset) {
      const fullPath = 'http://localhost:4000' + asset.path; const lastSlash = fullPath.lastIndexOf('/');
      SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
        const rootNode = result.meshes[0] as Mesh;
        rootNode.name = nombre; rootNode.scaling = new Vector3(sizeX, sizeY, sizeZ);
        if (!rootNode.rotationQuaternion) rootNode.rotationQuaternion = Quaternion.FromEulerAngles(rootNode.rotation.x, rootNode.rotation.y, rootNode.rotation.z);
        
        if (parentNode) {
            rootNode.parent = parentNode;
            rootNode.position = Vector3.Zero();
        } else {
            rootNode.position = new Vector3(0, 0, 0); 
        }
        
        rootNode.checkCollisions = false; rootNode.isPickable = true;
        rootNode.applyFog = true;

        result.meshes.forEach(m => {
          if (m !== rootNode) {
            m.isPickable = true;
            m.checkCollisions = isSolid;
            m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
            m.receiveShadows = true;
            m.applyFog = true;
          }
          if (m.material) {
              this.ajustarMaterialGLB(m.material);
          }
        });
        const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

        let initialHeadLocal: Vector3 | null = null;
        const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
        if (headNode) {
          headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
          initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
        }

        const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));
        rootNode.metadata = {
          type: 'model',
          rol,
          assetId: asset.id,
          path: asset.path,
          isSolid,
          isSelectable,
          mensaje,
          ignoraNiebla: false,
          interactDistanceFPS: 3.0,
          interactDistanceTPS: 5.0,
          interactSequenceIdFPS: '',
          interactSequenceIdTPS: '',
          animationNames: anims.map(a => a.name),
          collider: { ...defaultCollider },
          camOffset: { ...defaultCamOffset },
          playerConfig,
          selectionRange: { ...playerConfig.selectionRange },
          initialHeadLocal
        };

        rootNode.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
        rootNode.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

        this.asignarObjetosASombrasDeLuces();
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
        case 'bubble': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
        case 'video_plane': mesh = MeshBuilder.CreatePlane(nombre, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break; 
        default: return;
      }
      
      mesh.scaling = new Vector3(sizeX, sizeY, sizeZ); 
      if (parentNode) {
          mesh.parent = parentNode;
          mesh.position = Vector3.Zero();
      } else {
          mesh.position = new Vector3(0, 0.5 * sizeY, 0);
      }

      const playerConfig = attachSelectionRange(mergePlayerConfig(defaultPlayerConfig));
      
      mesh.metadata = {
        type: tipo, rol, color: colorHex, colorBW: colorHex, isSolid, isSelectable, mensaje,
        ignoraNiebla: false,
        respawnTime: 8,
        interactDistanceFPS: 3.0,
        interactDistanceTPS: 5.0,
        interactSequenceIdFPS: '',
        interactSequenceIdTPS: '',
        collider: { ...defaultCollider },
        camOffset: { ...defaultCamOffset },
        playerConfig,
        selectionRange: { ...playerConfig.selectionRange }
      };

      if (isVideo && asset) {
         mesh.metadata.assetId = asset.id;
         mesh.metadata.videoUrl = asset.path; 
      }

      mesh.isPickable = true; mesh.checkCollisions = isSolid;
      mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
      mesh.applyFog = true;
      
      if (tipo !== 'bubble' && tipo !== 'video_plane') {
        mesh.receiveShadows = true;
      }

      mesh.ellipsoid = new Vector3(defaultCollider.sizeX * sizeX, defaultCollider.sizeY * sizeY, defaultCollider.sizeZ * sizeZ);
      mesh.ellipsoidOffset = new Vector3(defaultCollider.offsetX * sizeX, defaultCollider.offsetY * sizeY, defaultCollider.offsetZ * sizeZ);

      if (tipo === 'bubble') {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = new Color3(0.9, 0.95, 1.0); 
        mat.diffuseColor = new Color3(0, 0, 0); 
        mat.alpha = 0.6; 
        mat.disableLighting = true; 
        
        mat.opacityFresnelParameters = new FresnelParameters();
        mat.opacityFresnelParameters.leftColor = Color3.White(); 
        mat.opacityFresnelParameters.rightColor = Color3.Black(); 
        mat.opacityFresnelParameters.bias = 0.2;
        mat.opacityFresnelParameters.power = 1.5;

        mesh.material = mat;
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL; 
      } else if (tipo === 'video_plane') {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        mat.emissiveColor = new Color3(0, 0, 0); 
        mat.disableLighting = true; 
        
        if (asset && asset.path) {
            const videoUrl = 'http://localhost:4000' + asset.path;
            const videoTexture = new VideoTexture("vidTex_" + nombre, videoUrl, scene, true, true);
            videoTexture.video.pause(); 
            mat.diffuseTexture = videoTexture;
        } else {
            mat.diffuseColor = new Color3(0.1, 0.1, 0.1); 
        }
        mesh.material = mat;
      } else {
        const mat = new StandardMaterial('mat_' + nombre, scene);
        const isBW = scene.metadata?.globalVisualMode === 'bw';
        mat.diffuseColor = Color3.FromHexString(isBW ? mesh.metadata.colorBW : colorHex);
        mat.specularColor = new Color3(0, 0, 0);
        if (rol === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
        mat.maxSimultaneousLights = 16;
        mesh.material = mat;
      }

      this.asignarObjetosASombrasDeLuces();

      this.state.objetoSeleccionado.set(mesh);
      this.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(mesh);
      this.state.triggerUpdate();
    }
  }

  private configurarAmbienteGlobal(scene: Scene, props: any): void {
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

  cargarEscenaDesdeDatos(dataBD: any): Promise<void> {
    return new Promise((resolve) => {
      if (!dataBD) {
        resolve();
        return;
      }
      
      const scene = this.motor3d.scene;

      let w: any = null;
      if (dataBD.worldSettings) {
        if (typeof dataBD.worldSettings === 'string') {
          try {
            w = JSON.parse(dataBD.worldSettings);
          } catch (e) {
            console.error("Error al parsear worldSettings desde BD", e);
          }
        } else {
          w = dataBD.worldSettings;
        }
      }

      if (w) {
        const clearHex = w.clearColor?.length >= 7 ? w.clearColor.substring(0, 7) : '#0d1729';
        const clearHexBW = w.clearColorBW?.length >= 7 ? w.clearColorBW.substring(0, 7) : '#555555';

        this.configurarAmbienteGlobal(scene, w);
        const loadedMode = w.visualMode === 'bw' ? 'bw' : 'normal';
        const activeClear = loadedMode === 'bw' ? clearHexBW : clearHex;
        scene.clearColor = Color4.FromHexString(activeClear + 'ff');
        
        scene.metadata = { 
            ...scene.metadata, 
            globalClearColor: clearHex, 
            globalClearColorBW: clearHexBW,
            globalVisualMode: loadedMode 
        };
        this.motor3d.setVisualMode(loadedMode);
        
        scene.gravity = new Vector3(0, w.gravityY ?? -0.25, 0);
      } else {
        const clearHex = '#0d1729';
        const clearHexBW = '#555555';
        this.configurarAmbienteGlobal(scene, {
          ambientIntensity: 0.6, ambientDiffuse: '#ffffff', ambientGround: '#333333',
          ambientDirX: 0, ambientDirY: 1, ambientDirZ: 0
        });
        scene.clearColor = Color4.FromHexString(clearHex + 'ff');
        
        scene.metadata = { 
            ...scene.metadata, 
            globalClearColor: clearHex, 
            globalClearColorBW: clearHexBW,
            globalVisualMode: 'normal' 
        };
        this.motor3d.setVisualMode('normal');
      }

      scene.fogMode = Scene.FOGMODE_NONE;
      scene.cameras.forEach(cam => cam.maxZ = 10000);

      const objetosBD = Array.isArray(dataBD) ? dataBD : (dataBD.sceneObjects || []);
      const triggersBD = Array.isArray(dataBD) ? [] : (dataBD.triggers || []);
      const isAdmin = this.state.rolSimulado() === 'admin';

      const promesasCarga: any[] = [];

      objetosBD.forEach((obj: any) => {
        const isModel = obj.type === 'model';
        const isLight = obj.type?.startsWith('light_');
        const isVideo = obj.type === 'video_plane';

        const defaultCollider = isModel
          ? { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
          : { type: obj.type === 'sphere' || obj.type === 'bubble' ? 'sphere' : 'box', sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
        const defaultCamOffset = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.8, z: 0 };
        const defaultPlayerConfig = cloneDefaultPlayerConfig();

        const rolSaved = obj.properties?.rol || 'prop';
        const isSolidSaved = obj.properties?.isSolid ?? true;
        const isSelectableSaved = obj.properties?.isSelectable ?? true;
        const mensajeSaved = obj.properties?.mensaje || '';
        const isIgnoraNieblaSaved = obj.properties?.ignoraNiebla ?? false; // 🔥 Leemos de la BD

        const savedSelectionRange = this.extraerSelectionRange(obj.properties || obj);

        if (isLight) {
          const lightColorHex = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';

          if (obj.assetId) {
            const path = obj.properties?.path || obj.asset?.path;
            if (!path) return;
            const fullPath = 'http://localhost:4000' + path;
            const lastSlash = fullPath.lastIndexOf('/');
            const p = SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
              const rootNode = result.meshes[0] as Mesh;
              rootNode.name = obj.name; rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
              rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
              rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
              rootNode.checkCollisions = false; rootNode.isPickable = true;
              rootNode.applyFog = !isIgnoraNieblaSaved;

              result.meshes.forEach(m => {
                if (m !== rootNode) {
                  m.isPickable = true;
                  m.checkCollisions = isSolidSaved;
                  m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
                  m.receiveShadows = true;
                  m.applyFog = !isIgnoraNieblaSaved;
                }
                if (m.material) {
                    this.ajustarMaterialGLB(m.material);
                }
              });
              const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

              let initialHeadLocal: Vector3 | null = null;
              const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
              if (headNode) {
                headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
                initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
              }

              const playerConfig = this.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

              rootNode.metadata = {
                type: obj.type, rol: 'light', assetId: obj.assetId, path, isSolid: isSolidSaved, isSelectable: isSelectableSaved,
                ignoraNiebla: isIgnoraNieblaSaved,
                lightColor: lightColorHex, intensity: obj.properties?.intensity ?? 1.0, range: obj.properties?.range ?? 50, angle: obj.properties?.angle ?? 60,
                attachedNodePath: obj.properties?.attachedNodePath || '', attachedNodeName: obj.properties?.attachedNodeName || '',
                animationNames: anims.map(a => a.name),
                collider: obj.properties?.collider || defaultCollider,
                camOffset: obj.properties?.camOffset || defaultCamOffset,
                playerConfig,
                selectionRange: { ...playerConfig.selectionRange },
                initialHeadLocal
              };

              let lightObj: any;
              if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
              else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), (obj.properties?.angle ?? 60) * (Math.PI / 180), 2, scene);
              else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

              let targetParent: TransformNode | AbstractMesh = rootNode;
              if (obj.properties?.attachedNodeName) {
                const allDescendants = rootNode.getDescendants(false);
                const foundNode = allDescendants.find((n: any) => n.name === obj.properties.attachedNodeName) as TransformNode | AbstractMesh;
                if (foundNode) targetParent = foundNode;
              }

              lightObj.parent = targetParent;
              lightObj.intensity = obj.properties?.intensity ?? 1.0;
              lightObj.diffuse = Color3.FromHexString(lightColorHex);
              lightObj.specular = new Color3(0, 0, 0);
              if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;
            });
            promesasCarga.push(p);
            return;
          } else {
            const mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 0.4 }, scene);
            mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
            mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);

            const mat = new StandardMaterial('mat_' + obj.name, scene);
            mat.emissiveColor = Color3.FromHexString(lightColorHex);
            mat.wireframe = true;
            mat.maxSimultaneousLights = 16;
            mesh.material = mat;
            mesh.applyFog = !isIgnoraNieblaSaved;

            let lightObj: any;
            if (obj.type === 'light_point') lightObj = new PointLight('l_' + obj.name, new Vector3(0, 2.5, 0), scene);
            else if (obj.type === 'light_spot') lightObj = new SpotLight('l_' + obj.name, new Vector3(0, 2.5, 0), new Vector3(0, -1, 0), (obj.properties?.angle ?? 60) * (Math.PI / 180), 2, scene);
            else if (obj.type === 'light_directional') lightObj = new DirectionalLight('l_' + obj.name, new Vector3(0, -1, 0), scene);

            lightObj.parent = mesh;
            lightObj.intensity = obj.properties?.intensity ?? 1.0;
            lightObj.diffuse = Color3.FromHexString(lightColorHex);
            lightObj.specular = new Color3(0, 0, 0);
            if (lightObj.range !== undefined) lightObj.range = obj.properties?.range ?? 50;

            const playerConfig = this.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

            mesh.metadata = {
              type: obj.type, rol: 'light', isSolid: false, isSelectable: true,
              ignoraNiebla: isIgnoraNieblaSaved,
              lightColor: lightColorHex, intensity: obj.properties?.intensity ?? 1.0, range: obj.properties?.range ?? 50, angle: obj.properties?.angle ?? 60,
              attachedNodePath: '', attachedNodeName: '', playerConfig,
              selectionRange: { ...playerConfig.selectionRange }
            };

            mesh.isPickable = true;
            mesh.checkCollisions = false;
            mesh.isVisible = isAdmin;
            return;
          }
        }

        const interactDistanceFPS = this.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
        const interactDistanceTPS = this.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
        const interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
        const interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';

        const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
        if (savedCollider.radiusX !== undefined) {
          savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
          savedCollider.type = isModel ? 'capsule' : 'box';
        }
        if (!savedCollider.type) savedCollider.type = isModel ? 'capsule' : 'box';

        const savedCamOffset = obj.properties?.camOffset || { ...defaultCamOffset };
        const savedPlayerConfig = this.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);

        if (isModel && obj.assetId) {
          const path = obj.properties?.path || obj.asset?.path;
          if (!path) return;
          const fullPath = 'http://localhost:4000' + path;
          const lastSlash = fullPath.lastIndexOf('/');

          const p = SceneLoader.ImportMeshAsync('', fullPath.substring(0, lastSlash + 1), fullPath.substring(lastSlash + 1), scene).then((result) => {
            const rootNode = result.meshes[0] as Mesh;
            rootNode.name = obj.name; rootNode.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
            rootNode.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
            rootNode.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            rootNode.checkCollisions = false; rootNode.isPickable = true;
            rootNode.applyFog = !isIgnoraNieblaSaved;

            result.meshes.forEach(m => {
              if (m !== rootNode) {
                m.isPickable = true;
                m.checkCollisions = isSolidSaved;
                m.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
                m.receiveShadows = true;
                m.applyFog = !isIgnoraNieblaSaved;
              }
              if (m.material) {
                  this.ajustarMaterialGLB(m.material);
              }
            });
            const anims = result.animationGroups || []; anims.forEach(ag => ag.stop());

            let initialHeadLocal: Vector3 | null = null;
            const headNode = rootNode.getChildTransformNodes(false).find(n => n.name.toLowerCase() === 'head' || n.name.toLowerCase() === 'neck' || n.name.toLowerCase().includes('head')) as TransformNode;
            if (headNode) {
              headNode.computeWorldMatrix(true); rootNode.computeWorldMatrix(true);
              initialHeadLocal = Vector3.TransformCoordinates(headNode.getAbsolutePosition(), Matrix.Invert(rootNode.getWorldMatrix()));
            }

            rootNode.metadata = {
              type: 'model', rol: rolSaved, assetId: obj.assetId, path, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
              ignoraNiebla: isIgnoraNieblaSaved,
              interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
              animationNames: anims.map(a => a.name),
              collider: savedCollider,
              camOffset: savedCamOffset,
              playerConfig: savedPlayerConfig,
              selectionRange: { ...savedPlayerConfig.selectionRange },
              initialHeadLocal
            };
            rootNode.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
            rootNode.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);
          });
          promesasCarga.push(p);
        } else {
          let mesh!: Mesh;
          switch (obj.type) {
            case 'cube': mesh = MeshBuilder.CreateBox(obj.name, { size: 1 }, scene); break;
            case 'sphere': mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene); break;
            case 'cylinder': mesh = MeshBuilder.CreateCylinder(obj.name, { height: 1, diameter: 1 }, scene); break;
            case 'plane': mesh = MeshBuilder.CreateGround(obj.name, { width: 1, height: 1 }, scene); break;
            case 'bubble': mesh = MeshBuilder.CreateSphere(obj.name, { diameter: 1 }, scene); break;
            case 'video_plane': mesh = MeshBuilder.CreatePlane(obj.name, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene); break;
            default: return;
          }

          mesh.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
          mesh.rotationQuaternion = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          mesh.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);

          const savedColorHex = obj.properties?.color?.substring(0, 7) || '#888888';
          const savedColorBW = obj.properties?.colorBW?.substring(0, 7) || savedColorHex;

          mesh.metadata = {
            type: obj.type, rol: rolSaved, color: savedColorHex, colorBW: savedColorBW, isSolid: isSolidSaved, isSelectable: isSelectableSaved, mensaje: mensajeSaved,
            ignoraNiebla: isIgnoraNieblaSaved,
            respawnTime: obj.properties?.respawnTime ?? 8, 
            interactDistanceFPS, interactDistanceTPS, interactSequenceIdFPS, interactSequenceIdTPS,
            collider: savedCollider,
            camOffset: savedCamOffset,
            playerConfig: savedPlayerConfig,
            selectionRange: { ...savedPlayerConfig.selectionRange }
          };

          if (isVideo) {
             mesh.metadata.assetId = obj.assetId;
             mesh.metadata.videoUrl = obj.properties?.videoUrl || obj.properties?.path || '';
          }

          mesh.isPickable = true; mesh.checkCollisions = isSolidSaved;
          mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
          mesh.applyFog = !isIgnoraNieblaSaved;
          
          if (obj.type !== 'bubble' && obj.type !== 'video_plane') {
            mesh.receiveShadows = true;
          }

          mesh.ellipsoid = new Vector3(savedCollider.sizeX * obj.scale.x, savedCollider.sizeY * obj.scale.y, savedCollider.sizeZ * obj.scale.z);
          mesh.ellipsoidOffset = new Vector3(savedCollider.offsetX * obj.scale.x, savedCollider.offsetY * obj.scale.y, savedCollider.offsetZ * obj.scale.z);

          if (obj.type === 'bubble') {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              mat.emissiveColor = new Color3(0.9, 0.95, 1.0);
              mat.diffuseColor = new Color3(0, 0, 0);
              mat.alpha = 0.6;
              mat.disableLighting = true;
              
              mat.opacityFresnelParameters = new FresnelParameters();
              mat.opacityFresnelParameters.leftColor = Color3.White();
              mat.opacityFresnelParameters.rightColor = Color3.Black();
              mat.opacityFresnelParameters.bias = 0.2;
              mat.opacityFresnelParameters.power = 1.5;

              mesh.material = mat;
              mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
          } else if (obj.type === 'video_plane') {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              mat.emissiveColor = new Color3(0, 0, 0); // 🔥 FIX: Inicia apagado al cargar
              mat.disableLighting = true;
              
              if (mesh.metadata.videoUrl) {
                  const videoUrl = 'http://localhost:4000' + mesh.metadata.videoUrl;
                  const videoTexture = new VideoTexture("vidTex_" + obj.name, videoUrl, scene, true, true);
                  videoTexture.video.pause();
                  mat.diffuseTexture = videoTexture;
              } else {
                  mat.diffuseColor = new Color3(0.1, 0.1, 0.1); 
              }
              mesh.material = mat;
          } else {
              const mat = new StandardMaterial('mat_' + obj.name, scene);
              const isBW = scene.metadata?.globalVisualMode === 'bw';
              mat.diffuseColor = Color3.FromHexString(isBW ? savedColorBW : savedColorHex);
              mat.specularColor = new Color3(0, 0, 0);
              if (rolSaved === 'spawn_point') { mat.alpha = 0.5; mat.emissiveColor = new Color3(0, 1, 0); }
              mat.maxSimultaneousLights = 16;
              mesh.material = mat;
          }

          this.asignarObjetosASombrasDeLuces();
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
          mat.alpha = 0.3; mat.wireframe = true;
          mat.maxSimultaneousLights = 16;
          mesh.material = mat;
          mesh.isPickable = true; mesh.checkCollisions = false;
          mesh.isVisible = isAdmin;

          mesh.metadata = {
            type: 'trigger', triggerShape: shape, isComposite: isComposite,
            conditions: [], mensajeEntrada: '', mensajeSalida: '', soundUrlEntrada: '', soundUrlSalida: '', seqEntrada: '', seqSalida: '', timeEntrada: 4.5, timeSalida: 4.5, videoEntrada: '', videoSalida: '',
            condition: 'on_enter', mensaje: '', soundUrl: '', interactSequenceId: '', timeNorm: 4.5, videoNorm: '',
            isRepeatable: trigger.isRepeatable, isEnabled: trigger.isEnabled, hasTriggeredEnter: false, hasTriggeredExit: false
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

      Promise.all(promesasCarga).then(() => {
        this.asignarObjetosASombrasDeLuces();
        this.actualizarListaNodos();
        resolve(); 
      });
    });
  }

  obtenerDatosParaGuardar(): { sceneObjects: any[], triggers: any[], worldSettings: any } {
    const sceneObjects: any[] = [];
    const triggers: any[] = [];

    const scene = this.motor3d.scene;
    const ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;

    const worldSettings = {
      visualMode: scene.metadata?.globalVisualMode || 'normal',
      clearColor: scene.metadata?.globalClearColor || '#0d1729',
      clearColorBW: scene.metadata?.globalClearColorBW || '#555555',
      gravityY: scene.gravity.y,
      ambientIntensity: ambient ? ambient.intensity : 0.6,
      ambientDiffuse: ambient ? ambient.diffuse.toHexString().substring(0, 7) : '#ffffff',
      ambientGround: ambient ? ambient.groundColor.toHexString().substring(0, 7) : '#333333',
      ambientDirX: ambient ? ambient.direction.x : 0,
      ambientDirY: ambient ? ambient.direction.y : 1,
      ambientDirZ: ambient ? ambient.direction.z : 0
    };

    this.state.nodosEscena().forEach(nodo => {
      if (nodo instanceof AbstractMesh && nodo.metadata?.type) {
        const rot = nodo.rotationQuaternion ? nodo.rotationQuaternion.toEulerAngles() : nodo.rotation;
        const selectionRange = this.normalizarSelectionRange(
          nodo.metadata?.playerConfig?.selectionRange || nodo.metadata?.selectionRange || null
        );

        if (nodo.metadata.type === 'trigger') {
          if (nodo.metadata.isComposite) {
            const conditions = nodo.metadata.conditions || [];
            conditions.forEach((cond: string) => {
              let actionProps: any = { triggerShape: nodo.metadata.triggerShape, isComposite: true };
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
                properties: { condition: cond, actionType: 'show_message', targetObjectName: '', isRepeatable: nodo.metadata.isRepeatable, isEnabled: nodo.metadata.isEnabled, ...actionProps }
              });
            });
          } else {
            triggers.push({
              name: nodo.name,
              position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
              scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z },
              properties: {
                condition: nodo.metadata.condition, actionType: 'show_message', targetObjectName: '', isRepeatable: nodo.metadata.isRepeatable, isEnabled: nodo.metadata.isEnabled,
                triggerShape: nodo.metadata.triggerShape, mensaje: nodo.metadata.mensaje, soundUrl: nodo.metadata.soundUrl, interactSequenceId: nodo.metadata.interactSequenceId,
                timeNorm: nodo.metadata.timeNorm ?? 4.5, videoNorm: nodo.metadata.videoNorm || '', isComposite: false
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
          ignoraNiebla: nodo.metadata.ignoraNiebla ?? false,
          mensaje: nodo.metadata.mensaje,
          respawnTime: nodo.metadata.respawnTime ?? 8, 
          interactDistanceFPS: nodo.metadata.interactDistanceFPS ?? 3.0,
          interactDistanceTPS: nodo.metadata.interactDistanceTPS ?? 5.0,
          interactSequenceIdFPS: nodo.metadata.interactSequenceIdFPS || '',
          interactSequenceIdTPS: nodo.metadata.interactSequenceIdTPS || '',
          collider: nodo.metadata.collider,
          camOffset: nodo.metadata.camOffset,
          playerConfig: nodo.metadata.playerConfig || null,
          selectionRange,
          animationNames: nodo.metadata.animationNames || [],
          colorBW: nodo.metadata.colorBW
        };

        if (nodo.metadata.type === 'model') {
          sceneObjects.push({ ...baseData, type: 'model', assetId: nodo.metadata.assetId, properties: { path: nodo.metadata.path, ...propertiesToSave } });
        } else if (nodo.metadata.type?.startsWith('light_')) {
          sceneObjects.push({
            ...baseData, type: nodo.metadata.type,
            properties: {
              lightColor: nodo.metadata.lightColor,
              intensity: nodo.metadata.intensity,
              range: nodo.metadata.range,
              angle: nodo.metadata.angle,
              path: nodo.metadata.path,
              attachedNodePath: nodo.metadata.attachedNodePath || '',
              attachedNodeName: nodo.metadata.attachedNodeName || '',
              ...propertiesToSave
            },
            assetId: nodo.metadata.assetId
          });
        } else if (nodo.metadata.type === 'video_plane') {
           sceneObjects.push({
             ...baseData, type: 'video_plane', assetId: nodo.metadata.assetId,
             properties: { videoUrl: nodo.metadata.videoUrl, path: nodo.metadata.videoUrl, ...propertiesToSave }
           });
        } else {
          sceneObjects.push({ ...baseData, type: nodo.metadata.type, properties: { color: nodo.metadata.color, ...propertiesToSave } });
        }
      }
    });

    return { sceneObjects, triggers, worldSettings };
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

    const lucesValidas = scene.lights.filter(l => !l.parent && l.name !== 'ambientLight');

    this.state.nodosEscena.set([
      ...scene.cameras,
      ...lucesValidas,
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