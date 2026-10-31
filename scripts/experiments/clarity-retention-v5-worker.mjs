// Isolated source-check experiment. Request data cannot choose its version.
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';

export function createRetentionV5Worker(options={}){
  return createMaterialV2Worker({...options,experimentVersion:5});
}

export default createRetentionV5Worker();
