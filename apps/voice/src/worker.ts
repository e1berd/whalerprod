import * as mediasoup from "mediasoup"
import type { types } from "mediasoup"
import { env } from "./env"

type Worker = types.Worker

export const audioCodecs: types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    preferredPayloadType: 100,
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 1
    }
  }
]

const workers: Worker[] = []
let nextWorker = 0

export async function initWorkers(): Promise<void> {
  if (workers.length > 0) return
  const count = Math.max(1, env.mediasoup.workerCount)
  for (let index = 0; index < count; index++) {
    const worker = await mediasoup.createWorker({
      logLevel: "warn",
      rtcMinPort: env.mediasoup.rtcMinPort,
      rtcMaxPort: env.mediasoup.rtcMaxPort
    })
    worker.on("died", () => {
      console.error(`mediasoup worker ${worker.pid} died, exiting`)
      setTimeout(() => process.exit(1), 100)
    })
    workers.push(worker)
  }
}

export function pickWorker(): Worker {
  const worker = workers[nextWorker % workers.length]
  nextWorker++
  if (!worker) throw new Error("Mediasoup worker not initialized")
  return worker
}

export function listWorkers(): Worker[] {
  if (workers.length === 0) throw new Error("Mediasoup workers not initialized")
  return workers
}
