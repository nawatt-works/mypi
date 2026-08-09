export function sensitiveShellReason(command: string): string | undefined {
  const normalized = command.replace(/\\\r?\n/g, " ");
  // Intentionally broad: false positives require confirmation, while absolute paths,
  // sudo/command wrappers, shell -c strings, and command substitutions are covered.
  if (/(?:^|[\s;&|()`'"/])az(?:\s|$|[;&|()`'"])/i.test(normalized)) {
    return "Direct Azure CLI access can use the signed-in identity or reveal an access token.";
  }
  if (/(?:^|[\s;&|()`'"/])(?:env|printenv)(?:\s|$|[;&|()`'"])/i.test(normalized)) {
    return "This command can disclose environment variables, including credentials.";
  }
  return undefined;
}

export function previewCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
}
