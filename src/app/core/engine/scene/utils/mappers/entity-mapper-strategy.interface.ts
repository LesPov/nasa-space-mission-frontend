
export interface EntityMapperStrategy {
  /** Determina si este mapper es responsable de la entidad basada en su tipo. */
  supports(entityType: string, obj?: any): boolean;

  /** Aplica las propiedades guardadas en la Base de Datos (DTO) a la Entidad del Motor. */
  applyDbToEntity(obj: any, entity: import('../../../entities/game.entity').GameEntity): void;

  /** Extrae las propiedades internas del juego hacia un formato parcial de guardado DTO. */
  extractEntityProperties(entity: import('../../../entities/game.entity').GameEntity): any;

  /** Extrae completamente la Entidad y devuelve un Array de DTOs listos para la DB. */
  extractToDtos(entity: import('../../../entities/game.entity').GameEntity): any[];
}