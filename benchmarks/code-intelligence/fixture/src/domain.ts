export interface User {
  id: string;
  displayName: string;
  active: boolean;
}

export type UserLabel = string;

export function formatUser(user: User): UserLabel {
  const state = user.active ? "active" : "inactive";
  return `${user.displayName} (${state})`;
}

export function deactivateUser(user: User): User {
  return { ...user, active: false };
}
