
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorSceneService } from '../../../../services/editor/editor-scene.service';
import { EpisodiosService } from '../../../../services/api/episodios';
import { PrefabManagerService } from '../../../../services/editor/prefab-manager.service';

@Component({
  selector: 'app-timeline-prefabs-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-prefabs-tab.html',
  styleUrls: ['./timeline-prefabs-tab.css']
})
export class TimelinePrefabsTab implements OnInit {
  public api = inject(EpisodiosService);
  public stateSvc = inject(EditorStateService);
  public editorSceneSvc = inject(EditorSceneService);
  private prefabManager = inject(PrefabManagerService);
  private cdr = inject(ChangeDetectorRef);

  public prefabsDisponibles: any[] = [];
  public nuevoPrefabNombre: string = '';
  public guardandoPrefab = false;

  ngOnInit() {
    this.cargarPrefabs();
  }

  cargarPrefabs() {
    this.api.obtenerPrefabs().subscribe({
      next: (res) => {
        this.prefabsDisponibles = res;
        this.cdr.detectChanges();
      }
    });
  }

  guardarObjetoActualComoPrefab() {
      const obj = this.stateSvc.objetoSeleccionado();
      if (!obj || !this.nuevoPrefabNombre) return;

      this.guardandoPrefab = true;
      this.prefabManager.createPrefabFromMesh(obj as any, this.nuevoPrefabNombre).then(() => {
          this.guardandoPrefab = false;
          this.nuevoPrefabNombre = '';
          this.cargarPrefabs();
          alert('Prefab guardado exitosamente.');
      }).catch(err => {
          this.guardandoPrefab = false;
          alert('Error al guardar el prefab: ' + err);
      });
  }

  instanciarPrefab(prefab: any) {
    this.editorSceneSvc.instanciarPrefabEnCentro(prefab);
  }

  eliminarPrefab(id: number) {
    if (confirm('¿Seguro que deseas eliminar este Prefab global de la base de datos?')) {
      this.api.eliminarPrefab(id).subscribe({
        next: () => this.cargarPrefabs()
      });
    }
  }
}