import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    // Worktrees are separate checkouts nested inside this one; linting them
    // duplicates the root lint and crashes on their stale .next artifacts.
    ignores: [
      ".next/**",
      "src/generated/**",
      ".claude/worktrees/**",
      ".worktrees/**",
    ],
  },
];

export default config;
