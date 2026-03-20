import { execSync } from "node:child_process"

function getListeningPids(port) {
  try {
    const output = execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN || true`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function safeKillPid(pid) {
  try {
    execSync(`kill ${pid}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const portsToClean = [20263]

for (const port of portsToClean) {
  const pids = getListeningPids(port)
  if (pids.length === 0) {
    continue
  }

  for (const pid of pids) {
    const killed = safeKillPid(pid)
    if (killed) {
      process.stdout.write(`[dev:cleanup] stopped pid ${pid} on port ${port}\n`)
    }
  }
}
