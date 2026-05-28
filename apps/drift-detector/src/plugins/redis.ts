import IORedis from 'ioredis'
import { redisUrl } from '../env'

export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
})
