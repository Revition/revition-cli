/**
 * T1.1.4 - the secret shapes the CLI can ever hold or see. Applied to every sink: stdout / stderr render, the debug
 * log file, telemetry, crash reports and --json warnings.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /rvt_[A-Za-z0-9]{32,}/g, // PAT
  /rvs_[A-Za-z0-9]{32,}/g, // CLI session
  /rdk_[a-f0-9]{16}_[A-Za-z0-9_-]{20,}/g, // app key (verified format)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /(refresh|access)_token["'=:\s]+[^"'\s,}]+/gi,
  /Bearer\s+[^\s"']+/gi,
  /authorization:\s*[^\n]+/gi,
];

export const REDACTED = '[REDACTED]';
