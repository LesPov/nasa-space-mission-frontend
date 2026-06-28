
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { SceneObjectBuilderService } from '../sceneservice/scene-object-builder.service';
import { EpisodiosService } from '../../../services/api/episodios';

@Injectable({ providedIn: 'root' })
export class AddObjectModalService {
  private stateSvc = inject(EditorStateService);
  private builderSvc = inject(SceneObjectBuilderService);
  private epiApiSvc = inject(EpisodiosService);

  public objNombre: string = 'Objeto_' + Math.floor(Math.random() * 1000);
  public objTipo: string = 'cube';
  public objRol: string = 'prop';
  public objColor: string = '#ffffff';
  public objSizeX: number = 1;
  public objSizeY: number = 1;
  public objSizeZ: number = 1;
  public objAssetSeleccionado: any = null;
  public objEsSolido: boolean = true;
  public objEsSeleccionable: boolean = true;
  public objMensaje: string = '';
  public objHacerHijo: boolean = true;

  public listaAssets: any[] = [];
  public archivoSubida: File | null = null;
  public subiendoAsset = false;

  public onRolChange(): void {
  }

  public onTipoChange(): void {
    if (this.objTipo === 'trigger' || this.objTipo === 'trigger_compuesto') {
      this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true;
    } else if (this.objTipo.startsWith('light_')) {
      this.objRol = 'prop'; this.objColor = '#ffffff'; this.objEsSolido = false; this.objEsSeleccionable = true;
    } else if (this.objTipo === 'bubble' || this.objTipo === 'video_plane' || this.objTipo === 'image_plane') {
      this.objRol = 'prop'; this.objEsSolido = false; this.objEsSeleccionable = true;
    }
    
    if (this.objTipo !== 'model' && !this.objTipo.startsWith('light_') && this.objTipo !== 'video_plane' && this.objTipo !== 'image_plane') {
      this.objAssetSeleccionado = null;
    }
  }

  public cargarAssets(): void {
    this.epiApiSvc.obtenerAssets().subscribe({
      next: (res) => {
        this.listaAssets = res.filter((a:any) => 
          a.type === 'model_glb' || a.type === 'video_mp4' || 
          a.path.endsWith('.mp4') || a.path.endsWith('.webm') || 
          a.type === 'texture_png' || a.type === 'texture_jpg' || 
          a.path.endsWith('.png') || a.path.endsWith('.jpg') || a.path.endsWith('.jpeg')
        );
      },
      error: (err) => console.error('Error al cargar assets', err)
    });
  }

  public seleccionarArchivoSubida(event: any): void {
    if (event.target.files && event.target.files.length > 0) {
      this.archivoSubida = event.target.files[0];
    }
  }

  public subirNuevoAsset(onSuccess: () => void): void {
    if (!this.archivoSubida) return;
    this.subiendoAsset = true;
    this.epiApiSvc.subirAsset(this.archivoSubida).subscribe({
      next: (res) => {
        this.subiendoAsset = false;
        this.archivoSubida = null;
        alert('Archivo subido correctamente');
        this.cargarAssets();
        onSuccess();
      },
      error: (err) => {
        this.subiendoAsset = false;
        alert('Error al subir el archivo. Revisa la consola.');
      }
    });
  }

  public crearObjeto3D(): void {
    if(!this.objNombre) return;
    const parent = this.objHacerHijo ? (this.stateSvc.objetoSeleccionado() as AbstractMesh | null) : null;
    this.builderSvc.agregarObjetoCustom(
      this.objTipo, this.objNombre, this.objRol, this.objColor, this.objSizeX, this.objSizeY, this.objSizeZ,
      this.objAssetSeleccionado, this.objEsSolido, this.objEsSeleccionable, this.objMensaje, parent
    );
    this.cerrarModalObjeto();
  }

  public cerrarModalObjeto(): void {
    this.stateSvc.showAddObjectModal.set(false);
    this.objNombre = 'Objeto_' + Math.floor(Math.random() * 1000);
    this.objTipo = 'cube'; this.objRol = 'prop'; this.objColor = '#ffffff';
    this.objSizeX = 1; this.objSizeY = 1; this.objSizeZ = 1;
    this.objAssetSeleccionado = null; this.archivoSubida = null;
    this.objEsSolido = true; this.objEsSeleccionable = true; this.objMensaje = ''; this.objHacerHijo = true;
  }
}