import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../services/api/episodios';
import { EditorMapaService } from '../../services/editor-mapa.service';
import { AbstractMesh, Vector3 } from '@babylonjs/core';

@Component({
  selector: 'app-global-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './global-timeline.html',
  styleUrl: './global-timeline.css'
})
export class GlobalTimeline implements OnInit {
  public api = inject(EpisodiosService);
  public editorSvc = inject(EditorMapaService);
  private cdr = inject(ChangeDetectorRef);

  public activeTab: string = 'animaciones';
  
  public prefabsDisponibles: any[] = [];
  public nuevoPrefabNombre: string = '';
  public guardandoPrefab = false;

  public autoAnimConfig = {
    enabled: false,
    type: 'move', // 'move', 'rotate', 'scale', 'float'
    axis: 'Y',
    amount: 5,
    duration: 2
  };

  ngOnInit() {
    this.cargarPrefabs();
    
    this.editorSvc.onMapChanged.subscribe(() => {
      this.leerAutoAnimacionDelObjeto();
    });
  }

  leerAutoAnimacionDelObjeto() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (seleccionado && seleccionado.metadata) {
      const savedAnim = seleccionado.metadata.autoAnim;
      if (savedAnim) {
        this.autoAnimConfig = { ...savedAnim };
      } else {
        this.autoAnimConfig = { enabled: false, type: 'move', axis: 'Y', amount: 5, duration: 2 };
      }
      this.cdr.detectChanges();
    }
  }

  guardarAutoAnimacion() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!seleccionado) return;

    if (!seleccionado.metadata) seleccionado.metadata = {};
    
    seleccionado.metadata.autoAnim = { ...this.autoAnimConfig };
    this.editorSvc.triggerUpdate(); 
    alert('Configuración de animación guardada. Dale "Jugar" para probarla.');
  }

  cargarPrefabs() {
    this.api.obtenerPrefabs().subscribe({
      next: (res) => {
        this.prefabsDisponibles = res;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error cargando prefabs:', err)
    });
  }

  // 🔥 NUEVA LÓGICA VITAL: Guarda TODO (Modelo, Luz, Animación, Rotación, Escala)
  guardarObjetoActualComoPrefab() {
    const seleccionado = this.editorSvc.objetoSeleccionado() as AbstractMesh;
    if (!seleccionado || !this.nuevoPrefabNombre.trim()) return;

    const meta = seleccionado.metadata || {};
    
    // 1. Clonamos toda la metadata para asegurar que no se pierde ni el color ni las físicas
    const propertiesToSave = JSON.parse(JSON.stringify(meta));
    
    // 2. Limpiamos datos residuales que no pertenecen a un Prefab
    delete propertiesToSave.uid;
    delete propertiesToSave.parentId;
    delete propertiesToSave.isHovered;
    delete propertiesToSave.currentHoverScale;
    delete propertiesToSave.baseScaleX;
    delete propertiesToSave.baseScaleY;
    delete propertiesToSave.baseScaleZ;

    // 3. CAPTURAMOS LA ESCALA Y ROTACIÓN ORIGINAL DEL OBJETO
    propertiesToSave.scale = { x: seleccionado.scaling.x, y: seleccionado.scaling.y, z: seleccionado.scaling.z };
    const rot = seleccionado.rotationQuaternion 
        ? seleccionado.rotationQuaternion.toEulerAngles() 
        : seleccionado.rotation;
    propertiesToSave.rotation = { x: rot.x, y: rot.y, z: rot.z };

    // 4. CAPTURAMOS EL ASSET ID (Si es un modelo 3D o Luz con modelo)
    const assetId = meta.assetId || null;
    const type = meta.type || 'cube';

    this.guardandoPrefab = true;

    // 5. Enviamos a la Base de Datos
    this.api.crearPrefab({
      name: this.nuevoPrefabNombre,
      type: type,
      assetId: assetId,
      properties: propertiesToSave
    }).subscribe({
      next: () => {
        this.nuevoPrefabNombre = '';
        this.guardandoPrefab = false;
        this.cargarPrefabs();
        alert('Prefab guardado con éxito (Modelo 3D, Luces y Animaciones incluidos).');
      },
      error: (err) => {
        console.error('Error guardando prefab:', err);
        this.guardandoPrefab = false;
        alert('Error al guardar el Prefab.');
      }
    });
  }

  instanciarPrefab(prefab: any) {
    const camTarget = this.editorSvc.state.cameraPivot?.position || new Vector3(0, 1, 0);
    this.editorSvc.instanciarPrefabFull(prefab, camTarget);
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Seguro que deseas eliminar este Prefab global?')) {
      this.api.eliminarPrefab(id).subscribe({
        next: () => this.cargarPrefabs(),
        error: () => alert('Error eliminando prefab')
      });
    }
  }
}