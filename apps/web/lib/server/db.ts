import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { config, ensureDirExists } from '@/lib/server/config'
import { runMigrations } from '@/lib/server/migrations'
import { logger } from '@/lib/server/logger'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    ensureDirExists(dirname(config.dbPath))
    db = new Database(config.dbPath)

    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')

    runMigrations(db)
    logger.info({ dbPath: config.dbPath }, 'Database initialized')
  }
  return db
}

export function closeDatabase() {
  if (!db) return
  db.close()
  db = null
}

process.on('exit', closeDatabase)
process.on('SIGINT', closeDatabase)
process.on('SIGTERM', closeDatabase)
