
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CinematicActorActionBridgeService {
    // 🔥 ELIMINADO PARA EVITAR DEPENDENCIA CIRCULAR (NG0200)
    // El Director Cinematográfico ahora es capaz de resolver internamente su posición y estado
    // sin delegar al PlayerSequenceService, garantizando la interpolación exacta A -> B.
}