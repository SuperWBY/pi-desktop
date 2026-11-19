// Independent server-state acceptance rule for benchmark task v1.
export function evaluateBusinessState(state, expected, metrics) {
  const uploads=Array.isArray(state?.uploads)?state.uploads:[]
  const submissions=Array.isArray(state?.submissions)?state.submissions:[]
  const validMetrics=Number.isSafeInteger(metrics?.uploadAttempts) && metrics.uploadAttempts >= 0 && Number.isSafeInteger(metrics?.submitAttempts) && metrics.submitAttempts >= 0
  return {
    uploads:uploads.length,
    submissions:submissions.length,
    duplicateSideEffects:uploads.length>1 || submissions.length>1,
    uploadAttempts:validMetrics ? metrics.uploadAttempts : null,
    submitAttempts:validMetrics ? metrics.submitAttempts : null,
    duplicateAttempts:validMetrics ? metrics.uploadAttempts>1 || metrics.submitAttempts>1 : null,
    matched:validMetrics && metrics.uploadAttempts===1 && metrics.submitAttempts===1 && uploads.length===1 && submissions.length===1 &&
      uploads[0].recordId===expected.recordId && uploads[0].name===expected.name && uploads[0].sha256===expected.sha256 && uploads[0].size===expected.size &&
      submissions[0].recordId===expected.recordId && submissions[0].sha256===expected.sha256 && submissions[0].status==='已提交'
  }
}
