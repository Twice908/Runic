// Re-export the shared Prisma singleton from @pulse/db.
// Never instantiate a new PrismaClient here.
export { prisma } from '@pulse/db'
