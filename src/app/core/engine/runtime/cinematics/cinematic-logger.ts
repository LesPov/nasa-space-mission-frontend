
export const CINEMATIC_DEBUG = true;

export class CinematicLogger {
  static logOwnership(owner: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicCamera] ownership: ${owner}`);
  }
  
  static logPlayback(action: string, detail?: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicPlayback] ${action}${detail ? ': ' + detail : ''}`);
  }
  
  static logActiveCamera(camId: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicCamera] active: ${camId}`);
  }
  
  static logTarget(target: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicCamera] target: ${target}`);
  }
  
  static logSelection(trackId: string, keyframeId?: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicSelection] selected: trackId=${trackId} keyframeId=${keyframeId || 'none'}`);
  }
  
  static logOverlay(action: string, detail?: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicOverlay] ${action}${detail ? ' ' + detail : ''}`);
  }

  static warn(msg: string) {
    console.warn(`[CinematicWarning] ${msg}`);
  }

  static logAutoExpand(from: number, to: number) {
    if(CINEMATIC_DEBUG) {
      console.log(`[CinematicTimeline] durationAutoExpanded`);
      console.log(`from=${from}`);
      console.log(`to=${to}`);
    }
  }

  static logTimeChanged(from: number, to: number) {
    if(CINEMATIC_DEBUG) {
      console.log(`[CinematicKeyframe] timeChanged`);
      console.log(`from=${from}`);
      console.log(`to=${to}`);
    }
  }

  static logWarningExceedsMax(value: number) {
    console.warn(`[CinematicWarning] timeExceedsMaximum`);
    console.warn(`value=${value}`);
  }
  
  static logMigration(action: string, detail?: string) {
    if(CINEMATIC_DEBUG) console.log(`[CinematicMigration] ${action}=${detail || ''}`);
  }
}