// Isolated v3 entry. Share the fixed-fixture Host and authentication guards;
// do not let request data or caller-supplied factory options select v2 instead.
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';

export function createRetentionV3Worker(options={}){
  return createMaterialV2Worker({...options,experimentVersion:3});
}

export default createRetentionV3Worker();
