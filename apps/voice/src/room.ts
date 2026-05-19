import type { types } from "mediasoup"
import { env } from "./env"
import { audioCodecs, listWorkers } from "./worker"

type Router = types.Router
type WebRtcTransport = types.WebRtcTransport
type Producer = types.Producer
type Consumer = types.Consumer
type DtlsParameters = types.DtlsParameters
type MediaKind = types.MediaKind
type RtpParameters = types.RtpParameters
type RtpCapabilities = types.RtpCapabilities

export type Peer = {
  id: string
  userId: string
  displayName: string
  micMuted: boolean
  deafened: boolean
  routerIndex: number
  socketSend: (payload: unknown) => void
  transports: Map<string, WebRtcTransport>
  producers: Map<string, Producer>
  consumers: Map<string, Consumer>
}

const rooms = new Map<string, Room>()
const pending = new Map<string, Promise<Room>>()

export class Room {
  readonly id: string
  readonly routers: Router[]
  readonly peers = new Map<string, Peer>()
  private nextPeerRouter = 0
  // producerId -> routerIndex -> piped Producer on that router
  private readonly pipedProducers = new Map<string, Map<number, Producer>>()
  private readonly inflightPipes = new Map<string, Promise<Producer>>()

  constructor(id: string, routers: Router[]) {
    this.id = id
    this.routers = routers
  }

  static async getOrCreate(workspaceId: string): Promise<Room> {
    const existing = rooms.get(workspaceId)
    if (existing) return existing
    const inflight = pending.get(workspaceId)
    if (inflight) return inflight

    const promise = (async () => {
      const workers = listWorkers()
      const routers = await Promise.all(
        workers.map((worker) => worker.createRouter({ mediaCodecs: audioCodecs }))
      )
      const room = new Room(workspaceId, routers)
      rooms.set(workspaceId, room)
      return room
    })()
    pending.set(workspaceId, promise)
    try {
      return await promise
    } finally {
      pending.delete(workspaceId)
    }
  }

  assignRouter(): number {
    const index = this.nextPeerRouter % this.routers.length
    this.nextPeerRouter++
    return index
  }

  routerFor(peer: Peer): Router {
    const router = this.routers[peer.routerIndex]
    if (!router) throw new Error("Router missing for peer")
    return router
  }

  addPeer(peer: Peer): void {
    this.peers.set(peer.id, peer)
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    for (const consumer of peer.consumers.values()) consumer.close()
    for (const producer of peer.producers.values()) producer.close()
    for (const transport of peer.transports.values()) transport.close()
    this.peers.delete(peerId)
    if (this.peers.size === 0) {
      for (const router of this.routers) router.close()
      rooms.delete(this.id)
    }
  }

  async createTransport(peer: Peer): Promise<WebRtcTransport> {
    const listenInfo: {
      protocol: "udp" | "tcp"
      ip: string
      announcedAddress?: string
    } = {
      protocol: "udp",
      ip: env.mediasoup.listenIp
    }
    if (env.mediasoup.announcedIp) listenInfo.announcedAddress = env.mediasoup.announcedIp
    const tcpInfo: typeof listenInfo = { ...listenInfo, protocol: "tcp" }

    const transport = await this.routerFor(peer).createWebRtcTransport({
      listenInfos: [listenInfo, tcpInfo],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 600_000
    })
    transport.on("dtlsstatechange", (state) => {
      if (state === "closed" || state === "failed") transport.close()
    })
    peer.transports.set(transport.id, transport)
    return transport
  }

  async connectTransport(peer: Peer, transportId: string, dtlsParameters: DtlsParameters): Promise<void> {
    const transport = peer.transports.get(transportId)
    if (!transport) throw new Error("Transport not found")
    await transport.connect({ dtlsParameters })
  }

  async produce(
    peer: Peer,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters
  ): Promise<Producer> {
    const transport = peer.transports.get(transportId)
    if (!transport) throw new Error("Transport not found")
    const producer = await transport.produce({ kind, rtpParameters })
    peer.producers.set(producer.id, producer)
    producer.on("transportclose", () => {
      peer.producers.delete(producer.id)
    })
    return producer
  }

  async consume(
    peer: Peer,
    producerId: string,
    transportId: string,
    rtpCapabilities: RtpCapabilities
  ): Promise<Consumer | null> {
    const localProducer = await this.getProducerOnRouter(producerId, peer.routerIndex)
    if (!localProducer) return null

    const router = this.routerFor(peer)
    if (!router.canConsume({ producerId: localProducer.id, rtpCapabilities })) {
      return null
    }
    const transport = peer.transports.get(transportId)
    if (!transport) throw new Error("Recv transport not found")
    const consumer = await transport.consume({
      producerId: localProducer.id,
      rtpCapabilities,
      paused: true
    })
    peer.consumers.set(consumer.id, consumer)
    consumer.on("transportclose", () => peer.consumers.delete(consumer.id))
    consumer.on("producerclose", () => {
      peer.consumers.delete(consumer.id)
      peer.socketSend({ type: "consumerClosed", consumerId: consumer.id })
    })
    return consumer
  }

  findProducerOwner(producerId: string): Peer | null {
    for (const peer of this.peers.values()) {
      if (peer.producers.has(producerId)) return peer
    }
    return null
  }

  broadcast(except: string, message: unknown): void {
    for (const peer of this.peers.values()) {
      if (peer.id === except) continue
      peer.socketSend(message)
    }
  }

  // Returns a Producer object that lives on `routerIndex`. If the source
  // producer already lives there, returns it as-is. Otherwise pipes it
  // across worker boundaries via mediasoup.pipeToRouter and caches the
  // result so subsequent consumers on the same router reuse the pipe.
  private async getProducerOnRouter(
    producerId: string,
    routerIndex: number
  ): Promise<Producer | null> {
    const owner = this.findProducerOwner(producerId)
    if (!owner) return null
    const original = owner.producers.get(producerId)
    if (!original) return null
    if (owner.routerIndex === routerIndex) return original

    const cached = this.pipedProducers.get(producerId)?.get(routerIndex)
    if (cached) return cached

    const key = `${producerId}:${routerIndex}`
    const inflight = this.inflightPipes.get(key)
    if (inflight) return inflight

    const srcRouter = this.routers[owner.routerIndex]
    const dstRouter = this.routers[routerIndex]
    if (!srcRouter || !dstRouter) throw new Error("Router index out of range")

    const promise = (async () => {
      const { pipeProducer } = await srcRouter.pipeToRouter({
        producerId,
        router: dstRouter
      })
      if (!pipeProducer) throw new Error("pipeToRouter returned no producer")

      let byRouter = this.pipedProducers.get(producerId)
      if (!byRouter) {
        byRouter = new Map()
        this.pipedProducers.set(producerId, byRouter)
      }
      byRouter.set(routerIndex, pipeProducer)

      pipeProducer.observer.on("close", () => {
        byRouter!.delete(routerIndex)
        if (byRouter!.size === 0) this.pipedProducers.delete(producerId)
      })

      return pipeProducer
    })()

    this.inflightPipes.set(key, promise)
    try {
      return await promise
    } finally {
      this.inflightPipes.delete(key)
    }
  }
}
