
import { Injectable } from '@angular/core';
import { Vector3 } from '@babylonjs/core';
import { GameEntity } from '../../../entities/game.entity';
 
interface GridCell {
    entities: Map<string, GameEntity>;
}

@Injectable({ providedIn: 'root' })
export class LightSpatialGridService {
    private cellSize = 10;
    private grid = new Map<string, GridCell>();
    private entityToCell = new Map<string, string>();

    private getCellKey(pos: Vector3): string {
        const x = Math.floor(pos.x / this.cellSize);
        const y = Math.floor(pos.y / this.cellSize);
        const z = Math.floor(pos.z / this.cellSize);
        return `${x},${y},${z}`;
    }

    public insert(entity: GameEntity, pos: Vector3): void {
        if (!entity || !entity.uid) return;
        const key = this.getCellKey(pos);
        
        if (!this.grid.has(key)) {
            this.grid.set(key, { entities: new Map() });
        }
        this.grid.get(key)!.entities.set(entity.uid, entity);
        this.entityToCell.set(entity.uid, key);
    }

    public remove(entity: GameEntity): void {
        if (!entity || !entity.uid) return;
        const key = this.entityToCell.get(entity.uid);
        if (key && this.grid.has(key)) {
            this.grid.get(key)!.entities.delete(entity.uid);
            if (this.grid.get(key)!.entities.size === 0) {
                this.grid.delete(key);
            }
        }
        this.entityToCell.delete(entity.uid);
    }

    public move(entity: GameEntity, newPos: Vector3): void {
        if (!entity || !entity.uid) return;
        const oldKey = this.entityToCell.get(entity.uid);
        const newKey = this.getCellKey(newPos);
        
        if (oldKey !== newKey) {
            this.remove(entity);
            this.insert(entity, newPos);
        }
    }

    public clear(): void {
        this.grid.clear();
        this.entityToCell.clear();
    }

    public hasEntity(uid: string): boolean {
        return this.entityToCell.has(uid);
    }

    public syncDeletions(allEntities: GameEntity[]): void {
        const currentUids = new Set(allEntities.map(e => e.uid));
        const keysToRemove: string[] = [];
        this.entityToCell.forEach((cellKey, uid) => {
            if (!currentUids.has(uid)) {
                keysToRemove.push(uid);
            }
        });
        keysToRemove.forEach(uid => {
            const cellKey = this.entityToCell.get(uid);
            if (cellKey && this.grid.has(cellKey)) {
                this.grid.get(cellKey)!.entities.delete(uid);
            }
            this.entityToCell.delete(uid);
        });
    }

    public querySphere(center: Vector3, radius: number): GameEntity[] {
        const results: GameEntity[] = [];
        const radiusSq = radius * radius;
        
        const minX = Math.floor((center.x - radius) / this.cellSize);
        const maxX = Math.floor((center.x + radius) / this.cellSize);
        const minY = Math.floor((center.y - radius) / this.cellSize);
        const maxY = Math.floor((center.y + radius) / this.cellSize);
        const minZ = Math.floor((center.z - radius) / this.cellSize);
        const maxZ = Math.floor((center.z + radius) / this.cellSize);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = `${x},${y},${z}`;
                    const cell = this.grid.get(key);
                    if (cell) {
                        for (const entity of cell.entities.values()) {
                            const distSq = Vector3.DistanceSquared(center, entity.getAbsolutePosition());
                            if (distSq <= radiusSq) {
                                results.push(entity);
                            }
                        }
                    }
                }
            }
        }
        return results;
    }
}