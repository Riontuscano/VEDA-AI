import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next regenerates AGENTS.md and CLAUDE.md on every dev start. The project's
  // conventions live in the README, so these would only drift out of date.
  agentRules: false,
};

export default nextConfig;
