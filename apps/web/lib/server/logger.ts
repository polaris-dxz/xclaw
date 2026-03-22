import pino from 'pino'

export const logger = pino({
  name: 'xclaw-server',
  level: process.env.LOG_LEVEL || 'info',
})
