export function elapsedRunMs(state,now){if(state.elapsedWallMs==null)return null;return Math.max(0,state.elapsedWallMs+(state.wallStartedAt==null?0:Math.max(0,now-state.wallStartedAt)))}
export function clockParts(milliseconds){const seconds=Math.floor(Math.max(0,milliseconds||0)/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0'))}
