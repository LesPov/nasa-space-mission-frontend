
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EpisodiosService } from '../../../../services/api/episodios';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { NarrativeRoleDto } from '../../../../core/engine/models/api-dto.model';

@Component({
  selector: 'app-timeline-roles-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-roles-tab.html',
  styleUrls: ['./timeline-roles-tab.css']
})
export class TimelineRolesTab implements OnInit {
  private apiSvc = inject(EpisodiosService);
  private editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private cdr = inject(ChangeDetectorRef);

  public roles: NarrativeRoleDto[] = [];
  public prefabs: any[] = [];
  public spawnPoints: any[] = [];
  
  public selectedRoleId: number | null = null;
  public loading = false;

  ngOnInit() {
    this.cargarDatos();
  }

  get currentEpisodeId() { return this.editorSvc.episodioActualData()?.id; }

  get selectedRole() { return this.roles.find(r => r.id === this.selectedRoleId) || null; }

  cargarDatos() {
    if (!this.currentEpisodeId) return;
    this.loading = true;
    
    this.apiSvc.obtenerRoles(this.currentEpisodeId).subscribe(roles => {
      this.roles = roles;
      if (this.roles.length > 0 && !this.selectedRoleId) {
          this.selectedRoleId = this.roles[0].id!;
      }
      this.loading = false;
      this.cdr.detectChanges();
    });

    this.apiSvc.obtenerPrefabs().subscribe(p => {
      // 🔥 FIX: Filtrar para mostrar únicamente Prefabs válidos para personajes
      this.prefabs = p.filter((prefab: any) => {
          const rootProps = prefab.properties?.prefabHierarchy?.[0]?.properties || prefab.properties;
          return rootProps?.characterConfig || rootProps?.rol === 'player' || rootProps?.rol === 'npc';
      });
      this.cdr.detectChanges();
    });

    this.actualizarSpawnPoints();
  }

  actualizarSpawnPoints() {
    this.spawnPoints = this.entityManager.getAllEntities()
        .filter(e => e.rol === 'spawn_point')
        .map(e => ({ uid: e.uid, name: e.name }));
  }

  nuevoRol() {
    if (!this.currentEpisodeId) return;
    const newRole: NarrativeRoleDto = {
      uid: window.crypto.randomUUID(),
      name: 'Nuevo Rol',
      description: '',
      isEnabled: true,
      isPlayable: true,
      sortOrder: this.roles.length,
      characterPrefabId: null,
      spawnSceneObjectUid: null
    };

    this.apiSvc.crearRol(this.currentEpisodeId, newRole).subscribe(role => {
      this.roles.push(role);
      this.selectedRoleId = role.id!;
      this.cdr.detectChanges();
      this.syncEpisodeData();
    });
  }

  guardarRol(role: NarrativeRoleDto) {
    if (!role.id) return;
    this.apiSvc.actualizarRol(role.id, role).subscribe(updated => {
      const idx = this.roles.findIndex(r => r.id === updated.id);
      if (idx !== -1) this.roles[idx] = updated;
      this.cdr.detectChanges();
      this.syncEpisodeData();
    });
  }

  eliminarRol(id: number) {
    if (confirm('¿Eliminar este rol narrativo permanentemente?')) {
      this.apiSvc.eliminarRol(id).subscribe(() => {
        this.roles = this.roles.filter(r => r.id !== id);
        this.selectedRoleId = this.roles.length > 0 ? this.roles[0].id! : null;
        this.cdr.detectChanges();
        this.syncEpisodeData();
      });
    }
  }

  private syncEpisodeData() {
      const epi = this.editorSvc.episodioActualData();
      if (epi) {
          epi.narrativeRoles = [...this.roles];
          this.editorSvc.setEpisodioActualData(epi);
      }
  }
}