const { config } = require('dotenv')
const { resolve } = require('path')

// Load root .env so server-side code (API routes, Server Components) can access all vars
config({ path: resolve(__dirname, '../../.env') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@runic/types', '@runic/db'],
}

module.exports = nextConfig
