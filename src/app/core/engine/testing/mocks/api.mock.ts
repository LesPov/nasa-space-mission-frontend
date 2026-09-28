import { of, Observable } from 'rxjs';
import { SceneSavePayload, MissionProfileDto, CreateMissionProfileDto } from '../../models/api-dto.model';

export class MockEpisodiosService {
  private memoryStore: Record<number, SceneSavePayload> = {};

  obtenerEscenaCompleta(sceneId: number) {
    if (this.memoryStore[sceneId]) {
      return of(this.memoryStore[sceneId]);
    }
    return of({
      scene: { id: sceneId, name: 'Test Platform' },
      sceneObjects: [],
      triggers: [],
      environmentSettings: {},
      cinematics: []
    });
  }

  guardarMapaEscena(sceneId: number, mapData: SceneSavePayload) {
    this.memoryStore[sceneId] = JSON.parse(JSON.stringify(mapData));
    return of({ success: true });
  }

  obtenerEpisodios(): Observable<any[]> {
    return of([{ id: 1, title: 'Test Episode' }]);
  }

  crearEpisodio(title: string, description: string): Observable<any> {
    return of({ id: 2, title, description });
  }

  obtenerPlataformasEscena(epiId: number): Observable<any[]> {
    return of([{ id: 100, name: 'Zone 1' }]);
  }
  
  cargarEstadoJugador(): Observable<any> {
    return of({ worldState: {}, inventory: [] });
  }

  guardarEstadoJugador(episodeId: number, slot: number, state: any): Observable<any> {
    return of({ success: true });
  }

  obtenerPrefabs(): Observable<any[]> {
    return of([]);
  }

  crearPrefab(data: any): Observable<any> {
    return of({ id: 1, ...data });
  }

  eliminarPrefab(id: number): Observable<any> {
    return of({ success: true });
  }

  obtenerAssets(): Observable<any[]> {
    return of([]);
  }

  subirAsset(file: File): Observable<any> {
    return of({ id: 1, path: '/uploads/assets/test.png', name: file.name });
  }

  obtenerRoles(episodeId: number): Observable<any[]> {
    return of([]);
  }

  crearRol(episodeId: number, roleData: any): Observable<any> {
    return of({ id: 1, ...roleData });
  }

  actualizarRol(roleId: number, roleData: any): Observable<any> {
    return of({ id: roleId, ...roleData });
  }

  eliminarRol(roleId: number): Observable<any> {
    return of({ success: true });
  }

  obtenerMissionProfile(episodeId: number): Observable<MissionProfileDto> {
    return of({
      id: 1,
      episodeId,
      missionName: 'Misión Test',
      missionCode: 'MIS-001',
      description: 'Misión orbital de prueba',
      missionStatus: 'PLANNING',
      currentPhase: 'Fase Inicial',
      completionPercentage: 0,
      assignedBudget: 50000000,
      spentBudget: 0,
      remainingBudget: 50000000,
      spacecraftName: 'Orbital Scout-I',
      spacecraftModel: 'Surveyor Mk-1',
      spacecraftMassKg: 12500,
      spacecraftPowerWatts: 45000,
      spacecraftFuelCapacityKg: 8000,
      components: []
    });
  }

  crearMissionProfile(episodeId: number, profile: CreateMissionProfileDto): Observable<MissionProfileDto> {
    const assigned = Number(profile.assignedBudget) || 0;
    const spent = Number(profile.spentBudget) || 0;
    return of({
      id: 1,
      episodeId,
      ...profile,
      remainingBudget: Math.max(0, assigned - spent)
    });
  }

  actualizarMissionProfile(episodeId: number, profile: Partial<MissionProfileDto>): Observable<MissionProfileDto> {
    return of({
      id: 1,
      episodeId,
      missionName: profile.missionName || 'Misión Actualizada',
      missionCode: profile.missionCode || 'MIS-001',
      description: profile.description || '',
      missionStatus: profile.missionStatus || 'PLANNING',
      currentPhase: profile.currentPhase || '',
      completionPercentage: profile.completionPercentage || 0,
      assignedBudget: profile.assignedBudget || 50000000,
      spentBudget: profile.spentBudget || 0,
      remainingBudget: profile.remainingBudget || 50000000,
      spacecraftName: profile.spacecraftName || 'Nave',
      spacecraftModel: profile.spacecraftModel || 'Modelo',
      spacecraftMassKg: profile.spacecraftMassKg || 10000,
      spacecraftPowerWatts: profile.spacecraftPowerWatts || 40000,
      spacecraftFuelCapacityKg: profile.spacecraftFuelCapacityKg || 5000,
      components: profile.components || []
    });
  }
}