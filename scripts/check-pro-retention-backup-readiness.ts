try {
  const response = await base44.functions.invoke('backupProQuestionnaireRetention', { maxRecords: 1 });
  const result = response?.data ?? response;
  console.log(JSON.stringify({
    configured: result?.configured === true,
    missing_secret_names: result?.missingSecretNames || [],
    status: result?.status || ''
  }, null, 2));
} catch (error: any) {
  const result = error?.response?.data || error?.data || {};
  console.log(JSON.stringify({
    configured: result?.configured === true,
    missing_secret_names: result?.missingSecretNames || [],
    error: result?.error || 'Retention backup readiness check failed.'
  }, null, 2));
}
