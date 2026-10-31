// Fixed synthetic evaluation, no network/writes on import.
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runNativeRetentionEvaluation,retentionEvaluationSourceMetadata} from './clarity-retention-v3-live.mjs';
import {validRunId} from './clarity-material-v2-fixtures.mjs';
import {V5_CASE_IDS} from './clarity-retention-v5-fixtures.mjs';
export const runRetentionV5Evaluation=options=>runNativeRetentionEvaluation({...options,experimentVersion:5});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validRunId(args[1]))throw new TypeError('invalid_retention_v5_cli');
  const output=new URL(`../../work/retention-v5-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_retention_v5_ledger');
  const source=retentionEvaluationSourceMetadata(5);if(source.sourceTreeDirty)throw Error('retention_v5_requires_frozen_source');
  mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const result=await runRetentionV5Evaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,clientStepAttempts:result.clientStepAttempts,modelDispatchesObserved:result.modelDispatchesObserved,
    completedCases:result.completedCaseCount??0,savedCases:result.memorySavedCaseCount??0,firstTurnProbes:result.completedBoundaryProbes??0,
    unsupportedSources:result.sourceUnsupportedCaseCount??0,rejectedOutputs:result.runtimeRejectedOutputCount??0,semanticReview:result.semanticReview}));
  // A recorded preflight refusal is a real boundary result, never a success.
  if(!result.complete||(result.completedCaseCount??0)+(result.sourceUnsupportedCaseCount??0)!==V5_CASE_IDS.length||result.runtimeRejectedOutputCount>0)process.exitCode=1;
}
