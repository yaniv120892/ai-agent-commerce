import nextConfig from "eslint-config-next";

const config = [...nextConfig, { ignores: [".next/**", "src/generated/**"] }];

export default config;
