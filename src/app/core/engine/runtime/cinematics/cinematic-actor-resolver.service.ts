
import { Injectable, inject } from '@angular/core';
import { GameEntity } from '../../entities/game.entity';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class CinematicActorResolverService {
  private entityManager = inject(EntityManagerService);
  
  // Caché O(1) de resolución por frame
  private cache = new Map<string, GameEntity | null>();
  // Control anti-spam de consola
  private warnedUids = new Set<string>();

  /**
   * Pre-carga y bloquea las referencias al inicio de la cinemática.
   */
  public prefetch(uids: string[]): void {
    this.cache.clear();
    this.warnedUids.clear();
    
    const uniqueUids = [...new Set(uids.filter(Boolean))];
    for (const uid of uniqueUids) {
      const entity = this.entityManager.getEntityByUid(uid) || null;
      this.cache.set(uid, entity);
      
      if (!entity) {
        console.warn(`[CinematicActorResolver] ⚠️ Actor '${uid}' no encontrado. Las acciones cinematográficas que dependan de él serán ignoradas de forma segura.`);
        this.warnedUids.add(uid);
      }
    }
  }

  /**
   * Resuelve el UID de manera segura (O(1) promedio) para usar en cada frame.
   */
  public resolve(uid: string): GameEntity | null {
    if (!uid) return null;
    
    let cached = this.cache.get(uid);
    
    // 🔥 FIX AUTO-HEALING: Eliminar referencia en caché si el motor reconstruyó la malla por detrás (Ej: Test Live)
    if (cached && cached.view && typeof cached.view.isDisposed === 'function' && cached.view.isDisposed()) {
       this.cache.delete(uid); 
       if (!this.warnedUids.has(uid)) {
           console.warn(`[CinematicActorResolver] ⚠️ Actor '${uid}' fue destruido (Test Live / Delete). Intentando re-vincular de la escena.`);
           this.warnedUids.add(uid);
       }
       cached = undefined;
    }
    
    if (cached !== undefined) {
      return cached;
    }
    
    // Fallback: Resolución bajo demanda
    const entity = this.entityManager.getEntityByUid(uid) || null;
    this.cache.set(uid, entity);
    
    if (!entity && !this.warnedUids.has(uid)) {
       console.warn(`[CinematicActorResolver] ⚠️ Actor '${uid}' resuelto bajo demanda y no encontrado en el mapa.`);
       this.warnedUids.add(uid);
    } else if (entity && this.warnedUids.has(uid)) {
       console.log(`[CinematicActorResolver] 🔗 Actor '${uid}' re-vinculado exitosamente a la escena restaurada.`);
       this.warnedUids.delete(uid);
    }
    
    return entity;
  }

  /**
   * Libera las referencias de memoria.
   */
  public clearCache(): void {
    this.cache.clear();
    this.warnedUids.clear();
  }
}