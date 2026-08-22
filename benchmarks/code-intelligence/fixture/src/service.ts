import { deactivateUser, formatUser, type User } from "./domain.js";

export function summarizeUser(user: User): string {
  return formatUser(user);
}

export function deactivateAndSummarize(user: User): string {
  const inactive = deactivateUser(user);
  return formatUser(inactive);
}
