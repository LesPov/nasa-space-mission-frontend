import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, Quaternion } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { GameEntity, PartOverridesComponent } from '../../../../core/engine/entities/game.entity';
import { CoreSceneMaterialService } from '../../../../core/engine/scene/utils/core-scene-material.service';
import { EpisodiosService } from '../../../../services/api/episodios';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';

@Component({
  selector: 'app-prop-part',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-part.html',
  styleUrls: ['../inspector-properties.css', './prop-part.css']
})
export class PropPart implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;
  @Input() entity!: GameEntity;

  private editorSvc = inject(EditorMapaService);
  private materialSvc = inject(CoreSceneMaterialService);
  private apiSvc = inject(EpisodiosService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  objColor = '#ffffff';
  objColorBW = '#ffffff';
  objEsEmisivo = false;
  objBrilloIntensidad = 1.0;
  objTexturePath = '';
  
  listaAssets: any[] = [];

  ngOnInit() {
    this.cargarAssets();
    this.syncData();
    this.subs.push(
      this.editorSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) this.syncData();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  cargarAssets() {
    this.apiSvc.obtenerAssets().subscribe({
      next: (res) => {
        this.listaAssets = res.filter((a:any) => 
          a.type === 'texture_png' || a.type === 'texture_jpg' || 
          a.path.endsWith('.png') || a.path.endsWith('.jpg') || a.path.endsWith('.jpeg')
        );
        this.cdr.detectChanges();
      }
    });
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(4));
  }

  syncData() {
    if (!this.objeto || !this.entity) return;

    this.localPosX = this.formatNum(this.objeto.position.x);
    this.localPosY = this.formatNum(this.objeto.position.y);
    this.localPosZ = this.formatNum(this.objeto.position.z);

    if (this.objeto.rotationQuaternion) {
        const euler = this.objeto.rotationQuaternion.toEulerAngles();
        this.localRotX = this.formatNum(euler.x * (180 / Math.PI));
        this.localRotY = this.formatNum(euler.y * (180 / Math.PI));
        this.localRotZ = this.formatNum(euler.z * (180 / Math.PI));
    } else {
        this.localRotX = this.formatNum(this.objeto.rotation.x * (180 / Math.PI));
        this.localRotY = this.formatNum(this.objeto.rotation.y * (180 / Math.PI));
        this.localRotZ = this.formatNum(this.objeto.rotation.z * (180 / Math.PI));
    }

    this.localEscX = this.formatNum(this.objeto.scaling.x);
    this.localEscY = this.formatNum(this.objeto.scaling.y);
    this.localEscZ = this.formatNum(this.objeto.scaling.z);

    const override = this.entity.partOverrides?.overrides[this.objeto.name];
    if (override) {
        this.objColor = override.color || '#ffffff';
        this.objColorBW = override.colorBW || '#ffffff';
        this.objEsEmisivo = override.esEmisivo ?? false;
        this.objBrilloIntensidad = override.brilloIntensidad ?? 1.0;
        this.objTexturePath = override.texturePath || '';
    } else {
        this.objColor = '#ffffff';
        this.objColorBW = '#ffffff';
        this.objEsEmisivo = false;
        this.objBrilloIntensidad = 1.0;
        this.objTexturePath = '';
    }

    this.cdr.detectChanges();
  }

  // 🔥 FIX: Inicialización segura de TypeScript
  private initOverride() {
      let comp = this.entity.partOverrides;
      if (!comp) {
          comp = new PartOverridesComponent();
          this.entity.partOverrides = comp;
      }
      if (!comp.overrides[this.objeto.name]) {
          comp.overrides[this.objeto.name] = {};
      }
      return comp.overrides[this.objeto.name];
  }

  aplicarTransformacion() {
    const rx = this.localRotX * (Math.PI / 180);
    const ry = this.localRotY * (Math.PI / 180);
    const rz = this.localRotZ * (Math.PI / 180);

    this.objeto.position.set(this.localPosX, this.localPosY, this.localPosZ);
    if (this.objeto.rotationQuaternion) {
        this.objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
    } else {
        this.objeto.rotation.set(rx, ry, rz);
    }
    this.objeto.scaling.set(this.localEscX, this.localEscY, this.localEscZ);

    const override = this.initOverride();
    override.position = { x: this.localPosX, y: this.localPosY, z: this.localPosZ };
    override.rotation = { x: rx, y: ry, z: rz };
    override.scale = { x: this.localEscX, y: this.localEscY, z: this.localEscZ };

    this.entity.isDirty = true;
    this.editorSvc.onMapChanged.next();
  }

  async aplicarMaterial() {
    const override = this.initOverride();
    override.color = this.objColor;
    override.colorBW = this.objColorBW;
    override.esEmisivo = this.objEsEmisivo;
    override.brilloIntensidad = this.objBrilloIntensidad;
    override.texturePath = this.objTexturePath;

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const scene = this.objeto.getScene();

    if (this.objeto.material) {
        this.materialSvc.asegurarMaterialUnico(this.objeto, this.entity.uid);
        const activeColor = isBW ? (override.colorBW || override.color) : override.color;
        
        await this.materialSvc.ajustarMaterialGLB(
            this.objeto.material, isBW, scene, 
            isBW ? this.entity.visual.ambientColorBW : this.entity.visual.ambientColor, 
            activeColor, override.esEmisivo, override.brilloIntensidad, override.texturePath
        );
    }

    this.entity.isDirty = true;
    this.editorSvc.onMapChanged.next();
  }

  restaurarTransformacion() {
      if (this.entity.partOverrides?.overrides[this.objeto.name]) {
          delete this.entity.partOverrides.overrides[this.objeto.name].position;
          delete this.entity.partOverrides.overrides[this.objeto.name].rotation;
          delete this.entity.partOverrides.overrides[this.objeto.name].scale;
      }
      
      const orig = this.objeto.metadata?.originalTransform;
      if (orig) {
          this.objeto.position.copyFrom(orig.position);
          this.objeto.scaling.copyFrom(orig.scaling);
          if (orig.rotationQuaternion) {
              this.objeto.rotationQuaternion = orig.rotationQuaternion.clone();
              this.objeto.rotation.set(0, 0, 0);
          } else {
              this.objeto.rotation.copyFrom(orig.rotation);
          }
      }
      this.entity.isDirty = true;
      this.editorSvc.onMapChanged.next();
  }

  async restaurarMaterial() {
      if (this.entity.partOverrides?.overrides[this.objeto.name]) {
          delete this.entity.partOverrides.overrides[this.objeto.name].color;
          delete this.entity.partOverrides.overrides[this.objeto.name].colorBW;
          delete this.entity.partOverrides.overrides[this.objeto.name].esEmisivo;
          delete this.entity.partOverrides.overrides[this.objeto.name].brilloIntensidad;
          delete this.entity.partOverrides.overrides[this.objeto.name].texturePath;
      }
      
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const scene = this.objeto.getScene();

      if (this.objeto.material) {
          this.materialSvc.asegurarMaterialUnico(this.objeto, this.entity.uid);
          const activeColor = isBW ? this.entity.visual.colorBW : this.entity.visual.color;
          await this.materialSvc.ajustarMaterialGLB(
              this.objeto.material, isBW, scene, 
              isBW ? this.entity.visual.ambientColorBW : this.entity.visual.ambientColor, 
              activeColor, this.entity.visual.esEmisivo, this.entity.visual.brilloIntensidad
          );
      }

      this.entity.isDirty = true;
      this.editorSvc.onMapChanged.next();
  }
}