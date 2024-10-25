import { WebRtcTransport, Producer, Consumer, MediaKind } from 'mediasoup/node/lib/types';
import { router } from '../config/mediasoup';

const transports = new Map<string, WebRtcTransport>();
const producers = new Map<string, Producer>();  // Store producers by producer ID
const consumers = new Map<string, Consumer>();  // Store consumers by consumer ID

// Helper: Retrieve Transport by ID
function getTransport(transportId: string): WebRtcTransport {
  const transport = transports.get(transportId);
  if (!transport) {
    throw new Error(`Transport with ID ${transportId} not found`);
  }
  return transport;
}

// Helper: Create WebRTC Transport
async function createWebRtcTransport(): Promise<WebRtcTransport> {
  return await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1' }],
    enableUdp: true,
    enableTcp: true,
  });
}

// Create WebRTC Transport (Producer or Consumer)
export async function createTransport(): Promise<WebRtcTransport> {
  const transport = await createWebRtcTransport();
  transports.set(transport.id, transport);
  return transport;
}

// Connect WebRTC Transport
export async function connectTransport(transportId: string, dtlsParameters: any) {
  const transport = getTransport(transportId);
  await transport.connect({ dtlsParameters });
}

// Create Media Producer (Audio/Video)
export async function createProducer(transportId: string, kind: MediaKind, rtpParameters: any): Promise<Producer> {
  const transport = getTransport(transportId);
  const producer = await transport.produce({ kind, rtpParameters });
  producers.set(producer.id, producer);
  return producer;
}

// Create Media Consumer
export async function createConsumer(transportId: string, producerId: string, rtpCapabilities: any): Promise<Consumer> {
  const transport = getTransport(transportId);
  const producer = producers.get(producerId);
  if (!producer) {
    throw new Error(`Producer with ID ${producerId} not found`);
  }

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities,
  });
  
  consumers.set(consumer.id, consumer);
  return consumer;
}

// Create Consumer Transport (Using common createWebRtcTransport)
export async function createConsumerTransport(clientId: string): Promise<WebRtcTransport> {
  const transport = await createWebRtcTransport();
  transports.set(transport.id, transport); // Store the new consumer transport
  return transport;
}

// Clean up producers and consumers
export function closeProducer(producerId: string) {
  const producer = producers.get(producerId);
  if (producer) {
    producer.close();
    producers.delete(producerId);
  }
}

export function closeConsumer(consumerId: string) {
  const consumer = consumers.get(consumerId);
  if (consumer) {
    consumer.close();
    consumers.delete(consumerId);
  }
}
