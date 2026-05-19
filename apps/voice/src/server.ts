import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { WebSocketServer, type WebSocket } from "ws"
import type { types } from "mediasoup"
import { assertWorkspaceMember } from "./access"
import { buildIceServers } from "./ice"
import { verifyToken, type VoiceUser } from "./auth"
import { env } from "./env"
import { Room, type Peer } from "./room"
import { initWorkers } from "./worker"

type DtlsParameters = types.DtlsParameters
type MediaKind = types.MediaKind
type RtpParameters = types.RtpParameters
type RtpCapabilities = types.RtpCapabilities
type Producer = types.Producer

type SocketContext = {
  user: VoiceUser
  workspaceId: string
}

type Request = {
  id?: string
  type: string
  data?: Record<string, unknown>
}

function parseSocketContext(url: string | undefined): { token: string; workspaceId: string } | null {
  if (!url) return null
  try {
    const parsed = new URL(url, "http://localhost")
    const token = parsed.searchParams.get("token")
    const workspaceId = parsed.searchParams.get("workspaceId")
    if (!token || !workspaceId) return null
    return { token, workspaceId }
  } catch {
    return null
  }
}

function publicPeer(peer: Peer): {
  peerId: string
  userId: string
  displayName: string
  micMuted: boolean
  deafened: boolean
} {
  return {
    peerId: peer.id,
    userId: peer.userId,
    displayName: peer.displayName,
    micMuted: peer.micMuted,
    deafened: peer.deafened
  }
}

async function main() {
  await initWorkers()

  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ server: httpServer, path: "/" })

  wss.on("connection", async (socket, req) => {
    const parsed = parseSocketContext(req.url)
    if (!parsed) {
      socket.close(4400, "Bad request")
      return
    }

    let user: VoiceUser
    try {
      user = await verifyToken(parsed.token)
      await assertWorkspaceMember(parsed.workspaceId, user)
    } catch (error) {
      socket.close(4401, error instanceof Error ? error.message : "Unauthorized")
      return
    }

    const context: SocketContext = { user, workspaceId: parsed.workspaceId }
    await handleConnection(socket, context)
  })

  httpServer.listen(env.port, () => {
    console.log(`voice listening on http://localhost:${env.port}`)
  })
}

async function handleConnection(socket: WebSocket, context: SocketContext): Promise<void> {
  const room = await Room.getOrCreate(context.workspaceId)
  const peerId = randomUUID()
  const send = (payload: unknown) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  const peer: Peer = {
    id: peerId,
    userId: context.user.id,
    displayName: context.user.email ?? context.user.id,
    micMuted: true,
    deafened: true,
    routerIndex: room.assignRouter(),
    socketSend: send,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map()
  }
  room.addPeer(peer)

  const existingPeers = Array.from(room.peers.values())
    .filter((row) => row.id !== peerId)
    .map((row) => ({
      ...publicPeer(row),
      producers: Array.from(row.producers.values()).map((producer) => ({
        producerId: producer.id,
        kind: producer.kind
      }))
    }))

  send({
    type: "welcome",
    selfPeerId: peerId,
    rtpCapabilities: room.routerFor(peer).rtpCapabilities,
    peers: existingPeers
  })

  room.broadcast(peerId, { type: "peerJoined", ...publicPeer(peer) })

  socket.on("message", (raw) => {
    let request: Request
    try {
      request = JSON.parse(raw.toString()) as Request
    } catch {
      return
    }
    void handleRequest(request, peer, room).catch((error) => {
      console.error("voice request error", error)
      if (request.id) {
        send({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  socket.on("close", () => {
    room.broadcast(peerId, { type: "peerLeft", peerId })
    room.removePeer(peerId)
  })
}

async function handleRequest(request: Request, peer: Peer, room: Room): Promise<void> {
  const data = request.data ?? {}
  const reply = (payload: Record<string, unknown>) => {
    if (request.id) peer.socketSend({ id: request.id, ok: true, data: payload })
  }

  switch (request.type) {
    case "createTransport": {
      const transport = await room.createTransport(peer)
      reply({
        transportId: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        iceServers: buildIceServers()
      })
      return
    }
    case "connectTransport": {
      await room.connectTransport(peer, data["transportId"] as string, data["dtlsParameters"] as DtlsParameters)
      reply({})
      return
    }
    case "produce": {
      const transportId = data["transportId"] as string
      const kind = data["kind"] as MediaKind
      const rtpParameters = data["rtpParameters"] as RtpParameters
      const producer = await room.produce(peer, transportId, kind, rtpParameters)
      reply({ producerId: producer.id })
      room.broadcast(peer.id, {
        type: "newProducer",
        peerId: peer.id,
        producerId: producer.id,
        kind: producer.kind
      })
      hookProducerClose(room, peer, producer)
      return
    }
    case "closeProducer": {
      const producer = peer.producers.get(data["producerId"] as string)
      if (producer) {
        producer.close()
        peer.producers.delete(producer.id)
        room.broadcast(peer.id, {
          type: "producerClosed",
          peerId: peer.id,
          producerId: producer.id
        })
      }
      reply({})
      return
    }
    case "pauseProducer": {
      const producer = peer.producers.get(data["producerId"] as string)
      if (producer) await producer.pause()
      reply({})
      return
    }
    case "resumeProducer": {
      const producer = peer.producers.get(data["producerId"] as string)
      if (producer) await producer.resume()
      reply({})
      return
    }
    case "consume": {
      const producerId = data["producerId"] as string
      const transportId = data["transportId"] as string
      const rtpCapabilities = data["rtpCapabilities"] as RtpCapabilities
      const owner = room.findProducerOwner(producerId)
      if (!owner) throw new Error("Producer not found")
      const consumer = await room.consume(peer, producerId, transportId, rtpCapabilities)
      if (!consumer) {
        reply({ skipped: true })
        return
      }
      reply({
        consumerId: consumer.id,
        producerId,
        peerId: owner.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        paused: consumer.paused
      })
      return
    }
    case "resumeConsumer": {
      const consumer = peer.consumers.get(data["consumerId"] as string)
      if (consumer) await consumer.resume()
      reply({})
      return
    }
    case "pauseConsumer": {
      const consumer = peer.consumers.get(data["consumerId"] as string)
      if (consumer) await consumer.pause()
      reply({})
      return
    }
    case "setState": {
      if (typeof data["micMuted"] === "boolean") peer.micMuted = data["micMuted"]
      if (typeof data["deafened"] === "boolean") peer.deafened = data["deafened"]
      reply({})
      room.broadcast(peer.id, {
        type: "peerStateChanged",
        peerId: peer.id,
        micMuted: peer.micMuted,
        deafened: peer.deafened
      })
      return
    }
    default:
      throw new Error(`Unknown request type: ${request.type}`)
  }
}

function hookProducerClose(room: Room, peer: Peer, producer: Producer): void {
  producer.on("transportclose", () => {
    if (!peer.producers.has(producer.id)) return
    peer.producers.delete(producer.id)
    room.broadcast(peer.id, {
      type: "producerClosed",
      peerId: peer.id,
      producerId: producer.id
    })
  })
}

void main().catch((error) => {
  console.error("voice server failed to start", error)
  process.exit(1)
})
