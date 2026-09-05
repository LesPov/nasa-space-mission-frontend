
import { CinematicSequence, CinematicTrack } from '../../models/cinematic.model';

export class ActiveCameraResolver {
  /**
   * Resuelve qué pista de cámara (y qué ID de cámara) tiene el control en un instante de tiempo dado.
   * Prioriza el Camera ID del propio Keyframe y respeta el Z-Index inverso de pistas (la última gana).
   */
  public static resolve(sequence: CinematicSequence, timeMs: number): { track: CinematicTrack, cameraId?: string } | null {
    for (let i = sequence.tracks.length - 1; i >= 0; i--) {
      const track = sequence.tracks[i];
      
      if (track.type === 'camera' && track.keyframes.length > 0) {
          const start = track.keyframes[0].timeMs;
          const end = track.keyframes[track.keyframes.length - 1].timeMs;
          
          if (timeMs >= start && timeMs <= end) {
            // Buscamos el Keyframe que gobierna este instante
            let currentKf = track.keyframes[0];
            for (let k = 0; k < track.keyframes.length - 1; k++) {
               if (timeMs >= track.keyframes[k].timeMs && timeMs < track.keyframes[k + 1].timeMs) {
                   currentKf = track.keyframes[k];
                   break;
               }
            }
            if (timeMs >= end) currentKf = track.keyframes[track.keyframes.length - 1];

            const cameraId = currentKf.value?.cameraId || track.cameraId;
            return { track, cameraId };
          }
      }
    }
    return null;
  }
}