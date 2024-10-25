import * as mediasoup from 'mediasoup';
import { Router, Worker } from 'mediasoup/node/lib/types';

// Define Worker and Router
let worker: Worker;
let router: Router;

// Define rtpCapabilities type based on the Router instance
export let rtpCapabilities: mediasoup.types.RtpCapabilities;

export async function initMediasoup() {
  try {
    worker = await mediasoup.createWorker();

    router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: {},
          rtcpFeedback: []
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          },
          rtcpFeedback: [
            { type: 'nack' },
            { type: 'nack', parameter: 'pli' }
          ]
        }
      ]
    });

    // Set the rtpCapabilities based on the created router
    rtpCapabilities = router.rtpCapabilities;

    console.log('Mediasoup router created successfully');
  } catch (error) {
    console.error('Error initializing Mediasoup:', error);
    throw error;
  }
}

export { router };
