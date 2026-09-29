import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { CoreSceneMaterialService } from '../../../../core/engine/scene/utils/core-scene-material.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';
import { GameEntity, PartOverridesComponent, PartOverride } from '../../../../core/engine/entities/game.entity';
import { EpisodiosService } from '../../../../services/api/episodios';

@Component({
  selector: 'app-prop-part',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-part.html',
  styleUrls: ['./prop-part.css']
})
export class PropPart implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;
  @Input() entity!: GameEntity; 

  private mapaSvc = inject(EditorMapaService);
  private materialSvc = inject(CoreSceneMaterialService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private epiApiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);
  
  private subs: Subscription[] = [];

  public accordions: Record<string, boolean> = {
    transform: true,
    visuals: true,
    texture: true
  };

  localPosX = 0; localPosY = 0; localPosZ = 0;
  localRotX = 0; localRotY = 0; localRotZ = 0;
  localEscX = 1; localEscY = 1; localEscZ = 1;

  objColor = '#ffffff';
  objColorBW = '#ffffff';
  objEsEmisivo = false;
  objBrilloIntensidad = 1.0;

  textureSource: 'original' | 'solid' | 'asset' = 'original';
  texturePath = '';
  objAssetSeleccionado: any = null;

  listaAssets: any[] = [];

  ngOnInit() {
    this.cargarAssets();
    this.syncData();
    this.subs.push(
      this.mapaSvc.onGizmoDrag.subscribe(() => this.syncData()),
      this.mapaSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto'] || changes['entity']) {
      this.syncData();
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  toggleAcordeon(key: string) {
    this.accordions[key] = !this.accordions[key];
  }

  private formatNum(val: number): number {
    return parseFloat(Number(val || 0).toFixed(4));
  }

  cargarAssets() {
    this.epiApiSvc.obtenerAssets().subscribe({
      next: (res) => {
        this.listaAssets = res.filter((a:any) => 
          a.type === 'texture_png' || a.type === 'texture_jpg' || 
          a.path.endsWith('.png') || a.path.endsWith('.jpg') || a.path.endsWith('.jpeg')
        );
        this.asignarAssetDesdeRuta();
      },
      error: (err) => console.error('[PropPart] Error al cargar assets', err)
    });
  }

  private asignarAssetDesdeRuta() {
    if (this.texturePath && this.listaAssets.length > 0) {
        this.objAssetSeleccionado = this.listaAssets.find(a => a.path === this.texturePath) || null;
    } else {
        this.objAssetSeleccionado = null;
    }
    this.cdr.detectChanges();
  }

  syncData() {
    if (!this.objeto || !this.entity) return;

    this.localPosX = this.formatNum(this.objeto.position.x);
    this.localPosY = this.formatNum(this.objeto.position.y);
    this.localPosZ = this.formatNum(this.objeto.position.z);

    if (this.objeto.rotationQuaternion) {
        const euler = this.objeto.rotationQuaternion.toEulerAngles();
        this.localRotX = this.formatNum(euler.x * 180 / Math.PI);
        this.localRotY = this.formatNum(euler.y * 180 / Math.PI);
        this.localRotZ = this.formatNum(euler.z * 180 / Math.PI);
    } else {
        this.localRotX = this.formatNum(this.objeto.rotation.x * 180 / Math.PI);
        this.localRotY = this.formatNum(this.objeto.rotation.y * 180 / Math.PI);
        this.localRotZ = this.formatNum(this.objeto.rotation.z * 180 / Math.PI);
    }

    this.localEscX = this.formatNum(this.objeto.scaling.x);
    this.localEscY = this.formatNum(this.objeto.scaling.y);
    this.localEscZ = this.formatNum(this.objeto.scaling.z);

    const override = this.entity.partOverrides?.overrides[this.objeto.name];
    
    this.objColor = override?.color || '#ffffff';
    this.objColorBW = override?.colorBW || '#ffffff';
    this.objEsEmisivo = override?.esEmisivo ?? this.entity.visual.esEmisivo;
    this.objBrilloIntensidad = override?.brilloIntensidad ?? this.entity.visual.brilloIntensidad;

    this.textureSource = override?.textureSource || (override?.texturePath ? 'asset' : 'original');
    this.texturePath = override?.texturePath || '';
    
    this.asignarAssetDesdeRuta();
  }

  private getOrCreateOverride(): PartOverride {
      if (!this.entity.partOverrides) {
          this.entity.partOverrides = new PartOverridesComponent({});
      }
      if (!this.entity.partOverrides.overrides[this.objeto.name]) {
          this.entity.partOverrides.overrides[this.objeto.name] = {};
      }
      return this.entity.partOverrides.overrides[this.objeto.name];
  }

  aplicarPosicion() {
      const override = this.getOrCreateOverride();
      override.position = { x: this.localPosX, y: this.localPosY, z: this.localPosZ };
      this.objeto.position.set(this.localPosX, this.localPosY, this.localPosZ);
      this.mapaSvc.onMapChanged.next();
  }

  aplicarRotacion() {
      const override = this.getOrCreateOverride();
      const rx = this.localRotX * (Math.PI / 180);
      const ry = this.localRotY * (Math.PI / 180);
      const rz = this.localRotZ * (Math.PI / 180);
      
      override.rotation = { x: rx, y: ry, z: rz };
      
      if (this.objeto.rotationQuaternion) {
          const q = this.objeto.rotationQuaternion;
          q.set(0,0,0,1);
          q.x = Math.sin(rx/2)*Math.cos(ry/2)*Math.cos(rz/2) - Math.cos(rx/2)*Math.sin(ry/2)*Math.sin(rz/2);
          q.y = Math.cos(rx/2)*Math.sin(ry/2)*Math.cos(rz/2) + Math.sin(rx/2)*Math.cos(ry/2)*Math.sin(rz/2);
          q.z = Math.cos(rx/2)*Math.cos(ry/2)*Math.sin(rz/2) - Math.sin(rx/2)*Math.sin(ry/2)*Math.cos(rz/2);
          q.w = Math.cos(rx/2)*Math.cos(ry/2)*Math.cos(rz/2) + Math.sin(rx/2)*Math.sin(ry/2)*Math.sin(rz/2);
          this.objeto.rotation.set(0, 0, 0);
      } else {
          this.objeto.rotation.set(rx, ry, rz);
      }
      this.mapaSvc.onMapChanged.next();
  }

  aplicarEscala() {
      const override = this.getOrCreateOverride();
      override.scale = { x: this.localEscX, y: this.localEscY, z: this.localEscZ };
      this.objeto.scaling.set(this.localEscX, this.localEscY, this.localEscZ);
      this.mapaSvc.onMapChanged.next();
  }

  aplicarVisuales() {
      const override = this.getOrCreateOverride();
      override.color = this.objColor;
      override.colorBW = this.objColorBW;
      override.esEmisivo = this.objEsEmisivo;
      override.brilloIntensidad = this.objBrilloIntensidad;
      override.textureSource = this.textureSource;
      override.texturePath = this.texturePath;

      this.actualizarMaterialEnMotor(override);
      this.mapaSvc.onMapChanged.next();
  }

  aplicarTextura() {
      if (this.textureSource === 'asset') {
          this.texturePath = this.objAssetSeleccionado ? this.objAssetSeleccionado.path : '';
      } else {
          this.texturePath = '';
      }

      const override = this.getOrCreateOverride();
      override.textureSource = this.textureSource;
      override.texturePath = this.texturePath;
      
      this.actualizarMaterialEnMotor(override);
      this.mapaSvc.onMapChanged.next();
  }

  restaurarTexturaOriginal() {
      this.textureSource = 'original';
      this.objAssetSeleccionado = null;
      this.texturePath = '';
      
      const override = this.getOrCreateOverride();
      override.textureSource = 'original';
      override.texturePath = '';

      this.actualizarMaterialEnMotor(override);
      this.mapaSvc.onMapChanged.next();
  }

  private actualizarMaterialEnMotor(override: PartOverride) {
      const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
      const activeColor = isBW ? (override.colorBW || override.color || this.entity.visual.colorBW) : (override.color || this.entity.visual.color);
      const activeAmbient = isBW ? this.entity.visual.ambientColorBW : this.entity.visual.ambientColor;

      if (this.objeto.material) {
         this.materialSvc.asegurarMaterialUnico(this.objeto, this.entity.uid);
         this.materialSvc.ajustarMaterialGLB(
             this.objeto.material, isBW, this.objeto.getScene(), 
             activeAmbient, 
             activeColor, 
             override.esEmisivo ?? this.entity.visual.esEmisivo, 
             override.brilloIntensidad ?? this.entity.visual.brilloIntensidad,
             override.texturePath,
             override.textureSource
         );
      }
  }
}