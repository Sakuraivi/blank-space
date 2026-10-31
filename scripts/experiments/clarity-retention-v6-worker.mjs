// Import-safe while the final post-freeze fixture is not installed. The
// shared Worker loads v6 policy/fixtures only when evaluating that version.
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';

export function createRetentionV6Worker(options={}){
  return createMaterialV2Worker({...options,experimentVersion:6});
}

export default createRetentionV6Worker();
