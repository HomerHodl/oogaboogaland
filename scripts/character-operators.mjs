// GitHub account IDs are immutable; a renamed/recycled login grants no authority.
export const OPERATORS = Object.freeze([
  Object.freeze({ login: "w-s-bitcoin", id: 95375789 }),
  Object.freeze({ login: "2140data", id: 72945059 })
]);
export const isOperator = (user) => user?.type !== "Bot" && OPERATORS.some((operator) => operator.id === Number(user?.id)
  && operator.login === user?.login?.toLowerCase());
export const BOT = "github-actions[bot]";
