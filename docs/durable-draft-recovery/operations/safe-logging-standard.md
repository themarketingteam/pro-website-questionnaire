# Safe Logging Standard

All browser and server runtime logs use the safe logging wrappers. A log is a small structured envelope with a stable event label and explicitly allowed scalar metadata such as severity, environment, request ID, operation, status, safe error code, latency, retry count, and component version.

Never log request bodies, questionnaire answers, canonical state, raw/full draft or session IDs, email addresses, recovery codes, resume/recovery-session tokens, admin grants, passwords, CAPTCHA tokens, cookies, authorization headers, AWS credentials, Zapier URLs, provider bodies, or migration bundles. Do not stringify arbitrary `Error`, `Request`, `Response`, or SDK objects. Browser logs never contain stack traces; protected server stacks require a separately approved policy and must pass redaction.

The wrapper recursively replaces sensitive keys and recognizable email, recovery-code, token, AWS access-key, and URL-query credential patterns with `[REDACTED]`. Unknown metadata keys are dropped. Redaction is defense in depth: callers must still construct safe data rather than rely on pattern detection.

Telemetry and logs are diagnostic, non-authoritative, best effort, environment-scoped, and removable by synthetic `test_run_id`. A telemetry or logging failure must never block, overwrite, roll back, or invalidate an acknowledged draft operation. Tests must use synthetic values and scan captured output/artifacts before release.
