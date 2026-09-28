export type MissionStatus = 'PLANNING' | 'PRE_LAUNCH' | 'IN_FLIGHT' | 'ORBIT_INSERTION' | 'LANDED' | 'COMPLETED' | 'ABORTED';

export interface SpacecraftComponentDto {
  id?: string;
  type: 'propulsion' | 'power' | 'navigation' | 'communications' | 'lifeSupport' | 'thermalControl' | 'structure' | 'avionics' | 'payload';
  name: string;
  manufacturer: string;
  status: 'NOMINAL' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';
  health: number;
  specifications: any;
  configuration: any;
}

export interface TelemetryDataDto {
  velocityKms: number;
  altitudeKm: number;
  temperatureC: number;
  radiationLevelRad: number;
  powerDrawWatts: number;
  fuelRemainingKg: number;
}

export interface MissionProfileDto {
  id?: number;
  episodeId?: number;
  missionName: string;
  missionCode: string;
  description: string;
  missionStatus: MissionStatus;
  currentPhase: string;
  completionPercentage: number;
  assignedBudget: number;
  spentBudget: number;
  remainingBudget?: number;
  spacecraftName: string;
  spacecraftModel: string;
  spacecraftMassKg: number;
  spacecraftPowerWatts: number;
  spacecraftFuelCapacityKg: number;
  components: SpacecraftComponentDto[];
  telemetry?: TelemetryDataDto;
}

export interface CreateMissionProfileDto extends Omit<MissionProfileDto, 'id' | 'remainingBudget' | 'episodeId'> {}

export interface UpdateMissionProfileDto extends Partial<MissionProfileDto> {}