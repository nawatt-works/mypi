import { summarizeUser } from "./service.js";

const ada = {
  id: "user-1",
  displayName: "Ada",
  active: true,
};

console.log(summarizeUser(ada));
console.log(summarizeUser({ id: "broken", displayName: 42, active: true }));
