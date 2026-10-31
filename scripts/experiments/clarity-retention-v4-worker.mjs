// Isolated v4 entry. Reuse the authenticated fixed-fixture Host; callers and
// request data cannot change its policy or continuation version.
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';

export function createRetentionV4Worker(options={}){
  return createMaterialV2Worker({...options,experimentVersion:4});
}

export default createRetentionV4Worker();
