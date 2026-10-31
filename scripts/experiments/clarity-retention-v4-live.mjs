// Native regression/boundary evaluation. No network or writes on import.
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runNativeRetentionEvaluation,retentionEvaluationSourceMetadata} from './clarity-retention-v3-live.mjs';
import {validRunId} from './clarity-material-v2-fixtures.mjs';
import {V4_CASE_IDS} from './clarity-retention-v4-fixtures.mjs';
export const runRetentionV4Evaluation=options=>runNativeRetentionEvaluation({...options,experimentVersion:4});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validRunId(args[1]))throw new TypeError('invalid_retention_v4_cli');
  const output=new URL(`../../work/retention-v4-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_retention_v4_ledger');
  const source=retentionEvaluationSourceMetadata(4);if(source.sourceTreeDirty)throw Error('retention_v4_requires_frozen_source');
  mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const result=await runRetentionV4Evaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,clientStepAttempts:result.clientStepAttempts,modelDispatchesObserved:result.modelDispatchesObserved,
    completedCases:result.completedCaseCount??0,memorySavedCases:result.memorySavedCaseCount??0,boundaryProbes:result.completedBoundaryProbes??0,semanticReview:result.semanticReview}));
  if(!result.complete||result.completedCaseCount!==V4_CASE_IDS.length)process.exitCode=1;
}
