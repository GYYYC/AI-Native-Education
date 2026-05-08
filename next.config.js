/** @type {import('next').NextConfig} */
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
  // Separate dev/build output to avoid chunk map corruption when both are used frequently.
  distDir: isDev ? '.next-dev' : '.next',
  webpack: (config, { isServer }) => {
    // Add path alias for @ -> src/
    config.resolve.alias['@'] = path.join(__dirname, 'src');
    return config;
  },
};

module.exports = nextConfig;
